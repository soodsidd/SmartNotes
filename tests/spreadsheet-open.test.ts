import fs from "node:fs";
import path from "node:path";
import {
  SPREADSHEET_ALLOW_OPEN,
  toSpreadsheetOpenFromJsonArgs,
} from "@/lib/spreadsheet-open";
import { createEmptySpreadsheetWorkbook } from "@/lib/spreadsheet-workbook";

describe("spreadsheet openFromJson contract (SN-214)", () => {
  it("keeps Syncfusion allowOpen enabled so vault reopen is not a silent no-op", () => {
    // Syncfusion 34.x skips workbookOpen/open modules when allowOpen is false.
    expect(SPREADSHEET_ALLOW_OPEN).toBe(true);

    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/components/spreadsheet-page-view.tsx"),
      "utf8"
    );
    expect(source).toContain("allowOpen={SPREADSHEET_ALLOW_OPEN}");
    expect(source).not.toMatch(/allowOpen=\{false\}/);
  });

  it("passes the normalized Workbook model as openFromJson file", () => {
    const workbook = createEmptySpreadsheetWorkbook();
    workbook.Workbook.sheets = [
      { name: "Sheet1", rows: [{ cells: [{ value: "Header" }, { value: "Test" }] }] },
    ];

    expect(toSpreadsheetOpenFromJsonArgs(workbook)).toEqual({ file: workbook });
    expect(toSpreadsheetOpenFromJsonArgs(workbook).file.Workbook.sheets?.[0]).toMatchObject({
      name: "Sheet1",
      rows: [{ cells: [{ value: "Header" }, { value: "Test" }] }],
    });
  });
});
