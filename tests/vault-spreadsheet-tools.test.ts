import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPage, invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";
import { readSpreadsheetWorkbook, writeSpreadsheetWorkbook } from "@/server/vault/spreadsheet";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import { executeVaultTool } from "@/server/vault/agent-tools";
import { listPageVersions } from "@/server/vault/versions";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-sheet-tools-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-sheet-tools-state-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
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

async function createSeededSpreadsheet() {
  const page = await createPage({ sectionPath: "Notebook/Section", title: "Budget", noteType: "spreadsheet" });
  await writeSpreadsheetWorkbook(page.path, {
    Workbook: {
      activeSheetIndex: 0,
      sheets: [
        {
          name: "Budget",
          rows: [
            { index: 0, cells: [{ index: 0, value: "Item" }, { index: 1, value: "Cost" }] },
            { index: 1, cells: [{ index: 0, value: "Widget" }, { index: 1, value: 10 }] },
            { index: 2, cells: [{ index: 0, value: "Gadget" }, { index: 1, value: 20 }] },
          ],
        },
        { name: "Notes", rows: [] },
      ],
    },
  });
  return page;
}

describe("spreadsheet companion commands (SN-209)", () => {
  it("lists worksheets with used extent", async () => {
    await withVaultFixture(async () => {
      const page = await createSeededSpreadsheet();
      const result = await executeVaultCommand({
        group: "spreadsheet",
        action: "list_sheets",
        args: { path: page.path },
      });
      expect(result.data).toMatchObject({
        sheets: [
          { index: 0, name: "Budget", rowCount: 3, columnCount: 2, isActive: true },
          { index: 1, name: "Notes", rowCount: 0, columnCount: 0, isActive: false },
        ],
      });
    });
  });

  it("reads a bounded range", async () => {
    await withVaultFixture(async () => {
      const page = await createSeededSpreadsheet();
      const result = await executeVaultCommand({
        group: "spreadsheet",
        action: "read_range",
        args: { path: page.path, range: "A1:B3" },
      });
      const data = result.data as { nonEmptyCount: number; cells: Array<{ ref: string; value: unknown }> };
      expect(data.nonEmptyCount).toBe(6);
      expect(data.cells).toContainEqual({ ref: "B2", row: 1, col: 1, value: 10 });
    });
  });

  it("writes cells + formulas, persists to the sidecar, snapshots, and emits a spreadsheet file update", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createSeededSpreadsheet();
      const result = await executeVaultCommand({
        group: "spreadsheet",
        action: "write_cells",
        args: {
          path: page.path,
          writes: [
            { ref: "A4", value: "Total" },
            { ref: "B4", formula: "=SUM(B2:B3)" },
          ],
        },
      });

      expect(result.fileUpdated).toEqual({ path: page.path, content: "", kind: "spreadsheet" });
      expect(result.data).toMatchObject({ appliedCount: 2, sheet: { name: "Budget" } });

      // Persisted to the authoritative Syncfusion JSON sidecar.
      const persisted = await readSpreadsheetWorkbook(page.path);
      const total = persisted.Workbook.sheets![0]!.rows!.find((row) => row.index === 3);
      expect(total?.cells).toContainEqual({ index: 0, value: "Total" });
      expect(total?.cells).toContainEqual({ index: 1, formula: "=SUM(B2:B3)" });

      // Raw sidecar file reflects the write.
      const raw = await fs.readFile(
        path.join(vaultRoot, "Notebook", "Section", "budget.spreadsheet.json"),
        "utf8"
      );
      expect(raw).toContain("=SUM(B2:B3)");

      // Prior workbook was snapshotted for versions.
      const versions = await listPageVersions(page.path, "spreadsheet");
      expect(versions.length).toBeGreaterThan(0);
    });
  });

  it("summarizes numeric cells", async () => {
    await withVaultFixture(async () => {
      const page = await createSeededSpreadsheet();
      const result = await executeVaultCommand({
        group: "spreadsheet",
        action: "summarize",
        args: { path: page.path, range: "B2:B3" },
      });
      expect(result.data).toMatchObject({ numericCount: 2, sum: 30, min: 10, max: 20, average: 15 });
    });
  });

  it("rejects a non-spreadsheet page and an oversized range", async () => {
    await withVaultFixture(async () => {
      const textPage = await createPage({ sectionPath: "Notebook/Section", title: "Plain" });
      await expect(
        executeVaultCommand({ group: "spreadsheet", action: "read_range", args: { path: textPage.path, range: "A1" } })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      const page = await createSeededSpreadsheet();
      await expect(
        executeVaultCommand({
          group: "spreadsheet",
          action: "read_range",
          args: { path: page.path, range: "A1:B1001" },
        })
      ).rejects.toMatchObject({ code: "RANGE_TOO_LARGE" });
    });
  });

  it("is reachable through the executeVaultTool adapter", async () => {
    await withVaultFixture(async () => {
      const page = await createSeededSpreadsheet();
      const outcome = await executeVaultTool("spreadsheet_write_cells", {
        path: page.path,
        writes: [{ ref: "C1", value: "note" }],
      });
      expect(outcome.ok).toBe(true);
      const reread = await executeVaultTool("spreadsheet_read_range", { path: page.path, range: "C1" });
      expect(outcome.ok && reread.ok).toBe(true);
    });
  });

  // SN-223: Syncfusion writes image-heavy / sparse workbooks with `null`-padded
  // cell (and row) arrays. Before the null-guard fix these crashed every cell tool
  // with a TypeError that surfaced as an opaque 500 INTERNAL_ERROR. This seeds a
  // sidecar in that exact shape and drives the real tools end to end.
  async function createNullPaddedImageSpreadsheet() {
    const page = await createPage({ sectionPath: "Notebook/Section", title: "BOM", noteType: "spreadsheet" });
    await writeSpreadsheetWorkbook(page.path, {
      Workbook: {
        activeSheetIndex: 0,
        sheets: [
          {
            name: "BOM",
            rows: [
              { cells: [{ value: "Part" }, null, { value: "Qty" }] },
              null,
              { cells: [{ value: "Servo" }, null, { value: 6 }] },
              { cells: [null, null, null, { image: [{ src: "data:image/png;base64,iVBORw0KGgoAAA" }] }] },
            ],
          },
        ],
      },
    });
    return page;
  }

  it("does not INTERNAL_ERROR on a null-padded / image-heavy workbook (reads + write)", async () => {
    await withVaultFixture(async () => {
      const page = await createNullPaddedImageSpreadsheet();

      const listed = await executeVaultTool("spreadsheet_list_sheets", { path: page.path });
      expect(listed.ok).toBe(true);

      const read = await executeVaultTool("spreadsheet_read_range", { path: page.path, range: "A1:C4" });
      expect(read.ok).toBe(true);

      const summary = await executeVaultTool("spreadsheet_summarize", { path: page.path, range: "A1:C4" });
      expect(summary.ok).toBe(true);

      // Small H/I write batch on two rows (mirrors the owner's Alternatives repro),
      // targeting previously-null columns.
      const written = await executeVaultTool("spreadsheet_write_cells", {
        path: page.path,
        writes: [{ ref: "H3", value: "alt" }, { ref: "I4", value: 99 }],
      });
      expect(written.ok).toBe(true);

      const reread = await executeVaultTool("spreadsheet_read_range", { path: page.path, range: "H3:I4" });
      expect(reread.ok).toBe(true);
      const cells = ((reread as { result: { data: { cells: Array<{ ref: string; value: unknown }> } } })
        .result.data).cells;
      expect(cells).toContainEqual({ ref: "H3", row: 2, col: 7, value: "alt" });
      expect(cells).toContainEqual({ ref: "I4", row: 3, col: 8, value: 99 });

      // The base64 image blob must survive the write — cell tools never strip it.
      const persisted = await readSpreadsheetWorkbook(page.path);
      const imageRow = persisted.Workbook.sheets![0]!.rows![3] as { cells?: Array<{ image?: unknown } | null> };
      expect(imageRow.cells?.some((cell) => cell && cell.image)).toBe(true);
    });
  });
});
