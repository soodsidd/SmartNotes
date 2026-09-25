import fs from "node:fs";
import path from "node:path";

describe("mobile draw runtime contract", () => {
  function readSource(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  }

  it("keeps touch-action none scoped to the interactive annotation host", () => {
    const source = readSource("src/components/annotation-layer.tsx");

    expect(source).toContain('style={interactive ? { touchAction: "none" } : undefined}');
    expect(source).toContain("touch-action:none hands touch events to Tldraw");
  });

  it("keeps touch-action none scoped to the sticky ink clip in draw mode", () => {
    const source = readSource("src/components/rich-text-editor.tsx");

    expect(source).toContain('...(isDrawMode ? { touchAction: "none" } : {})');
    expect(source).toContain("page scroll before Tldraw can use them for drawing");
  });

  it("keeps local env files ignored so the tldraw SDK key is never committed", () => {
    const source = readSource(".gitignore");

    expect(source).toContain(".env.local");
  });

  it("keeps the local production build compatibility fallbacks in place", () => {
    const config = readSource("next.config.mjs");
    const documentPage = readSource("src/pages/_document.tsx");
    const errorPage = readSource("src/pages/500.tsx");

    expect(config).toContain("outputFileTracing: false");
    expect(documentPage).toContain("NextScript");
    expect(errorPage).toContain("export default function Custom500");
    expect(errorPage).toContain("return <div />");
  });
});
