import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import { executeVaultTool } from "@/server/vault/agent-tools";
import { invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";

const PAGE_PATH = "Notebook/Section/analysis.html";

async function withJupyterFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-jupyter-cells-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  invalidateVaultTreeCacheForTesting();

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter"), { recursive: true });
    await fs.writeFile(
      path.join(vaultRoot, PAGE_PATH),
      `---
title: Analysis
note_type: jupyter
---
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter", "notebook.ipynb"),
      JSON.stringify(
        {
          cells: [
            {
              id: "code-cell-1",
              cell_type: "code",
              execution_count: 1,
              metadata: {},
              source: ["print('old')\n"],
              outputs: [{ output_type: "stream", name: "stdout", text: ["old\n"] }],
            },
          ],
          metadata: { kernelspec: { name: "python3" } },
          nbformat: 4,
          nbformat_minor: 5,
        },
        null,
        1
      ),
      "utf8"
    );
    await run(vaultRoot);
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    invalidateVaultTreeCacheForTesting();
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

async function readNotebook(vaultRoot: string) {
  return JSON.parse(
    await fs.readFile(path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter", "notebook.ipynb"), "utf8")
  ) as { cells: Array<{ cell_type: string; source: string[]; outputs?: unknown[] }> };
}

describe("Jupyter notebook agent commands", () => {
  it("safely creates, edits, reorders, and deletes cells through the vault command path", async () => {
    await withJupyterFixture(async (vaultRoot) => {
      const created = await executeVaultTool("jupyter_cell_create", {
        path: PAGE_PATH,
        cellType: "markdown",
        source: "## Notes",
        index: 0,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) {
        throw new Error("Expected jupyter_cell_create to succeed.");
      }
      expect(created.result.notebookUpdated).toMatchObject({ path: PAGE_PATH });

      await executeVaultCommand({
        group: "jupyter",
        action: "cell_edit",
        args: { path: PAGE_PATH, index: 1, cellId: "code-cell-1", source: "print('new')" },
      });

      await executeVaultCommand({
        group: "jupyter",
        action: "cell_reorder",
        args: { path: PAGE_PATH, fromIndex: 1, toIndex: 0 },
      });

      let notebook = await readNotebook(vaultRoot);
      expect(notebook.cells).toHaveLength(2);
      expect(notebook.cells[0]?.cell_type).toBe("code");
      expect(notebook.cells[0]?.source.join("")).toBe("print('new')\n");
      expect(notebook.cells[0]?.outputs).toEqual([{ output_type: "stream", name: "stdout", text: ["old\n"] }]);
      expect(notebook.cells[1]?.cell_type).toBe("markdown");

      await executeVaultCommand({
        group: "jupyter",
        action: "cell_delete",
        args: { path: PAGE_PATH, index: 1 },
      });

      notebook = await readNotebook(vaultRoot);
      expect(notebook.cells).toHaveLength(1);
      expect(notebook.cells[0]?.source.join("")).toBe("print('new')\n");
    });
  });

  it("reads and edits one saved cell by stable id while rejecting a stale index/id pair", async () => {
    await withJupyterFixture(async (vaultRoot) => {
      const targeted = await executeVaultCommand({
        group: "jupyter",
        action: "context",
        args: { path: PAGE_PATH, cellId: "code-cell-1" },
      });
      const context = targeted.data.context as {
        includedCellCount: number;
        cells: Array<{ index: number; id: string | null; source: string }>;
      };
      expect(context.includedCellCount).toBe(1);
      expect(context.cells).toEqual([
        expect.objectContaining({ index: 0, id: "code-cell-1", source: "print('old')\n" }),
      ]);

      const edited = await executeVaultTool("jupyter_cell_edit", {
        path: PAGE_PATH,
        cellId: "code-cell-1",
        source: "print('focused edit')",
      });
      expect(edited.ok).toBe(true);
      let notebook = await readNotebook(vaultRoot);
      expect(notebook.cells[0]?.source.join("")).toBe("print('focused edit')\n");

      await executeVaultTool("jupyter_cell_create", {
        path: PAGE_PATH,
        cellType: "markdown",
        source: "inserted before focused cell",
        index: 0,
      });
      const staleSelector = await executeVaultTool("jupyter_cell_edit", {
        path: PAGE_PATH,
        index: 0,
        cellId: "code-cell-1",
        source: "must not land on the wrong cell",
      });
      expect(staleSelector).toMatchObject({ ok: false, code: "CELL_SELECTOR_MISMATCH", status: 409 });
      notebook = await readNotebook(vaultRoot);
      expect(notebook.cells[0]?.source.join("")).toBe("inserted before focused cell\n");
      expect(notebook.cells[1]?.source.join("")).toBe("print('focused edit')\n");
    });
  });

  it("rejects notebook cell commands on non-Jupyter pages", async () => {
    await withJupyterFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "plain.html"),
        `---
title: Plain
---
<p>Text page.</p>`,
        "utf8"
      );

      const result = await executeVaultTool("jupyter_cell_create", {
        path: "Notebook/Section/plain.html",
        source: "print('nope')",
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected jupyter_cell_create to fail for a text page.");
      }
      expect(result.code).toBe("NOT_JUPYTER_PAGE");
    });
  });
});
