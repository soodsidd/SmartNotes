/**
 * @jest-environment node
 *
 * SN-334 — Highlight from the PDF selection menu builds a normal EmbedPDF
 * highlight and never stacks a duplicate on repeated invocation.
 */
import {
  buildSelectionHighlight,
  isSelectionAlreadyHighlighted,
  type PdfRect,
} from "@/lib/pdf-selection-highlight";

const HIGHLIGHT = 9;
const INK = 15;
const r = (x: number, y: number, width: number, height: number): PdfRect => ({ origin: { x, y }, size: { width, height } });
const line1 = r(72, 100, 300, 12);
const line2 = r(72, 114, 180, 12);
const selection = { pageIndex: 2, rect: r(72, 100, 300, 26), segmentRects: [line1, line2] };

describe("isSelectionAlreadyHighlighted", () => {
  test("is false on a page with no highlights", () => {
    expect(isSelectionAlreadyHighlighted(selection, [], HIGHLIGHT)).toBe(false);
  });

  test("detects the same passage highlighted again, tolerating sub-point drift", () => {
    const existing = [{ type: HIGHLIGHT, segmentRects: [r(71.6, 99.7, 300.6, 12.4), r(72.2, 114, 179.6, 12)] }];
    expect(isSelectionAlreadyHighlighted(selection, existing, HIGHLIGHT)).toBe(true);
  });

  test("treats a sub-range of an existing highlight as already highlighted", () => {
    const sub = { ...selection, segmentRects: [r(100, 100, 50, 12)] };
    expect(isSelectionAlreadyHighlighted(sub, [{ type: HIGHLIGHT, segmentRects: [line1] }], HIGHLIGHT)).toBe(true);
  });

  test("creates a new highlight when the passage only partly overlaps", () => {
    expect(isSelectionAlreadyHighlighted(selection, [{ type: HIGHLIGHT, segmentRects: [line1] }], HIGHLIGHT)).toBe(false);
  });

  test("ignores non-highlight annotations covering the same area", () => {
    expect(isSelectionAlreadyHighlighted(selection, [{ type: INK, segmentRects: [line1, line2] }], HIGHLIGHT)).toBe(false);
  });

  test("never claims an empty selection is highlighted", () => {
    expect(isSelectionAlreadyHighlighted({ ...selection, segmentRects: [] }, [{ type: HIGHLIGHT, segmentRects: [line1] }], HIGHLIGHT)).toBe(false);
  });
});

describe("buildSelectionHighlight", () => {
  const defaults = { type: HIGHLIGHT, color: "#FFCD45", strokeColor: "#FFCD45", opacity: 1, blendMode: 1 };
  const created = new Date("2026-10-16T00:00:00Z");

  test("matches EmbedPDF's text-markup handler shape, including custom.text for Record", () => {
    expect(buildSelectionHighlight(selection, defaults, "id-1", "Exact  passage\ntext", created)).toEqual({
      ...defaults,
      rect: selection.rect,
      segmentRects: selection.segmentRects,
      pageIndex: 2,
      created,
      id: "id-1",
      custom: { text: "Exact  passage\ntext" },
    });
  });

  test("omits custom text when the selected text could not be read", () => {
    expect(buildSelectionHighlight(selection, defaults, "id-2", null, created)).not.toHaveProperty("custom");
  });
});
