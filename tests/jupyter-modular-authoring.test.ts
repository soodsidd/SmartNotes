/**
 * SN-387: modular companion authoring on Jupyter pages.
 *
 * - jupyter_file_read / jupyter_file_write: the minimal vault tools for module
 *   files in a page's own .jupyter folder (nested create, revision-safe full
 *   replace, notebook and path refusals).
 * - workspace_source_create now creates missing parent directories so a
 *   Deep Work module can start a new subpackage.
 * - The judgment-only guidance rides in the per-turn operating context, which
 *   a persisted agent-settings systemPrompt override cannot replace.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildSmartNotesOperatingContext } from "@/lib/ai-sidebar";
import { createWorkspaceSource, readWorkspaceSource } from "@/server/jupyter/workspace-files";
import { executeVaultTool } from "@/server/vault/agent-tools";
import { invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";

const PAGE_PATH = "Notebook/Section/analysis.html";
const NOTEBOOK = {
  cells: [
    {
      id: "code-cell-1",
      cell_type: "code",
      execution_count: null,
      metadata: {},
      source: ["def smooth(xs):\n", "    return xs\n"],
      outputs: [],
    },
  ],
  metadata: { kernelspec: { name: "python3" } },
  nbformat: 4,
  nbformat_minor: 5,
};

async function withJupyterPage(run: (ctx: { vaultRoot: string; folder: string }) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-sn387-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  invalidateVaultTreeCacheForTesting();
  const folder = path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter");
  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(vaultRoot, PAGE_PATH), "---\ntitle: Analysis\nnote_type: jupyter\n---\n", "utf8");
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "plain.html"),
      "---\ntitle: Plain\n---\n<p>text</p>\n",
      "utf8"
    );
    await fs.writeFile(path.join(folder, "notebook.ipynb"), JSON.stringify(NOTEBOOK, null, 1), "utf8");
    await run({ vaultRoot, folder });
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    invalidateVaultTreeCacheForTesting();
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

type ToolData = Record<string, unknown>;

/** Normalizes executeVaultTool into { ok, data, error: { code } } for terse assertions. */
async function tool(name: string, args: Record<string, unknown>) {
  const result = await executeVaultTool(name, args);
  if (result.ok) return { ok: true, data: result.result.data as ToolData, error: undefined };
  return { ok: false, data: undefined, error: { code: result.code, message: result.error } };
}

describe("SN-387 vault Jupyter page module files", () => {
  it("creates nested modules, reads revisions, and replaces only with the current revision", async () => {
    await withJupyterPage(async ({ folder }) => {
      const notebookBefore = await fs.readFile(path.join(folder, "notebook.ipynb"), "utf8");

      const created = await tool("jupyter_file_write", {
        path: PAGE_PATH,
        file: "lib/filters.py",
        source: "def smooth(xs):\n    return list(xs)\n",
      });
      expect(created.ok).toBe(true);
      expect(created.data).toMatchObject({ path: "lib/filters.py", created: true, page: PAGE_PATH });
      expect(String(created.data?.hint)).toContain("autoreload 2");
      expect(await fs.readFile(path.join(folder, "lib", "filters.py"), "utf8")).toBe("def smooth(xs):\n    return list(xs)\n");

      const listed = await tool("jupyter_file_read", { path: PAGE_PATH });
      expect(listed.ok).toBe(true);
      expect((listed.data?.files as Array<{ path: string }>).map((f) => f.path).sort()).toEqual(["lib/filters.py", "notebook.ipynb"]);

      const read = await tool("jupyter_file_read", { path: PAGE_PATH, file: "lib/filters.py" });
      expect(read.data).toMatchObject({ path: "lib/filters.py", source: "def smooth(xs):\n    return list(xs)\n" });
      expect(read.data?.revision).toBe(created.data?.revision);

      // An existing file is never overwritten without a revision.
      const blind = await tool("jupyter_file_write", { path: PAGE_PATH, file: "lib/filters.py", source: "x = 1\n" });
      expect(blind.ok).toBe(false);
      expect(blind.error?.code).toBe("JUPYTER_FILE_EXISTS");

      const replaced = await tool("jupyter_file_write", {
        path: PAGE_PATH,
        file: "lib/filters.py",
        source: "def smooth(xs, k=3):\n    return list(xs)[:k]\n",
        expectedRevision: read.data?.revision,
      });
      expect(replaced.ok).toBe(true);
      expect(replaced.data).toMatchObject({ created: false });
      expect(await fs.readFile(path.join(folder, "lib", "filters.py"), "utf8")).toBe("def smooth(xs, k=3):\n    return list(xs)[:k]\n");

      // A stale revision (owner edited after the read) is a conflict, file untouched.
      await fs.writeFile(path.join(folder, "lib", "filters.py"), "# owner edit\n", "utf8");
      const stale = await tool("jupyter_file_write", {
        path: PAGE_PATH,
        file: "lib/filters.py",
        source: "y = 2\n",
        expectedRevision: replaced.data?.revision,
      });
      expect(stale.ok).toBe(false);
      expect(stale.error?.code).toBe("WORKSPACE_REVISION_CONFLICT");
      expect(await fs.readFile(path.join(folder, "lib", "filters.py"), "utf8")).toBe("# owner edit\n");

      const missing = await tool("jupyter_file_write", {
        path: PAGE_PATH,
        file: "nope.py",
        source: "z = 3\n",
        expectedRevision: replaced.data?.revision,
      });
      expect(missing.error?.code).toBe("JUPYTER_FILE_MISSING");

      // The notebook itself only changes through the cell tools.
      expect(await fs.readFile(path.join(folder, "notebook.ipynb"), "utf8")).toBe(notebookBefore);
    });
  });

  it("refuses notebooks, hidden/dependency paths, escapes, and non-Jupyter pages", async () => {
    await withJupyterPage(async ({ vaultRoot, folder }) => {
      const notebook = await tool("jupyter_file_write", { path: PAGE_PATH, file: "notebook.ipynb", source: "{}" });
      expect(notebook.error?.code).toBe("JUPYTER_FILE_NOTEBOOK");
      const other = await tool("jupyter_file_write", { path: PAGE_PATH, file: "scratch/other.IPYNB", source: "{}" });
      expect(other.error?.code).toBe("JUPYTER_FILE_NOTEBOOK");

      for (const file of [".env", "node_modules/pkg/a.py", "__pycache__/a.py", "../escape.py", "C:/abs.py"]) {
        const blocked = await tool("jupyter_file_write", { path: PAGE_PATH, file, source: "a = 1\n" });
        expect(blocked.ok).toBe(false);
      }
      await expect(fs.access(path.join(vaultRoot, "Notebook", "Section", "escape.py"))).rejects.toThrow();
      await expect(fs.access(path.join(folder, "node_modules"))).rejects.toThrow();

      const plain = await tool("jupyter_file_read", { path: "Notebook/Section/plain.html" });
      expect(plain.error?.code).toBe("NOT_JUPYTER_PAGE");
    });
  });
});

describe("SN-387 workspace_source_create parent directories", () => {
  it("creates missing parent directories for a new module inside the root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-sn387-ws-"));
    try {
      const request = { rootPath: root, requestedAccess: "editable" as const, ownerOpen: true };
      const created = await createWorkspaceSource(request, "pkg/sub/core.py", "def f():\n    return 1\n");
      expect(created.path).toBe("pkg/sub/core.py");
      expect(await fs.readFile(path.join(root, "pkg", "sub", "core.py"), "utf8")).toBe("def f():\n    return 1\n");
      expect((await readWorkspaceSource(request, "pkg/sub/core.py")).revision).toBe(created.revision);

      // Invalid source must not leave empty directories behind.
      await expect(createWorkspaceSource(request, "bad/dir/x.py", "a\u0000b")).rejects.toMatchObject({
        code: "INVALID_WORKSPACE_SOURCE",
      });
      await expect(fs.access(path.join(root, "bad"))).rejects.toThrow();

      // Read-only workspaces still refuse before anything is created.
      await expect(
        createWorkspaceSource({ rootPath: root, requestedAccess: "read-only" }, "ro/x.py", "a = 1\n")
      ).rejects.toMatchObject({ code: "WORKSPACE_READ_ONLY" });
      await expect(fs.access(path.join(root, "ro"))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("SN-387 modular authoring guidance in the operating context", () => {
  it("gives vault Jupyter page turns judgment-based extraction guidance and the module file tools", () => {
    const context = buildSmartNotesOperatingContext({ title: "Analysis", path: PAGE_PATH, noteType: "jupyter" });
    expect(context).toContain("Modular notebook authoring (guidance, use your judgment):");
    expect(context).toContain("when the owner asks, when the notebook is getting large or hard to follow, or when the requested scope is too big for cells");
    expect(context).toContain("a notebook-only page stays notebook-only");
    expect(context).toContain("move the code out rather than duplicating it");
    expect(context).toContain("keep cells thin (imports, parameters, calls, plots, inspection)");
    expect(context).toContain("small, composable functions that take parameters and return data");
    expect(context).toContain("Tests are welcome when they help but are never required");
    expect(context).toContain("autoreload 2");
    expect(context).toContain("restart the kernel and re-run the needed cells, or tell the owner");
    expect(context).toContain("inside this page's own .jupyter folder");
    expect(context).toContain('"tool": "jupyter_file_write"');
    expect(context).toContain('"tool": "jupyter_file_read"');
    expect(context).toContain(`"path": "${PAGE_PATH}"`);
    // Guidance only: no hard limits or enforcement language.
    expect(context).not.toMatch(/must (extract|split)|cell[- ]size limit|lines per cell/i);
  });

  it("is absent from non-Jupyter pages", () => {
    const context = buildSmartNotesOperatingContext({ title: "Plain", path: "Notebook/Section/plain.html", noteType: "text" });
    expect(context).not.toContain("Modular notebook authoring");
    expect(context).not.toContain("jupyter_file_write");
  });

  it("gives editable Deep Work notebook turns layout-preserving guidance with workspace tools only", () => {
    const descriptor = {
      rootPath: "C:/Projects/LeRobot",
      projectName: "LeRobot",
      requestedAccess: "editable" as const,
      capability: "dwc_test_capability",
    };
    const notebook = buildSmartNotesOperatingContext({
      title: "LeRobot",
      path: "deep-work-pending:LeRobot",
      noteType: "jupyter",
      projectWorkspace: { ...descriptor, notebookSessionReady: true },
      activeJupyterFocus: {
        pagePath: "deep-work-pending:LeRobot",
        workspacePath: "notebooks/explore.ipynb",
        documentKind: "notebook",
        activeCellIndex: 0,
        activeCellId: "code-1",
        sourceRevision: null,
        modelRevision: 1,
        caret: null,
        selection: null,
        selectionRects: [],
      } as never,
    });
    expect(notebook).toContain("Modular notebook authoring (guidance, use your judgment):");
    expect(notebook).toContain("Never rearrange or rename existing folders");
    expect(notebook).toContain("workspace_source_create (missing subdirectories are created)");
    expect(notebook).toContain("workspace_source_edit");
    expect(notebook).not.toContain("jupyter_file_write");

    const source = buildSmartNotesOperatingContext({
      title: "LeRobot",
      path: "deep-work-pending:LeRobot",
      noteType: "jupyter",
      projectWorkspace: { ...descriptor, activeFile: "src/lerobot/train.py" },
    });
    expect(source).not.toContain("Modular notebook authoring");

    const readOnly = buildSmartNotesOperatingContext({
      title: "LeRobot",
      path: "deep-work-pending:LeRobot",
      noteType: "jupyter",
      projectWorkspace: { ...descriptor, requestedAccess: "read-only", activeFile: "notebooks/explore.ipynb" },
    });
    expect(readOnly).not.toContain("Modular notebook authoring");
  });
});
