import { A4_HEIGHT_PX, A4_WIDTH_PX, measureDesignPages } from "@/lib/design-pagination";

describe("A4 design page measurement", () => {
  it("uses the CSS A4 aspect ratio and puts guides on page boundaries", () => {
    expect(A4_WIDTH_PX).toBeCloseTo(793.7, 1);
    expect(A4_HEIGHT_PX).toBeCloseTo(1122.5, 1);
    const result = measureDesignPages(A4_HEIGHT_PX * 2.4);
    expect(result.pages).toBe(3);
    expect(result.boundaries).toEqual([A4_HEIGHT_PX, A4_HEIGHT_PX * 2]);
  });

  it("keeps a single page at the exact boundary", () => {
    expect(measureDesignPages(A4_HEIGHT_PX).pages).toBe(1);
    expect(measureDesignPages(A4_HEIGHT_PX + 2).pages).toBe(2);
    expect(measureDesignPages(0).pages).toBe(1);
  });
});
