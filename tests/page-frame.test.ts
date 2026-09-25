import {
  AUTO_GROW_BOTTOM_MARGIN_PX,
  autoGrowBottomMargin,
  computePageFrameHeight,
  defaultBottomCanvasPadding,
  MIN_BOTTOM_CANVAS_PADDING_PX,
  nextDrawableBottomFromStroke,
  shouldAutoGrowDrawableBottom,
} from "@/lib/page-frame";

describe("page frame height", () => {
  test("adds default bottom padding below text and viewport", () => {
    expect(defaultBottomCanvasPadding(720)).toBe(800);
    expect(
      computePageFrameHeight({
        textHeight: 240,
        viewportHeight: 720,
      })
    ).toBe(Math.max(240, 720) + 800);
  });

  test("honors persisted drawableBottom when larger than padded base", () => {
    expect(
      computePageFrameHeight({
        textHeight: 200,
        viewportHeight: 600,
        drawableBottom: 1800,
      })
    ).toBe(1800);
  });
});

describe("auto-grow drawable margin (SN-123)", () => {
  test("keeps roughly one screen of blank space below the lowest stroke", () => {
    expect(autoGrowBottomMargin(1000)).toBe(900);
    // Falls back to the fixed floor on short viewports.
    expect(autoGrowBottomMargin(400)).toBe(AUTO_GROW_BOTTOM_MARGIN_PX);
    expect(MIN_BOTTOM_CANVAS_PADDING_PX).toBe(800);
  });

  test("grows whenever the last stroke lacks a full margin of blank space below", () => {
    const margin = autoGrowBottomMargin(1000); // 900

    // Stroke drawn near the current bottom → extend the canvas past it.
    expect(shouldAutoGrowDrawableBottom(1700, 1800, margin)).toBe(true);
    // Stroke with a full margin of space already below → no growth.
    expect(shouldAutoGrowDrawableBottom(800, 1800, margin)).toBe(false);
  });

  test("extends the drawable bottom to sit a full margin past the last stroke", () => {
    const margin = autoGrowBottomMargin(1000);
    const strokeBottom = 1750;
    const nextBottom = nextDrawableBottomFromStroke(strokeBottom, margin);

    expect(nextBottom).toBe(strokeBottom + margin);
    // The resulting frame leaves a full blank margin below the last stroke.
    const frame = computePageFrameHeight({
      textHeight: 200,
      viewportHeight: 1000,
      drawableBottom: nextBottom,
    });
    expect(frame - strokeBottom).toBeGreaterThanOrEqual(margin);
  });

  test("defaults to the fixed margin when none is provided", () => {
    expect(nextDrawableBottomFromStroke(500)).toBe(500 + AUTO_GROW_BOTTOM_MARGIN_PX);
  });
});
