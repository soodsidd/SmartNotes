/** Minimum blank drawable margin below text content (OneNote-style page extension). */
export const MIN_BOTTOM_CANVAS_PADDING_PX = 800;

/**
 * Blank drawable space kept below the lowest ink stroke. OneNote-style: after
 * drawing in empty space the canvas always extends past the last stroke, so the
 * user can scroll further and keep drawing. Used as the floor when a viewport
 * height is unknown.
 */
export const AUTO_GROW_BOTTOM_MARGIN_PX = 600;

export function defaultBottomCanvasPadding(viewportHeight: number): number {
  return Math.max(viewportHeight, MIN_BOTTOM_CANVAS_PADDING_PX);
}

/**
 * Generous blank margin kept below the lowest stroke, scaled to the viewport so
 * there is always roughly one screen of empty canvas past the last stroke.
 */
export function autoGrowBottomMargin(viewportHeight: number): number {
  return Math.max(Math.round(viewportHeight * 0.9), AUTO_GROW_BOTTOM_MARGIN_PX);
}

export function computePageFrameHeight(input: {
  textHeight: number;
  viewportHeight: number;
  drawableBottom?: number;
  bottomCanvasPadding?: number;
}): number {
  const contentBase = Math.max(input.textHeight, input.viewportHeight);
  const padding =
    input.bottomCanvasPadding ?? defaultBottomCanvasPadding(input.viewportHeight);
  const padded = contentBase + padding;
  const extent = input.drawableBottom ?? 0;
  return Math.max(padded, extent);
}

/**
 * Grow whenever the blank space below the lowest stroke is smaller than the
 * desired margin — i.e. the user has drawn close enough to (or past) the current
 * bottom that they can no longer scroll a full margin beyond their last stroke.
 */
export function shouldAutoGrowDrawableBottom(
  strokeBottom: number,
  currentFrameHeight: number,
  margin: number = AUTO_GROW_BOTTOM_MARGIN_PX
): boolean {
  return strokeBottom + margin > currentFrameHeight;
}

export function nextDrawableBottomFromStroke(
  strokeBottom: number,
  margin: number = AUTO_GROW_BOTTOM_MARGIN_PX
): number {
  return Math.ceil(strokeBottom + margin);
}
