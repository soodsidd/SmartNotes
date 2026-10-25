import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  GET as getWorkspaceNotebook,
  POST as postWorkspaceNotebook,
} from "@/app/api/workspace/notebook/route";
import {
  issueWorkspaceCapability,
  resetWorkspaceCapabilitiesForTesting,
} from "@/server/jupyter/workspace-capability";
import {
  createWorkspaceSource,
  validateWorkspaceNotebookDocument,
} from "@/server/jupyter/workspace-files";
import {
  mutateWorkspaceNotebook,
  readWorkspaceNotebookContext,
} from "@/server/jupyter/workspace-notebook";
import { resolveProjectWorkspace } from "@/server/jupyter/workspace-root";

const EMPTY_NOTEBOOK = JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 });

describe("SN-359 Deep Work notebook cell tools", () => {
  let parent: string;
  let root: string;
  let state: string;
  const request = (requestedAccess: "editable" | "read-only" = "editable") => ({
    rootPath: root,
    projectId: "project-1",
    repoId: "repo-1",
    workItemId: "SN-359",
    branch: "av/sn-359",
    requestedAccess,
  });

  const readDisk = async (relativePath = "walkthrough.ipynb") =>
    JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8")) as {
      cells: Array<Record<string, unknown>>;
      metadata: Record<string, unknown>;
      nbformat: number;
      nbformat_minor: number;
    };

  const seedNotebook = async () => {
    const notebook = {
      cells: [
        { id: "intro", cell_type: "markdown", metadata: { tags: ["intro"] }, source: ["# Intro\n"] },
        {
          id: "load",
          cell_type: "code",
          metadata: { collapsed: false },
          execution_count: 3,
          outputs: [{ output_type: "stream", name: "stdout", text: ["loaded\n"] }],
          source: ["data = load()\n"],
        },
        { id: "plot", cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: [] },
      ],
      metadata: { kernelspec: { name: "python3", display_name: "Python 3" } },
      nbformat: 4,
      nbformat_minor: 5,
    };
    await fs.writeFile(path.join(root, "analysis.ipynb"), `${JSON.stringify(notebook, null, 1)}\n`, "utf8");
    return readWorkspaceNotebookContext(request(), "analysis.ipynb");
  };

  beforeEach(async () => {
    resetWorkspaceCapabilitiesForTesting();
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "sn359-worktrees-"));
    root = path.join(parent, "worktree");
    state = await fs.mkdtemp(path.join(os.tmpdir(), "sn359-state-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "main.py"), "print('main')\n", "utf8");
    process.env.SMART_NOTES_STATE_DIR = state;
  });

  afterEach(async () => {
    resetWorkspaceCapabilitiesForTesting();
    delete process.env.SMART_NOTES_STATE_DIR;
    await fs.rm(parent, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  });

  it("authors a sequenced multi-cell notebook that stays valid nbformat v4 on disk", async () => {
    const created = await createWorkspaceSource(request(), "walkthrough.ipynb", EMPTY_NOTEBOOK);
    let revision = created.revision;
    const steps: Array<{ cellType: string; source: string }> = [
      { cellType: "markdown", source: "# main.py walkthrough" },
      { cellType: "code", source: "import main\nmain.run()" },
      { cellType: "markdown", source: "## Results" },
      { cellType: "raw", source: "raw text" },
    ];
    for (const step of steps) {
      const result = await mutateWorkspaceNotebook(request(), "walkthrough.ipynb", revision, "cell_create", step);
      expect(result.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.revision).not.toBe(revision);
      revision = result.revision;
    }

    const disk = await readDisk();
    expect(() => validateWorkspaceNotebookDocument(disk)).not.toThrow();
    expect(disk.cells.map((cell) => cell.cell_type)).toEqual(["markdown", "code", "markdown", "raw"]);
    expect(disk.cells[1]).toMatchObject({
      source: ["import main\n", "main.run()\n"],
      outputs: [],
      execution_count: null,
      metadata: {},
    });
    expect(disk.cells.every((cell) => typeof cell.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(cell.id as string))).toBe(true);
    expect(disk.cells[0]).not.toHaveProperty("outputs");

    const context = await readWorkspaceNotebookContext(request(), "walkthrough.ipynb");
    expect(context).toMatchObject({ path: "walkthrough.ipynb", revision, cellCount: 4, includedCellCount: 4, truncated: false });
    expect(context.cells[1]).toMatchObject({ index: 1, cellType: "code", source: "import main\nmain.run()\n" });
  });

  it("does not mint cell ids for pre-4.5 notebooks", async () => {
    const legacy = JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 4 });
    const created = await createWorkspaceSource(request(), "legacy.ipynb", legacy);
    await mutateWorkspaceNotebook(request(), "legacy.ipynb", created.revision, "cell_create", { source: "x = 1" });
    const disk = await readDisk("legacy.ipynb");
    expect(disk.cells[0]).not.toHaveProperty("id");
    expect(disk.nbformat_minor).toBe(4);
  });

  it("edits, reorders, and deletes cells while preserving unrelated cells, outputs, and metadata", async () => {
    const before = await seedNotebook();
    const edited = await mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_edit", {
      cellId: "plot",
      source: "plot(data)",
    });
    expect(edited.mutation).toMatchObject({ action: "edit", index: 2, cellId: "plot" });
    let disk = await readDisk("analysis.ipynb");
    expect(disk.metadata).toEqual({ kernelspec: { name: "python3", display_name: "Python 3" } });
    expect(disk.cells[0]).toEqual({ id: "intro", cell_type: "markdown", metadata: { tags: ["intro"] }, source: ["# Intro\n"] });
    expect(disk.cells[1]).toMatchObject({
      execution_count: 3,
      metadata: { collapsed: false },
      outputs: [{ output_type: "stream", text: ["loaded\n"] }],
    });
    expect(disk.cells[2]).toMatchObject({ source: ["plot(data)\n"] });

    const reordered = await mutateWorkspaceNotebook(request(), "analysis.ipynb", edited.revision, "cell_reorder", {
      cellId: "plot",
      toIndex: 0,
    });
    expect(reordered.mutation).toMatchObject({ action: "reorder", fromIndex: 2, toIndex: 0, cellId: "plot" });
    disk = await readDisk("analysis.ipynb");
    expect(disk.cells.map((cell) => cell.id)).toEqual(["plot", "intro", "load"]);

    const deleted = await mutateWorkspaceNotebook(request(), "analysis.ipynb", reordered.revision, "cell_delete", {
      index: 1,
      cellId: "intro",
    });
    expect(deleted).toMatchObject({ cellCount: 2, mutation: { action: "delete", index: 1, cellId: "intro" } });
    disk = await readDisk("analysis.ipynb");
    expect(disk.cells.map((cell) => cell.id)).toEqual(["plot", "load"]);
    expect(disk.cells[1]).toMatchObject({ outputs: [{ output_type: "stream" }], execution_count: 3 });

    const retyped = await mutateWorkspaceNotebook(request(), "analysis.ipynb", deleted.revision, "cell_edit", {
      index: 0,
      cellType: "markdown",
    });
    disk = await readDisk("analysis.ipynb");
    expect(disk.cells[0]).not.toHaveProperty("outputs");
    expect(disk.cells[0]).not.toHaveProperty("execution_count");
    expect(() => validateWorkspaceNotebookDocument(disk)).not.toThrow();
    expect(retyped.revision).toMatch(/^sha256:/);
    // Notebook formatting (indent 1 + trailing newline) is preserved.
    expect(await fs.readFile(path.join(root, "analysis.ipynb"), "utf8")).toMatch(/^\{\n "cells": \[[\s\S]*\}\n$/);
  });

  it("reads one targeted cell and pages bounded context", async () => {
    const before = await seedNotebook();
    const targeted = await readWorkspaceNotebookContext(request(), "analysis.ipynb", { cellId: "load" });
    expect(targeted).toMatchObject({
      cellCount: 3,
      includedCellCount: 1,
      focusedCell: { resolvedIndex: 1, resolvedId: "load" },
      cells: [{ index: 1, source: "data = load()\n", executionCount: 3, outputs: [{ kind: "stream", text: "loaded\n" }] }],
    });
    const page = await readWorkspaceNotebookContext(request(), "analysis.ipynb", { startIndex: 2 });
    expect(page).toMatchObject({ startIndex: 2, includedCellCount: 1, truncated: true, revision: before.revision });
    expect(page.cells.map((cell) => cell.index)).toEqual([2]);
  });

  it("rejects stale, missing, and racing revisions without writing", async () => {
    const before = await seedNotebook();
    const original = await fs.readFile(path.join(root, "analysis.ipynb"), "utf8");

    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", undefined, "cell_create", { source: "x" }))
      .rejects.toMatchObject({ code: "INVALID_WORKSPACE_REVISION" });
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", "sha256:abc", "cell_create", { source: "x" }))
      .rejects.toMatchObject({ code: "INVALID_WORKSPACE_REVISION" });
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", `sha256:${"0".repeat(64)}`, "cell_create", { source: "x" }))
      .rejects.toMatchObject({ code: "WORKSPACE_REVISION_CONFLICT", status: 409 });
    expect(await fs.readFile(path.join(root, "analysis.ipynb"), "utf8")).toBe(original);

    const results = await Promise.allSettled([
      mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_create", { source: "first" }),
      mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_create", { source: "second" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "WORKSPACE_REVISION_CONFLICT", status: 409 });
    expect((await readDisk("analysis.ipynb")).cells).toHaveLength(4);
  });

  it("rejects index/cellId selector mismatches and out-of-range selectors", async () => {
    const before = await seedNotebook();
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_edit", {
      index: 0,
      cellId: "load",
      source: "wrong",
    })).rejects.toMatchObject({ code: "CELL_SELECTOR_MISMATCH", status: 409 });
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_delete", {
      index: 2,
      cellId: "intro",
    })).rejects.toMatchObject({ code: "CELL_SELECTOR_MISMATCH" });
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_reorder", {
      fromIndex: 1,
      cellId: "plot",
      toIndex: 0,
    })).rejects.toMatchObject({ code: "CELL_SELECTOR_MISMATCH" });
    await expect(readWorkspaceNotebookContext(request(), "analysis.ipynb", { index: 1, cellId: "plot" }))
      .rejects.toMatchObject({ code: "CELL_SELECTOR_MISMATCH" });
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_edit", { cellId: "missing", source: "x" }))
      .rejects.toMatchObject({ code: "CELL_NOT_FOUND" });
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_edit", { source: "x" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_create", { index: 9, source: "x" }))
      .rejects.toMatchObject({ code: "CELL_NOT_FOUND" });
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_reorder", { fromIndex: 0, toIndex: 3 }))
      .rejects.toMatchObject({ code: "CELL_NOT_FOUND" });
    await expect(mutateWorkspaceNotebook(request(), "analysis.ipynb", before.revision, "cell_run", { index: 0 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await readWorkspaceNotebookContext(request(), "analysis.ipynb")).revision).toBe(before.revision);
  });

  it("denies mutations in read-only workspaces while still allowing context reads", async () => {
    const before = await seedNotebook();
    await expect(readWorkspaceNotebookContext(request("read-only"), "analysis.ipynb")).resolves.toMatchObject({ cellCount: 3 });
    for (const [operation, args] of [
      ["cell_create", { source: "x" }],
      ["cell_edit", { index: 0, source: "x" }],
      ["cell_reorder", { fromIndex: 0, toIndex: 1 }],
      ["cell_delete", { index: 0 }],
    ] as const) {
      await expect(mutateWorkspaceNotebook(request("read-only"), "analysis.ipynb", before.revision, operation, { ...args }))
        .rejects.toMatchObject({ code: "WORKSPACE_READ_ONLY", status: 403 });
    }
    expect((await readWorkspaceNotebookContext(request(), "analysis.ipynb")).revision).toBe(before.revision);
  });

  it("rejects non-notebook targets, path escapes, and symlinked paths", async () => {
    await expect(readWorkspaceNotebookContext(request(), "src/main.py")).rejects.toMatchObject({ code: "WORKSPACE_NOT_NOTEBOOK" });
    await expect(mutateWorkspaceNotebook(request(), "src/main.py", `sha256:${"0".repeat(64)}`, "cell_create", {}))
      .rejects.toMatchObject({ code: "WORKSPACE_NOT_NOTEBOOK" });
    await expect(readWorkspaceNotebookContext(request(), "../outside.ipynb")).rejects.toMatchObject({ code: "WORKSPACE_PATH_BLOCKED" });
    await expect(readWorkspaceNotebookContext(request(), ".hidden/notes.ipynb")).rejects.toMatchObject({ code: "WORKSPACE_PATH_BLOCKED" });

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sn359-outside-"));
    await fs.writeFile(path.join(outside, "escape.ipynb"), EMPTY_NOTEBOOK, "utf8");
    await fs.symlink(outside, path.join(root, "linked"), "junction");
    try {
      await expect(readWorkspaceNotebookContext(request(), "linked/escape.ipynb"))
        .rejects.toMatchObject({ code: "WORKSPACE_SYMLINK_ESCAPE" });
      await expect(mutateWorkspaceNotebook(request(), "linked/escape.ipynb", `sha256:${"0".repeat(64)}`, "cell_create", {}))
        .rejects.toMatchObject({ code: "WORKSPACE_SYMLINK_ESCAPE" });
      expect(await fs.readFile(path.join(outside, "escape.ipynb"), "utf8")).toBe(EMPTY_NOTEBOOK);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("routes capability-bound API reads/mutations to the disk root, never a similarly named vault Jupyter folder", async () => {
    const vaultJupyter = path.join(parent, "vault", "Research", "walkthrough.jupyter");
    await fs.mkdir(vaultJupyter, { recursive: true });
    await fs.writeFile(path.join(vaultJupyter, "notebook.ipynb"), EMPTY_NOTEBOOK, "utf8");
    await fs.writeFile(path.join(vaultJupyter, "walkthrough.ipynb"), EMPTY_NOTEBOOK, "utf8");
    const previousVault = process.env.SMART_NOTES_VAULT;
    process.env.SMART_NOTES_VAULT = path.join(parent, "vault");
    try {
      const created = await createWorkspaceSource(request(), "walkthrough.ipynb", EMPTY_NOTEBOOK);
      const capability = issueWorkspaceCapability(
        { ...request(), projectName: "Walkthrough" },
        await resolveProjectWorkspace(request())
      ).capability;

      const post = (body: Record<string, unknown>) => postWorkspaceNotebook(new Request(
        "http://smart-notes.test/api/workspace/notebook",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: capability, ...body }) }
      ));
      const createResponse = await post({
        path: "walkthrough.ipynb",
        expectedRevision: created.revision,
        operation: "cell_create",
        cellType: "markdown",
        source: "# Walkthrough",
      });
      expect(createResponse.status).toBe(200);
      const createdCell = await createResponse.json() as { revision: string; mutation: { cellId: string } };

      const getResponse = await getWorkspaceNotebook(new Request(
        `http://smart-notes.test/api/workspace/notebook?workspace=${encodeURIComponent(capability)}&path=walkthrough.ipynb&cellId=${createdCell.mutation.cellId}&index=0`
      ));
      expect(getResponse.status).toBe(200);
      expect(await getResponse.json()).toMatchObject({ revision: createdCell.revision, cells: [{ source: "# Walkthrough\n" }] });

      const conflict = await post({ path: "walkthrough.ipynb", expectedRevision: created.revision, operation: "cell_create", source: "x" });
      expect(conflict.status).toBe(409);
      const mismatch = await post({
        path: "walkthrough.ipynb",
        expectedRevision: createdCell.revision,
        operation: "cell_edit",
        index: 1,
        cellId: createdCell.mutation.cellId,
        source: "x",
      });
      expect(mismatch.status).toBe(409);
      const badCapability = await post({ workspace: `dwc_${"z".repeat(43)}`, path: "walkthrough.ipynb", expectedRevision: createdCell.revision, operation: "cell_create" });
      expect(badCapability.status).toBeGreaterThanOrEqual(400);

      expect(await fs.readFile(path.join(vaultJupyter, "notebook.ipynb"), "utf8")).toBe(EMPTY_NOTEBOOK);
      expect(await fs.readFile(path.join(vaultJupyter, "walkthrough.ipynb"), "utf8")).toBe(EMPTY_NOTEBOOK);
      expect((await readDisk()).cells).toHaveLength(1);
    } finally {
      if (previousVault === undefined) delete process.env.SMART_NOTES_VAULT;
      else process.env.SMART_NOTES_VAULT = previousVault;
    }
  });
});
