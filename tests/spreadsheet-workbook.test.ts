import {
  csvToSpreadsheetWorkbook,
  normalizeSpreadsheetWorkbook,
  parseCsv,
  spreadsheetWorkbookToCsv,
} from "@/lib/spreadsheet-workbook";

describe("spreadsheet CSV adapters", () => {
  it("parses quoted commas, escaped quotes, and multiline cells", () => {
    expect(parseCsv('Name,Note\r\nAlice,"one, two"\r\nBob,"said ""hello""\nnext"')).toEqual([
      ["Name", "Note"],
      ["Alice", "one, two"],
      ["Bob", 'said "hello"\nnext'],
    ]);
  });

  it("imports CSV as Syncfusion native workbook JSON with useful scalar types", () => {
    const workbook = csvToSpreadsheetWorkbook("Name,Amount,Active,Formula\nWidget,12.5,true,=B2*2", "Imported");
    expect(normalizeSpreadsheetWorkbook(workbook).Workbook.sheets?.[0]).toMatchObject({
      name: "Imported",
      rows: [
        { cells: [{ value: "Name" }, { value: "Amount" }, { value: "Active" }, { value: "Formula" }] },
        { cells: [{ value: "Widget" }, { value: 12.5 }, { value: true }, { formula: "=B2*2" }] },
      ],
    });
  });

  it("unwraps the native Syncfusion 34.2.2 saveAsJson result", () => {
    const workbook = {
      Workbook: {
        activeSheetIndex: 0,
        sheets: [{ name: "Saved", rows: [{ cells: [{ value: "Header" }] }] }],
      },
    };

    expect(normalizeSpreadsheetWorkbook({ jsonObject: workbook })).toEqual(workbook);
  });

  it("exports the active sheet to valid CSV", () => {
    const csv = spreadsheetWorkbookToCsv({
      Workbook: {
        activeSheetIndex: 1,
        sheets: [
          { name: "Hidden", rows: [{ cells: [{ value: "skip" }] }] },
          {
            name: "Current",
            rows: [
              { cells: [{ value: "Name" }, { value: "Note" }] },
              { cells: [{ value: "Alice" }, { value: 'one, "two"' }] },
            ],
          },
        ],
      },
    });
    expect(csv).toBe('Name,Note\r\nAlice,"one, ""two"""');
  });

  it("rejects non-native workbook payloads", () => {
    expect(() => normalizeSpreadsheetWorkbook({ sheets: [] })).toThrow("Syncfusion native workbook JSON");
  });
});
