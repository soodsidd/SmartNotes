import {
  applyCellWrites,
  columnIndexToLabel,
  columnLabelToIndex,
  formatCellRef,
  listWorksheets,
  parseCellRef,
  parseRange,
  readCellRange,
  SPREADSHEET_MAX_READ_CELLS,
  SPREADSHEET_MAX_WRITE_CELLS,
  SpreadsheetCellError,
  summarizeCells,
} from "@/lib/spreadsheet-cells";
import type { SpreadsheetWorkbook } from "@/lib/spreadsheet-workbook";

function sampleWorkbook(): SpreadsheetWorkbook {
  return {
    Workbook: {
      activeSheetIndex: 0,
      sheets: [
        {
          name: "Budget",
          selectedRange: "A1:B2",
          rows: [
            { index: 0, cells: [{ index: 0, value: "Item" }, { index: 1, value: "Cost" }] },
            { index: 1, cells: [{ index: 0, value: "Widget" }, { index: 1, value: 12.5 }] },
            { index: 2, cells: [{ index: 0, value: "Total" }, { index: 1, formula: "=SUM(B2:B2)" }] },
          ],
        },
        { name: "Notes", rows: [] },
      ],
    },
  };
}

describe("A1 addressing", () => {
  it("round-trips column labels and indices", () => {
    expect(columnLabelToIndex("A")).toBe(0);
    expect(columnLabelToIndex("Z")).toBe(25);
    expect(columnLabelToIndex("AA")).toBe(26);
    expect(columnLabelToIndex("AB")).toBe(27);
    expect(columnIndexToLabel(0)).toBe("A");
    expect(columnIndexToLabel(25)).toBe("Z");
    expect(columnIndexToLabel(26)).toBe("AA");
    expect(columnIndexToLabel(27)).toBe("AB");
  });

  it("parses and formats cell references", () => {
    expect(parseCellRef("A1")).toEqual({ row: 0, col: 0 });
    expect(parseCellRef("B3")).toEqual({ row: 2, col: 1 });
    expect(formatCellRef(2, 1)).toBe("B3");
  });

  it("normalizes reversed ranges and single cells", () => {
    expect(parseRange("C3:A1")).toEqual({ startRow: 0, startCol: 0, endRow: 2, endCol: 2 });
    expect(parseRange("B2")).toEqual({ startRow: 1, startCol: 1, endRow: 1, endCol: 1 });
  });

  it("rejects malformed references", () => {
    expect(() => parseCellRef("1A")).toThrow(SpreadsheetCellError);
    expect(() => parseRange("A1:")).toThrow(SpreadsheetCellError);
    expect(() => parseRange("A1:B2:C3")).toThrow(/invalid range/i);
  });
});

describe("listWorksheets", () => {
  it("reports name, used extent, and active flag", () => {
    expect(listWorksheets(sampleWorkbook())).toEqual([
      { index: 0, name: "Budget", rowCount: 3, columnCount: 2, isActive: true },
      { index: 1, name: "Notes", rowCount: 0, columnCount: 0, isActive: false },
    ]);
  });
});

describe("readCellRange", () => {
  it("returns only non-empty cells with values and formulas", () => {
    const result = readCellRange(sampleWorkbook(), { range: "A1:B3" });
    expect(result.sheet).toEqual({ index: 0, name: "Budget" });
    expect(result.cellCount).toBe(6);
    expect(result.nonEmptyCount).toBe(6);
    expect(result.cells).toContainEqual({ ref: "B2", row: 1, col: 1, value: 12.5 });
    expect(result.cells).toContainEqual({ ref: "B3", row: 2, col: 1, value: null, formula: "=SUM(B2:B2)" });
  });

  it("resolves a sheet by name and index", () => {
    expect(readCellRange(sampleWorkbook(), { sheet: "Notes", range: "A1" }).sheet.name).toBe("Notes");
    expect(readCellRange(sampleWorkbook(), { sheet: 1, range: "A1" }).sheet.index).toBe(1);
  });

  it("rejects an unknown sheet", () => {
    expect(() => readCellRange(sampleWorkbook(), { sheet: "Missing", range: "A1" })).toThrow(
      /not found/i
    );
  });

  it("rejects a range over the read limit", () => {
    // 2000-cell limit: A1:B1001 = 2 * 1001 = 2002 cells.
    expect(() => readCellRange(sampleWorkbook(), { range: "A1:B1001" })).toThrow(
      new RegExp(String(SPREADSHEET_MAX_READ_CELLS))
    );
  });
});

describe("applyCellWrites", () => {
  it("writes values and formulas without mutating the input workbook", () => {
    const workbook = sampleWorkbook();
    const snapshot = JSON.stringify(workbook);
    const result = applyCellWrites(workbook, {
      writes: [
        { ref: "B2", value: 42 },
        { ref: "C1", formula: "SUM(A1:B1)" },
      ],
    });
    // Input untouched.
    expect(JSON.stringify(workbook)).toBe(snapshot);
    // Value updated, formula gets a leading "=", stale value dropped.
    const reread = readCellRange(result.workbook, { range: "A1:C3" });
    expect(reread.cells).toContainEqual({ ref: "B2", row: 1, col: 1, value: 42 });
    expect(reread.cells).toContainEqual({ ref: "C1", row: 0, col: 2, value: null, formula: "=SUM(A1:B1)" });
    expect(result.applied).toEqual([
      { ref: "B2", row: 1, col: 1, value: 42 },
      { ref: "C1", row: 0, col: 2, formula: "=SUM(A1:B1)" },
    ]);
  });

  it("creates new sparse rows in sorted order", () => {
    const workbook: SpreadsheetWorkbook = { Workbook: { sheets: [{ name: "S", rows: [] }] } };
    const result = applyCellWrites(workbook, {
      writes: [
        { ref: "A5", value: "five" },
        { ref: "A2", value: "two" },
      ],
    });
    const rows = result.workbook.Workbook.sheets![0]!.rows as Array<{ index?: number }>;
    expect(rows.map((row) => row.index)).toEqual([1, 4]);
  });

  it("clears a cell", () => {
    const result = applyCellWrites(sampleWorkbook(), { writes: [{ ref: "B2", clear: true }] });
    const reread = readCellRange(result.workbook, { range: "B2" });
    expect(reread.nonEmptyCount).toBe(0);
    expect(result.applied[0]).toEqual({ ref: "B2", row: 1, col: 1, cleared: true });
  });

  it("rejects an empty batch, a bad entry, and an oversized batch", () => {
    expect(() => applyCellWrites(sampleWorkbook(), { writes: [] })).toThrow(SpreadsheetCellError);
    expect(() => applyCellWrites(sampleWorkbook(), { writes: [{ ref: "A1" }] })).toThrow(
      /value.*formula.*clear/i
    );
    expect(() =>
      applyCellWrites(sampleWorkbook(), { writes: [{ ref: "A1", value: 1, formula: "=1" }] })
    ).toThrow(/exactly one/i);
    const tooMany = Array.from({ length: SPREADSHEET_MAX_WRITE_CELLS + 1 }, (_, i) => ({
      ref: `A${i + 1}`,
      value: i,
    }));
    expect(() => applyCellWrites(sampleWorkbook(), { writes: tooMany })).toThrow(
      new RegExp(String(SPREADSHEET_MAX_WRITE_CELLS))
    );
  });
});

describe("summarizeCells", () => {
  it("summarizes numeric and text cells over the used range", () => {
    const result = summarizeCells(sampleWorkbook(), {});
    expect(result.source).toBe("used");
    expect(result.nonEmptyCount).toBe(6);
    expect(result.numericCount).toBe(1);
    expect(result.textCount).toBe(4);
    expect(result.formulaCount).toBe(1);
    expect(result.sum).toBe(12.5);
    expect(result.min).toBe(12.5);
    expect(result.max).toBe(12.5);
    expect(result.average).toBe(12.5);
  });

  it("summarizes an explicit range and the active selection", () => {
    expect(summarizeCells(sampleWorkbook(), { range: "B2:B2" }).source).toBe("range");
    const selection = summarizeCells(sampleWorkbook(), { selection: true });
    expect(selection.source).toBe("selection");
    expect(selection.range).toBe("A1:B2");
  });

  it("errors when a selection summary is requested with no recorded selection", () => {
    const workbook: SpreadsheetWorkbook = { Workbook: { sheets: [{ name: "S", rows: [] }] } };
    expect(() => summarizeCells(workbook, { selection: true })).toThrow(/selection/i);
  });
});

// SN-223: Syncfusion serializes sparse rows/cells positionally and pads empty
// slots with `null`. A workbook holding an image (or any cell) at a high column
// therefore emits null-padded cell arrays. Before the null-guard fix these nulls
// crashed every tool (usedDimensions/findCell/insertSorted) with a TypeError that
// surfaced as an opaque INTERNAL_ERROR. This fixture mirrors that shape — including
// a base64 image cell carrying no value/formula and a null row placeholder.
function nullPaddedImageWorkbook(): SpreadsheetWorkbook {
  return {
    Workbook: {
      activeSheetIndex: 0,
      sheets: [
        {
          name: "BOM",
          rows: [
            // Header row: text at cols 0 and 2, null padding at col 1.
            { cells: [{ value: "Part" }, null, { value: "Qty" }] as never },
            null as never, // Syncfusion null row placeholder.
            // Data row with a leading null-padded gap before the numeric cell.
            { cells: [{ value: "Servo" }, null, { value: 6 }] as never },
            // Image cell (base64) with no value/formula, preceded by null padding.
            { cells: [null, null, null, { image: [{ src: "data:image/png;base64,iVBORw0KGgoAAA" }] }] as never },
          ],
        },
      ],
    },
  };
}

describe("SN-223 null-padded / image-heavy workbooks", () => {
  it("lists worksheets without dereferencing null cells or rows", () => {
    const sheets = listWorksheets(nullPaddedImageWorkbook());
    expect(sheets).toHaveLength(1);
    // Used extent covers the value cells (rows 0 & 2, cols 0-2); the image-only
    // cell carries no value/formula so it does not extend the used range.
    expect(sheets[0]).toMatchObject({ name: "BOM", rowCount: 3, columnCount: 3 });
  });

  it("reads a range spanning null gaps, returning only real cells", () => {
    const result = readCellRange(nullPaddedImageWorkbook(), { range: "A1:C4" });
    expect(result.nonEmptyCount).toBe(4);
    expect(result.cells.map((cell) => cell.value)).toEqual(["Part", "Qty", "Servo", 6]);
  });

  it("summarizes across null gaps without throwing", () => {
    const summary = summarizeCells(nullPaddedImageWorkbook(), { range: "A1:C4" });
    expect(summary.nonEmptyCount).toBe(4);
    expect(summary.numericCount).toBe(1);
    expect(summary.sum).toBe(6);
  });

  it("writes into a null-padded row/column and preserves the image blob", () => {
    const workbook = nullPaddedImageWorkbook();
    const { workbook: next, applied } = applyCellWrites(workbook, {
      writes: [{ ref: "B1", value: "unit" }, { ref: "H3", value: 42 }],
    });
    expect(applied).toHaveLength(2);
    // The write landed at the previously-null column without shifting neighbors.
    const reread = readCellRange(next, { range: "A1:H3" });
    expect(reread.cells.find((cell) => cell.ref === "B1")?.value).toBe("unit");
    expect(reread.cells.find((cell) => cell.ref === "H3")?.value).toBe(42);
    expect(reread.cells.find((cell) => cell.ref === "A1")?.value).toBe("Part");
    expect(reread.cells.find((cell) => cell.ref === "C1")?.value).toBe("Qty");
    // The image cell must survive the write (cell tools never strip image blobs).
    const imageCell = (next.Workbook.sheets as Array<{ rows: Array<{ cells?: unknown[] } | null> }>)[0]!
      .rows[3] as { cells?: Array<{ image?: unknown } | null> };
    expect(imageCell.cells?.[3]).toMatchObject({ image: expect.anything() });
    // Input workbook stays untouched.
    expect(workbook.Workbook.sheets![0]!.rows![0]!.cells).toHaveLength(3);
  });
});
