import fs from "node:fs";
import path from "node:path";

describe("spreadsheet tree controls", () => {
  it("creates a child Spreadsheet from the page right-click menu", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );
    const testId = "page-context-create-spreadsheet-${pageContextMenu.pagePath}";
    const markerIndex = source.indexOf(testId);

    expect(markerIndex).toBeGreaterThan(-1);

    const buttonStart = source.lastIndexOf("<button", markerIndex);
    const buttonEnd = source.indexOf("</button>", markerIndex);
    const buttonSource = source.slice(buttonStart, buttonEnd);

    expect(buttonSource).toContain("onCreateSpreadsheetPage({");
    expect(buttonSource).toContain("parentId: pageContextMenu.pagePath");
    expect(buttonSource).toContain("sectionPath: pageContextMenu.sectionPath ?? null");
    expect(buttonSource).toContain("New child spreadsheet");
  });
});
