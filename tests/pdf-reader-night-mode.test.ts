/**
 * @jest-environment node
 *
 * SN-225 — PDF reader night mode inverts EmbedPDF page render/tile bitmaps
 * only. Annotation, search, and selection overlays must stay outside the
 * invert wrapper so ink/highlights are not double-inverted or washed out.
 */
import fs from "node:fs";
import path from "node:path";

const GLOBALS = path.resolve(__dirname, "../src/app/globals.css");
const READER = path.resolve(
  __dirname,
  "../src/components/immersive-pdf-reader.tsx"
);

function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Missing ${selector} rule in globals.css`);
  return match[1];
}

describe("PDF reader night mode invert scoping (SN-225)", () => {
  const css = fs.readFileSync(GLOBALS, "utf8");
  const reader = fs.readFileSync(READER, "utf8");

  test("invert applies only to the page-bitmap wrapper, not the page frame", () => {
    const bitmap = ruleBlock(
      css,
      '.pdf-reader__viewport[data-night-mode="on"] .pdf-reader__page-bitmap'
    );
    expect(bitmap).toMatch(/filter:\s*invert\(1\)/);

    const frame = ruleBlock(css, ".pdf-reader__page-frame");
    expect(frame).not.toMatch(/filter:\s*invert/);
    expect(css).not.toMatch(
      /\.pdf-reader__page-frame[^{]*\{[^}]*filter:\s*invert/
    );
  });

  test("annotation, search, and selection layers are siblings of the bitmap wrapper", () => {
    const bitmapBlock = reader.match(
      /className="pdf-reader__page-bitmap"[^>]*>[\s\S]*?<\/div>/
    );
    expect(bitmapBlock?.[0]).toBeTruthy();
    expect(bitmapBlock?.[0]).toContain("<RenderLayer");
    expect(bitmapBlock?.[0]).toContain("<TilingLayer");
    expect(bitmapBlock?.[0]).not.toContain("<AnnotationLayer");
    expect(bitmapBlock?.[0]).not.toContain("<SearchLayer");
    expect(bitmapBlock?.[0]).not.toContain("<SelectionLayer");

    expect(reader).toMatch(
      /className="pdf-reader__page-bitmap"[\s\S]*?<\/div>\s*<SearchLayer[\s\S]*?<SelectionLayer[\s\S]*?<AnnotationLayer/
    );
  });

  test("reader exposes a persistable night-mode control on desktop and mobile", () => {
    expect(reader).toContain('data-testid="pdf-reader-night-mode"');
    expect(reader).toContain("writePdfReaderNightModePref");
    expect(reader).toContain("resolvePdfReaderNightMode");
    expect(reader).toContain('data-night-mode={nightMode ? "on" : "off"}');
    expect(reader).not.toContain("pdf-reader__night-toggle pdf-reader__control--hide-narrow");
    expect(reader).not.toContain("pdf-reader__night-toggle pdf-reader__control--hide-phone");
  });
});
