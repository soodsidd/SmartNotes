import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  GET as getWorkspaceSource,
  POST as postWorkspaceSource,
} from "@/app/api/workspace/source/route";
import {
  issueWorkspaceCapability,
  resetWorkspaceCapabilitiesForTesting,
} from "@/server/jupyter/workspace-capability";
import {
  createWorkspaceSource,
  listWorkspaceSources,
  readWorkspaceSource,
  writeWorkspaceSource,
} from "@/server/jupyter/workspace-files";
import {
  readWorkspaceAnnotations,
  readWorkspaceCompanion,
  writeWorkspaceAnnotations,
  writeWorkspaceCompanion,
} from "@/server/jupyter/workspace-state";
import { resolveProjectWorkspace } from "@/server/jupyter/workspace-root";

describe("SN-258 bounded workspace source and app-state collaboration", () => {
  let parent: string;
  let root: string;
  let state: string;
  const request = (requestedAccess: "editable" | "read-only" = "editable") => ({
    rootPath: root,
    projectId: "project-1",
    repoId: "repo-1",
    workItemId: "SN-258",
    branch: "av/sn-258",
    requestedAccess,
  });

  beforeEach(async () => {
    resetWorkspaceCapabilitiesForTesting();
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "sn258-worktrees-"));
    root = path.join(parent, "worktree");
    state = await fs.mkdtemp(path.join(os.tmpdir(), "sn258-state-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "const value = 1;\n", "utf8");
    process.env.SMART_NOTES_STATE_DIR = state;
  });

  afterEach(async () => {
    resetWorkspaceCapabilitiesForTesting();
    delete process.env.SMART_NOTES_STATE_DIR;
    await fs.rm(parent, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  });

  it("reads one bounded text file with a strong revision and rejects unsafe paths", async () => {
    const read = await readWorkspaceSource(request(), "src/index.ts", 8);
    expect(read).toMatchObject({
      path: "src/index.ts",
      source: "const va",
      truncated: true,
    });
    expect(read.revision).toMatch(/^sha256:[a-f0-9]{64}$/);

    await expect(readWorkspaceSource(request(), "../outside")).rejects.toMatchObject({
      code: "WORKSPACE_PATH_BLOCKED",
    });
    await expect(readWorkspaceSource(request(), ".env")).rejects.toMatchObject({
      code: "WORKSPACE_PATH_BLOCKED",
    });
    await expect(readWorkspaceSource(request(), "node_modules/pkg/index.js")).rejects.toMatchObject({
      code: "WORKSPACE_PATH_BLOCKED",
    });
  });

  it("lists only a bounded safe workspace file set without following hidden or linked paths", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sn261-outside-"));
    await fs.writeFile(path.join(root, "README.md"), "# Workspace\n", "utf8");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=secret\n", "utf8");
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "secret", "utf8");
    await fs.writeFile(path.join(outside, "outside.py"), "print('outside')\n", "utf8");
    await fs.symlink(outside, path.join(root, "escape"), "junction");
    try {
      const listing = await listWorkspaceSources(request(), 10);
      expect(listing).toMatchObject({ count: 2, limit: 10, truncated: false });
      expect(listing.files.map((file) => file.path)).toEqual(["README.md", "src/index.ts"]);

      const bounded = await listWorkspaceSources(request(), 1);
      expect(bounded).toMatchObject({ count: 1, limit: 1, truncated: true });
      expect(bounded.files).toHaveLength(1);
      await expect(listWorkspaceSources(request(), 501)).rejects.toMatchObject({
        code: "INVALID_WORKSPACE_LIST_LIMIT",
      });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("atomically creates a new UTF-8 source or valid notebook without overwriting", async () => {
    const python = await createWorkspaceSource(request(), "walkthrough.py", "print('walkthrough')\n");
    expect(python).toMatchObject({ path: "walkthrough.py", source: "print('walkthrough')\n", truncated: false });
    await expect(createWorkspaceSource(request(), "walkthrough.py", "overwrite\n")).rejects.toMatchObject({
      code: "WORKSPACE_FILE_EXISTS",
      status: 409,
    });
    await expect(fs.readFile(path.join(root, "walkthrough.py"), "utf8")).resolves.toBe("print('walkthrough')\n");

    const notebookSource = JSON.stringify({
      cells: [{ cell_type: "markdown", metadata: {}, source: ["# main.py walkthrough\n"] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    });
    await expect(createWorkspaceSource(request(), "walkthrough.ipynb", notebookSource)).resolves.toMatchObject({
      path: "walkthrough.ipynb",
    });
    expect(JSON.parse(await fs.readFile(path.join(root, "walkthrough.ipynb"), "utf8"))).toMatchObject({
      nbformat: 4,
      cells: [{ cell_type: "markdown" }],
    });
    await expect(createWorkspaceSource(request(), "invalid.ipynb", "{}" )).rejects.toMatchObject({
      code: "INVALID_WORKSPACE_NOTEBOOK",
      status: 422,
    });
    await expect(createWorkspaceSource(request(), "too-large.py", "x".repeat(65_537))).rejects.toMatchObject({
      code: "WORKSPACE_CREATE_TOO_LARGE",
      status: 413,
    });
  });

  it("rejects create/edit in read-only workspaces and rejects unsafe create destinations", async () => {
    const before = await readWorkspaceSource(request(), "src/index.ts");
    await expect(writeWorkspaceSource(request("read-only"), "src/index.ts", before.revision, [
      { start: 0, end: 0, text: "// no\n" },
    ])).rejects.toMatchObject({ code: "WORKSPACE_READ_ONLY", status: 403 });
    await expect(createWorkspaceSource(request("read-only"), "new.py", "print('no')\n")).rejects.toMatchObject({
      code: "WORKSPACE_READ_ONLY",
      status: 403,
    });
    for (const unsafePath of ["../outside.py", ".hidden.py", "node_modules/pkg/new.js", "secrets/api-token.txt"]) {
      await expect(createWorkspaceSource(request(), unsafePath, "blocked\n")).rejects.toMatchObject({
        code: "WORKSPACE_PATH_BLOCKED",
      });
    }
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sn261-create-outside-"));
    await fs.symlink(outside, path.join(root, "linked"), "junction");
    try {
      await expect(createWorkspaceSource(request(), "linked/escape.py", "blocked\n")).rejects.toMatchObject({
        code: "WORKSPACE_SYMLINK_ESCAPE",
      });
      await expect(fs.stat(path.join(outside, "escape.py"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("binds API listing/read/create to the issued disk root, never a similarly named vault page", async () => {
    await fs.writeFile(path.join(root, "main.py"), "print('active workspace')\n", "utf8");
    const vaultPage = path.join(parent, "vault", "LeRobot.jupyter");
    await fs.mkdir(vaultPage, { recursive: true });
    await fs.writeFile(path.join(vaultPage, "main.py"), "print('vault fallback')\n", "utf8");
    const resolved = await resolveProjectWorkspace(request());
    const capability = issueWorkspaceCapability({
      ...request(),
      projectName: "LeRobot",
    }, resolved).capability;

    const listedResponse = await getWorkspaceSource(new Request(
      `http://smart-notes.test/api/workspace/source?workspace=${encodeURIComponent(capability)}&operation=list&maxCount=20`
    ));
    expect(listedResponse.status).toBe(200);
    const listed = await listedResponse.json() as { files: Array<{ path: string }> };
    expect(listed.files.map((file) => file.path)).toEqual(["main.py", "src/index.ts"]);

    const readResponse = await getWorkspaceSource(new Request(
      `http://smart-notes.test/api/workspace/source?workspace=${encodeURIComponent(capability)}&path=main.py`
    ));
    expect(await readResponse.json()).toMatchObject({ source: "print('active workspace')\n" });

    const notebookSource = JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 });
    const createResponse = await postWorkspaceSource(new Request(
      "http://smart-notes.test/api/workspace/source",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: capability, path: "walkthrough.ipynb", source: notebookSource }),
      }
    ));
    expect(createResponse.status).toBe(201);
    await expect(fs.readFile(path.join(root, "walkthrough.ipynb"), "utf8")).resolves.toBe(notebookSource);
    await expect(fs.stat(path.join(vaultPage, "walkthrough.ipynb"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies bounded non-overlapping edits atomically and returns 409-style conflicts", async () => {
    const before = await readWorkspaceSource(request(), "src/index.ts");
    const after = await writeWorkspaceSource(request(), "src/index.ts", before.revision, [
      { start: 14, end: 15, text: "2" },
    ]);
    expect(after.source).toBe("const value = 2;\n");
    await expect(writeWorkspaceSource(request(), "src/index.ts", before.revision, [
      { start: 14, end: 15, text: "3" },
    ])).rejects.toMatchObject({ code: "WORKSPACE_REVISION_CONFLICT", status: 409 });
    await expect(writeWorkspaceSource(request(), "src/index.ts", after.revision, [
      { start: 0, end: 5, text: "let" },
      { start: 4, end: 8, text: "overlap" },
    ])).rejects.toMatchObject({ code: "WORKSPACE_EDITS_OVERLAP" });
  });

  it("stores companion and revision anchors only under app state, with honest stale relocation", async () => {
    const before = await readWorkspaceSource(request(), "src/index.ts");
    await writeWorkspaceCompanion(request(), { whole: { messages: [{ role: "user", content: "hello" }] } });
    await writeWorkspaceAnnotations(request(), "src/index.ts", [{
      id: "annotation-1",
      anchor: {
        revision: before.revision,
        start: 6,
        end: 11,
        selectedText: "value",
        quotedText: "const value = 1;",
      },
      data: { note: "inspect" },
    }]);

    expect(await readWorkspaceCompanion(request())).toMatchObject({
      scopes: { whole: { messages: [{ content: "hello" }] } },
    });
    expect((await readWorkspaceAnnotations(request(), "src/index.ts")).annotations[0]).toMatchObject({
      status: "current",
      currentRange: { start: 6, end: 11 },
    });

    await fs.writeFile(path.join(root, "src", "index.ts"), "// moved\nconst value = 1;\n", "utf8");
    expect((await readWorkspaceAnnotations(request(), "src/index.ts")).annotations[0]).toMatchObject({
      status: "relocated",
      currentRange: { start: 15, end: 20 },
    });
    await fs.writeFile(path.join(root, "src", "index.ts"), "const value = value;\n", "utf8");
    expect((await readWorkspaceAnnotations(request(), "src/index.ts")).annotations[0]).toMatchObject({
      status: "stale",
    });

    const repoFiles = await fs.readdir(root, { recursive: true });
    expect(repoFiles.some((entry) => String(entry).endsWith(".annotations.json"))).toBe(false);
    expect(repoFiles.some((entry) => String(entry).endsWith(".companion.json"))).toBe(false);
    expect((await fs.readdir(path.join(state, "deep-work"))).length).toBe(1);
  });
});
