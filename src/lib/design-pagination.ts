/**
 * Shared A4 layout contract for Preview guides and Export PDF (SN-304 / SN-319).
 *
 * Playwright viewports require integer CSS px, so both Preview and `renderDesignToPdf`
 * use the same rounded width. Page height is derived from that width so guide Y
 * positions and the PDF page box share one aspect ratio (no 793.7 vs 794 drift).
 *
 * Guide model: mathematical A4-height strips (not CSS-fragmentation-aware). Export
 * uses screen media with `@page{margin:0}`, so print-only `page-break-*` /
 * `break-inside` rules do not apply; geometric page-box boundaries match the strips.
 */
export const A4_WIDTH_PX = Math.round((210 / 25.4) * 96);
export const A4_HEIGHT_PX = (A4_WIDTH_PX * 297) / 210;

/**
 * Intrinsic document height, evaluated inside the rendered document by both the
 * Preview frame and the headless PDF preflight. Unlike documentElement.scrollHeight
 * it is not floored at the viewport height, so it shrinks when the layout widens.
 */
export const DESIGN_CONTENT_HEIGHT_EXPRESSION = `(() => {
  const root = document.documentElement;
  const body = document.body;
  if (!root) return 0;
  let height = root.getBoundingClientRect().height;
  if (body) {
    const style = getComputedStyle(body);
    height = Math.max(height, body.scrollHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0));
  }
  return Math.ceil(height);
})()`;

export interface DesignPageMeasurement {
  pages: number;
  pageHeightPx: number;
  boundaries: number[];
  contentHeightPx: number;
}

/** The print path uses A4 with zero margins and screen media at the same width. */
export function measureDesignPages(contentHeightPx: number, widthPx = A4_WIDTH_PX): DesignPageMeasurement {
  const pageHeightPx = widthPx === A4_WIDTH_PX ? A4_HEIGHT_PX : widthPx * (297 / 210);
  const height = Math.max(0, contentHeightPx);
  const pages = Math.max(1, Math.ceil((height - 0.5) / pageHeightPx));
  return {
    pages,
    pageHeightPx,
    boundaries: Array.from({ length: pages - 1 }, (_, index) => (index + 1) * pageHeightPx),
    contentHeightPx: height,
  };
}
