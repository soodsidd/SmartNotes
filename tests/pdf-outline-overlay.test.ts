/**
 * @jest-environment node
 *
 * SN-198 — PDF outline must overlay the content viewport on every breakpoint.
 * An in-flow desktop rail shrinks the document area and causes zoom/place jumps
 * when TOC opens; this contract locks the overlay CSS so that regression cannot
 * silently return.
 */
import fs from "node:fs";
import path from "node:path";

const GLOBALS = path.resolve(__dirname, "../src/app/globals.css");

function outlineRuleBlock(css: string): string {
  // Grab the base `.pdf-reader__outline { ... }` block (not nested selectors).
  const match = css.match(/\.pdf-reader__outline\s*\{([^}]+)\}/);
  if (!match) throw new Error("Missing .pdf-reader__outline rule in globals.css");
  return match[1];
}

function backdropRuleBlock(css: string): string {
  const match = css.match(/\.pdf-reader__outline-backdrop\s*\{([^}]+)\}/);
  if (!match) {
    throw new Error("Missing .pdf-reader__outline-backdrop rule in globals.css");
  }
  return match[1];
}

describe("PDF outline overlay layout (SN-198)", () => {
  const css = fs.readFileSync(GLOBALS, "utf8");

  test("outline is absolutely positioned in the base rule (not only in a mobile media query)", () => {
    const block = outlineRuleBlock(css);
    expect(block).toMatch(/position:\s*absolute/);
    // Must not reclaim in-flow flex rail sizing that shrinks the viewport.
    expect(block).not.toMatch(/flex:\s*0\s+0\s+auto/);
  });

  test("dismissible backdrop is visible by default on all breakpoints", () => {
    const block = backdropRuleBlock(css);
    expect(block).toMatch(/display:\s*block/);
    expect(block).not.toMatch(/display:\s*none/);
  });

  test("reader source wires ZoomJump + always-close-on-select overlay path", () => {
    const reader = fs.readFileSync(
      path.resolve(__dirname, "../src/components/immersive-pdf-reader.tsx"),
      "utf8"
    );
    expect(reader).toContain("parseZoomPercent");
    expect(reader).toContain("pdf-reader-zoom-input");
    expect(reader).toContain("function ZoomJump");
    // Select always dismisses — no desktop-only keep-open rail path.
    expect(reader).toMatch(
      /jumpToOutlineTarget[\s\S]*?setOutlineOpen\(false\)/
    );
    expect(reader).not.toContain('matchMedia("(max-width: 640px)")');
  });
});
