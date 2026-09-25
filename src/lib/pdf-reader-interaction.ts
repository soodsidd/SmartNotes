export type PdfReaderTool = "pan" | "ink" | "highlight" | "eraser";

/**
 * EmbedPDF's page provider owns selection and annotation pointer gestures.
 * Document-first modes keep touch available to the native scroller, while
 * mouse/pen input and Highlight's established touch handoff reach EmbedPDF.
 */
export function shouldPreservePdfFingerNavigation({
  annotateMode,
  activeTool,
  pointerType,
}: {
  annotateMode: boolean;
  activeTool: PdfReaderTool;
  pointerType: string;
}): boolean {
  return (
    pointerType === "touch" &&
    (!annotateMode || activeTool !== "highlight")
  );
}

export type PdfTapTurn = "previous" | "next";

/** Recognize a conservative, single-pointer tap in an outer reader zone. */
export function resolvePdfTapTurn({
  annotateMode,
  multiTouch,
  button,
  modified,
  elapsedMs,
  startX,
  startY,
  endX,
  endY,
  surfaceLeft,
  surfaceWidth,
}: {
  annotateMode: boolean;
  multiTouch: boolean;
  button: number;
  modified: boolean;
  elapsedMs: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  surfaceLeft: number;
  surfaceWidth: number;
}): PdfTapTurn | null {
  if (
    annotateMode ||
    multiTouch ||
    button !== 0 ||
    modified ||
    elapsedMs > 600 ||
    surfaceWidth <= 0 ||
    Math.hypot(endX - startX, endY - startY) > 10
  ) {
    return null;
  }
  const relativeX = startX - surfaceLeft;
  if (relativeX >= 0 && relativeX <= surfaceWidth * 0.2) return "previous";
  if (relativeX >= surfaceWidth * 0.8 && relativeX <= surfaceWidth) return "next";
  return null;
}
