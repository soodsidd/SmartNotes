describe("page print stylesheet", () => {
  test("globals.css defines SN-12 print rules for chrome hiding and page breaks", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toContain("@media print");
    expect(css).toContain("page-print-active");
    expect(css).toContain('[data-testid="tree-sidebar-rail"]');
    expect(css).toContain(".print-page-header");
    expect(css).toContain("break-inside: avoid-page");
    expect(css).toContain(".editor-image");
    expect(css).toContain(".dark {");
    expect(css).toContain("body.page-print-active .editor-content > h1:first-child");
    expect(css).toContain('[data-testid="app-shell"]');
  });

  test("globals.css hides the JS-marked leading h1 (SN-96 title de-duplication)", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

    // Both the CSS-only selector (fallback) and the JS-driven attribute must suppress the leading h1.
    expect(css).toContain("body.page-print-active [data-print-leading-h1]");
  });
});
