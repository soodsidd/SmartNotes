/**
 * Positioned PDF page-text extraction for highlight quote reconstruction (SN-218).
 *
 * Companion annotation context reconstructs the marked source text under a
 * highlight from the sidecar's `segmentRects` geometry. That needs positioned
 * page text, which pdf-parse's plain `getText()` does not expose, so this module
 * reads glyph runs directly from pdfjs.
 *
 * The runs are returned in EmbedPDF's annotation coordinate space — top-left
 * origin, y growing downward, unscaled PDF points — by applying the scale-1
 * viewport transform. Verified against a probe PDF: text at user-space baseline
 * (20, 170) on a 200-tall page maps to top-left (x 20, yTop 18), matching the
 * geometry EmbedPDF stores. Any failure returns null so the caller degrades to an
 * honest "marked text unavailable" rather than inventing a passage.
 */

import fs from "node:fs/promises";
import type { HighlightGeometryTextItem } from "@/lib/pdf-annotations";

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let cachedPdfjs: PdfjsModule | null | undefined;

async function getPdfjs(): Promise<PdfjsModule | null> {
  if (cachedPdfjs !== undefined) {
    return cachedPdfjs;
  }
  try {
    cachedPdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    cachedPdfjs = null;
  }
  return cachedPdfjs;
}

/**
 * Extract positioned text runs for one 1-based page. Returns null when pdfjs is
 * unavailable, the page is out of range, extraction throws, or the page has no
 * extractable text (image-only) — every one of which the caller treats as
 * "marked text could not be recovered".
 */
export async function extractPdfPageTextItems(
  absolutePath: string,
  page: number
): Promise<HighlightGeometryTextItem[] | null> {
  if (!Number.isInteger(page) || page < 1) {
    return null;
  }
  const pdfjs = await getPdfjs();
  if (!pdfjs) {
    return null;
  }

  let doc: Awaited<ReturnType<PdfjsModule["getDocument"]>["promise"]> | null = null;
  try {
    const data = new Uint8Array(await fs.readFile(absolutePath));
    doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: false,
      // Text extraction needs no rendering fonts; keep it network-free & quiet.
      disableFontFace: true,
    }).promise;

    if (page > doc.numPages) {
      return null;
    }

    const pdfPage = await doc.getPage(page);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const content = await pdfPage.getTextContent();
    const items: HighlightGeometryTextItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string" || !raw.str) {
        continue;
      }
      const tx = pdfjs.Util.transform(viewport.transform, raw.transform);
      const height = Math.hypot(tx[2], tx[3]) || Math.abs(raw.height) || 0;
      const width = raw.width;
      if (!(width > 0) || !(height > 0)) {
        continue;
      }
      // tx[4]/tx[5] are the run's viewport-space origin (baseline). Convert the
      // baseline to the run's top edge so the box matches highlight geometry.
      items.push({ text: raw.str, x: tx[4], y: tx[5] - height, width, height });
    }
    return items.length > 0 ? items : null;
  } catch {
    return null;
  } finally {
    try {
      await doc?.destroy();
    } catch {
      // Ignore teardown failures — the extracted items (if any) are already returned.
    }
  }
}
