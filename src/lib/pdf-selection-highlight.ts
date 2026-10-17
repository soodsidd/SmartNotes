/**
 * SN-334: Highlight from the PDF selection menu. Builds the same annotation
 * EmbedPDF's own highlight tool creates on selection end (tool defaults, the
 * selection rect/segmentRects, and the marked text in custom.text), so the
 * sidecar, Record, comment and Undo paths treat both identically.
 */

export interface PdfRect {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

export interface PdfPageSelection {
  pageIndex: number;
  rect: PdfRect;
  segmentRects: PdfRect[];
}

export interface PdfHighlightLike {
  type?: number;
  segmentRects?: PdfRect[];
}

/** Sub-point slack: re-selecting the same glyph run can shift by rounding. */
const COVER_TOLERANCE_PT = 1;

function covers(outer: PdfRect, inner: PdfRect, tolerance: number): boolean {
  return (
    inner.origin.x >= outer.origin.x - tolerance &&
    inner.origin.y >= outer.origin.y - tolerance &&
    inner.origin.x + inner.size.width <= outer.origin.x + outer.size.width + tolerance &&
    inner.origin.y + inner.size.height <= outer.origin.y + outer.size.height + tolerance
  );
}

/**
 * True when every segment of the selection already sits inside an existing
 * highlight on that page, so invoking Highlight again would only stack a
 * duplicate. Partial overlaps still create a new highlight.
 */
export function isSelectionAlreadyHighlighted(
  selection: PdfPageSelection,
  existing: PdfHighlightLike[],
  highlightType: number
): boolean {
  if (!selection.segmentRects.length) return false;
  const marked = existing
    .filter((annotation) => annotation.type === highlightType)
    .flatMap((annotation) => annotation.segmentRects ?? []);
  if (!marked.length) return false;
  return selection.segmentRects.every((segment) =>
    marked.some((rect) => covers(rect, segment, COVER_TOLERANCE_PT))
  );
}

export function buildSelectionHighlight<TDefaults extends object>(
  selection: PdfPageSelection,
  defaults: TDefaults,
  id: string,
  text: string | null,
  created: Date = new Date()
) {
  return {
    ...defaults,
    rect: selection.rect,
    segmentRects: selection.segmentRects,
    pageIndex: selection.pageIndex,
    created,
    id,
    ...(text ? { custom: { text } } : {}),
  };
}

/** Finger slack around thin highlight lines, in PDF points. */
const TAP_SLOP_PT = 4;

/**
 * Topmost highlight whose marked segments contain a PDF-space tap point.
 * Read mode keeps touch away from EmbedPDF so the browser owns pan/pinch;
 * a deliberate finger tap uses this to open the tapped highlight's dish.
 */
export function findHighlightAtPoint(
  annotations: Array<PdfHighlightLike & { id?: string }>,
  x: number,
  y: number,
  highlightType: number
): string | null {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const annotation = annotations[i];
    if (annotation.type !== highlightType || !annotation.id) continue;
    const hit = (annotation.segmentRects ?? []).some((rect) =>
      x >= rect.origin.x - TAP_SLOP_PT &&
      x <= rect.origin.x + rect.size.width + TAP_SLOP_PT &&
      y >= rect.origin.y - TAP_SLOP_PT &&
      y <= rect.origin.y + rect.size.height + TAP_SLOP_PT
    );
    if (hit) return annotation.id;
  }
  return null;
}
