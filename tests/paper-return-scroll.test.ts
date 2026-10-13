import { capturePaperReturnScroll, resolvePaperReturnScroll } from "@/lib/paper-return-scroll";

describe("paper return scroll (Back to topic)", () => {
  it("captures a finite scroll offset for a referring page path", () => {
    expect(capturePaperReturnScroll("Research/Articles/a.html", 420)).toEqual({
      path: "Research/Articles/a.html",
      scrollTop: 420,
    });
    expect(capturePaperReturnScroll("Research/Articles/a.html", -12)?.scrollTop).toBe(0);
    expect(capturePaperReturnScroll(null, 10)).toBeNull();
    expect(capturePaperReturnScroll("Research/Articles/a.html", Number.NaN)).toBeNull();
  });

  it("resolves pending scroll only when the active page matches", () => {
    const pending = capturePaperReturnScroll("Research/Articles/a.html", 88)!;
    expect(resolvePaperReturnScroll(pending, "Research/Articles/a.html")).toBe(88);
    expect(resolvePaperReturnScroll(pending, "Research/Articles/other.html")).toBeNull();
    expect(resolvePaperReturnScroll(null, "Research/Articles/a.html")).toBeNull();
  });
});
