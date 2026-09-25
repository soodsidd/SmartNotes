import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPage,
  deletePage,
  invalidateVaultTreeCacheForTesting,
  movePage,
  readVaultTree,
  renamePage,
} from "@/server/vault/pages";
import { readSpreadsheetWorkbook, writeSpreadsheetWorkbook } from "@/server/vault/spreadsheet";
import {
  listPageVersions,
  restorePageVersion,
  snapshotSpreadsheetContent,
} from "@/server/vault/versions";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-spreadsheet-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-spreadsheet-state-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Moved"), { recursive: true });
    await run(vaultRoot);
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    if (previousState) process.env.SMART_NOTES_STATE_DIR = previousState;
    else delete process.env.SMART_NOTES_STATE_DIR;
    invalidateVaultTreeCacheForTesting();
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

const editedWorkbook = {
  Workbook: {
    activeSheetIndex: 0,
    sheets: [{ name: "Budget", rows: [{ cells: [{ value: "Total" }, { formula: "=SUM(B2:B4)" }] }] }],
  },
};

describe("vault-native spreadsheet pages", () => {
  it("creates an empty native workbook and exposes the spreadsheet note type in the tree", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const parent = await createPage({
        sectionPath: "Notebook/Section",
        title: "Planning",
      });
      const page = await createPage({
        sectionPath: "Notebook/Section",
        title: "Budget",
        noteType: "spreadsheet",
        parentId: parent.path,
      });

      expect(page.metadata.note_type).toBe("spreadsheet");
      await expect(readSpreadsheetWorkbook(page.path)).resolves.toMatchObject({
        Workbook: { sheets: [{ name: "Sheet1" }] },
      });
      await expect(fs.readFile(path.join(vaultRoot, "Notebook", "Section", "budget.spreadsheet.json"), "utf8"))
        .resolves.toContain('"Workbook"');

      invalidateVaultTreeCacheForTesting();
      const tree = await readVaultTree();
      const treePage = tree.tree
        .flatMap((notebook) => notebook.sections)
        .flatMap((section) => section.pages)
        .find((candidate) => candidate.path === page.path);
      expect(treePage).toMatchObject({
        noteType: "spreadsheet",
        parentId: parent.path,
      });
    });
  });

  it("persists, snapshots, restores, renames, moves, and deletes the authoritative sidecar", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "Budget", noteType: "spreadsheet" });
      await writeSpreadsheetWorkbook(page.path, editedWorkbook);
      await snapshotSpreadsheetContent(page.path);
      await writeSpreadsheetWorkbook(page.path, {
        Workbook: { sheets: [{ name: "Changed", rows: [{ cells: [{ value: 99 }] }] }] },
      });

      const [version] = await listPageVersions(page.path, "spreadsheet");
      await restorePageVersion(page.path, version.id, "spreadsheet");
      await expect(readSpreadsheetWorkbook(page.path)).resolves.toEqual(editedWorkbook);

      const renamed = await renamePage(page.path, "Annual Budget");
      await expect(readSpreadsheetWorkbook(renamed.path)).resolves.toEqual(editedWorkbook);
      await expect(fs.stat(path.join(vaultRoot, "Notebook", "Section", "budget.spreadsheet.json"))).rejects.toMatchObject({ code: "ENOENT" });

      const moved = await movePage(renamed.path, "Notebook/Moved");
      await expect(readSpreadsheetWorkbook(moved.path)).resolves.toEqual(editedWorkbook);
      await deletePage(moved.path);
      await expect(fs.stat(path.join(vaultRoot, "Notebook", "Moved", "annual-budget.spreadsheet.json"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});
