import fs from "node:fs";
import path from "node:path";

const shellSource = fs.readFileSync(
  path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"),
  "utf8"
);

describe("page package UI contract", () => {
  it("exposes text-page export and section import through the shared responsive sidebar", () => {
    expect(shellSource).toContain("Export page package");
    expect(shellSource).toContain("Import page package");
    expect(shellSource).toContain('accept=".snpkg,application/vnd.smart-notes.page+zip"');
    expect(shellSource).toContain('node.page.noteType !== "text"');
    expect(shellSource).toContain("onImportPagePackage={openPagePackageImportPicker}");
    expect(shellSource).toContain("onExportPagePackage={() => void handleExportCurrentPagePackage()}");
  });
});
