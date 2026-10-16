import fs from "node:fs/promises";
import path from "node:path";
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  DESIGN_CONTENT_HEIGHT_EXPRESSION,
  measureDesignPages,
} from "@/lib/design-pagination";

const FIXTURE = path.resolve(__dirname, "..", "e2e", "fixtures", "sn-304-resume-template.html");
/** CSS px per PDF point (96 CSS px/in, 72 pt/in). */
const CSS_PX_PER_PT = 96 / 72;
const GUIDE_PDF_TOLERANCE_CSS_PX = 2;

/** Chromium page dicts expose MediaBox in the uncompressed PDF object stream. */
function extractPdfPageHeightsPt(pdfBytes: Uint8Array): number[] {
  const src = Buffer.from(pdfBytes).toString("latin1");
  const boxes = [...src.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  return boxes.map((match) => Math.abs(Number(match[4]) - Number(match[2])));
}

/**
 * SN-319 AC1: on the real resume fixture, Preview mathematical guide Y must match
 * Export PDF page-box edges within ≤2 CSS px. Mirrors renderDesignToPdf viewport,
 * screen media, zero margins, and CSS-px page box.
 *
 * Uses MediaBox parsing (not pdfjs) so Jest can run without ESM import.meta.
 */
describe("SN-319 design PDF guide alignment (resume fixture)", () => {
  it(
    "guide boundaries match exported PDF page edges within 2 CSS px",
    async () => {
      const html = (await fs.readFile(FIXTURE, "utf8"))
        .replaceAll("{{ name }}", "Leo Alignment")
        .replace("{{ profile_paragraph }}", "A4 preview layout. ".repeat(420));

      const base = `<base href="http://127.0.0.1/"><style>@page{size:A4;margin:0!important}</style>`;
      const documentHtml = /<\/head>/i.test(html)
        ? html.replace(/<\/head>/i, `${base}</head>`)
        : `<!doctype html><html><head>${base}</head><body>${html}</body></html>`;

      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: A4_WIDTH_PX, height: Math.ceil(A4_HEIGHT_PX) },
        });
        await page.emulateMedia({ media: "screen" });
        await page.setContent(documentHtml, { waitUntil: "load", timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);

        const contentHeightPx = await page.evaluate<number>(DESIGN_CONTENT_HEIGHT_EXPRESSION);
        expect(contentHeightPx).toBeGreaterThan(A4_HEIGHT_PX);

        const measurement = measureDesignPages(contentHeightPx);
        expect(measurement.pages).toBeGreaterThan(1);
        expect(measurement.boundaries.length).toBe(measurement.pages - 1);

        const pdfBytes = await page.pdf({
          width: `${A4_WIDTH_PX}px`,
          height: `${A4_HEIGHT_PX}px`,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
          printBackground: true,
          preferCSSPageSize: false,
        });

        const pageHeightsPt = extractPdfPageHeightsPt(pdfBytes);
        expect(pageHeightsPt.length).toBe(measurement.pages);

        const pageHeightsCssPx = pageHeightsPt.map((heightPt) => heightPt * CSS_PX_PER_PT);
        for (const heightCssPx of pageHeightsCssPx) {
          expect(Math.abs(heightCssPx - A4_HEIGHT_PX)).toBeLessThanOrEqual(GUIDE_PDF_TOLERANCE_CSS_PX);
          expect(Math.abs(heightCssPx / CSS_PX_PER_PT - A4_HEIGHT_PX * (72 / 96))).toBeLessThanOrEqual(1);
        }

        let cumulativeEdgeY = 0;
        for (let index = 0; index < measurement.boundaries.length; index += 1) {
          cumulativeEdgeY += pageHeightsCssPx[index]!;
          const guideY = measurement.boundaries[index]!;
          expect(Math.abs(guideY - cumulativeEdgeY)).toBeLessThanOrEqual(GUIDE_PDF_TOLERANCE_CSS_PX);
          expect(Math.abs(guideY - (index + 1) * A4_HEIGHT_PX)).toBeLessThanOrEqual(
            GUIDE_PDF_TOLERANCE_CSS_PX,
          );
        }
      } finally {
        await browser.close().catch(() => undefined);
      }
    },
    120_000,
  );
});
