/** @jest-environment node */

import { resolvePdfTapTurn } from "@/lib/pdf-reader-interaction";

const base = {
  annotateMode: false,
  multiTouch: false,
  button: 0,
  modified: false,
  elapsedMs: 120,
  startX: 50,
  startY: 200,
  endX: 52,
  endY: 202,
  surfaceLeft: 0,
  surfaceWidth: 1000,
};

describe("PDF reader tap zones", () => {
  test("maps the outer 20 percent to previous and next", () => {
    expect(resolvePdfTapTurn(base)).toBe("previous");
    expect(resolvePdfTapTurn({ ...base, startX: 900, endX: 902 })).toBe("next");
    expect(resolvePdfTapTurn({ ...base, startX: 500, endX: 502 })).toBeNull();
  });

  test.each([
    { annotateMode: true },
    { multiTouch: true },
    { button: 1 },
    { modified: true },
    { elapsedMs: 700 },
    { endX: 80 },
    { endY: 230 },
  ])("rejects gesture-like input %#", (change) => {
    expect(resolvePdfTapTurn({ ...base, ...change })).toBeNull();
  });
});
