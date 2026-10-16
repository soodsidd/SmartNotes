import { A4_HEIGHT_PX, A4_WIDTH_PX, measureDesignPages } from "@/lib/design-pagination";

describe("A4 design page measurement", () => {
  it("uses one integer A4 width shared by Preview guides and PDF export (SN-319)", () => {
    expect(Number.isInteger(A4_WIDTH_PX)).toBe(true);
    expect(A4_WIDTH_PX).toBe(Math.round((210 / 25.4) * 96));
    expect(A4_WIDTH_PX).toBe(794);
    // Height is derived from the shared width so guide Y and PDF page box match.
    expect(A4_HEIGHT_PX).toBe((A4_WIDTH_PX * 297) / 210);
    expect(A4_HEIGHT_PX).toBeCloseTo(1122.94, 1);
  });

  it("puts mathematical guide boundaries on A4 page-box multiples", () => {
    const result = measureDesignPages(A4_HEIGHT_PX * 2.4);
    expect(result.pages).toBe(3);
    expect(result.pageHeightPx).toBe(A4_HEIGHT_PX);
    expect(result.boundaries).toEqual([A4_HEIGHT_PX, A4_HEIGHT_PX * 2]);
  });

  it("keeps a single page at the exact boundary", () => {
    expect(measureDesignPages(A4_HEIGHT_PX).pages).toBe(1);
    expect(measureDesignPages(A4_HEIGHT_PX + 2).pages).toBe(2);
    expect(measureDesignPages(0).pages).toBe(1);
  });

  it("aligns guide boundaries with the PDF page-box height within 2 CSS px", () => {
    // Export PDF uses width/height `${A4_WIDTH_PX}px` / `${A4_HEIGHT_PX}px`.
    // Guide Y for page n is n * A4_HEIGHT_PX — identical to the page-box edge.
    const measurement = measureDesignPages(A4_HEIGHT_PX * 3 + 10);
    for (let index = 0; index < measurement.boundaries.length; index += 1) {
      const guideY = measurement.boundaries[index];
      const pdfPageEdgeY = (index + 1) * A4_HEIGHT_PX;
      expect(Math.abs(guideY - pdfPageEdgeY)).toBeLessThanOrEqual(2);
    }
  });
});
