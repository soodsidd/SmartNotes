/**
 * @jest-environment node
 */
import { PdfActionType, type PdfBookmarkObject } from "@embedpdf/models";
import {
  bookmarkTargetPageIndex,
  buildPdfOutline,
} from "@/lib/pdf-outline";

function destBookmark(title: string, pageIndex: number, children?: PdfBookmarkObject[]): PdfBookmarkObject {
  return {
    title,
    target: {
      type: "destination",
      destination: { pageIndex, zoom: { mode: 0 } as never, view: [] },
    },
    ...(children ? { children } : {}),
  };
}

function gotoBookmark(title: string, pageIndex: number): PdfBookmarkObject {
  return {
    title,
    target: {
      type: "action",
      action: {
        type: PdfActionType.Goto,
        destination: { pageIndex, zoom: { mode: 0 } as never, view: [] },
      },
    },
  };
}

describe("bookmarkTargetPageIndex", () => {
  it("resolves a destination target's page index", () => {
    expect(bookmarkTargetPageIndex(destBookmark("Ch 1", 4))).toBe(4);
  });

  it("resolves a Goto action target's page index", () => {
    expect(bookmarkTargetPageIndex(gotoBookmark("Ch 2", 9))).toBe(9);
  });

  it("resolves a RemoteGoto action target's page index", () => {
    const bm: PdfBookmarkObject = {
      title: "Remote",
      target: {
        type: "action",
        action: {
          type: PdfActionType.RemoteGoto,
          destination: { pageIndex: 2, zoom: { mode: 0 } as never, view: [] },
        },
      },
    };
    expect(bookmarkTargetPageIndex(bm)).toBe(2);
  });

  it("returns null for a bookmark with no target (heading-only node)", () => {
    expect(bookmarkTargetPageIndex({ title: "Part I" })).toBeNull();
  });

  it("returns null for a URI action (external link — out of scope)", () => {
    const bm: PdfBookmarkObject = {
      title: "Website",
      target: {
        type: "action",
        action: { type: PdfActionType.URI, uri: "https://example.com" },
      },
    };
    expect(bookmarkTargetPageIndex(bm)).toBeNull();
  });

  it("floors and rejects invalid page indices", () => {
    expect(bookmarkTargetPageIndex(destBookmark("f", 3.9))).toBe(3);
    expect(bookmarkTargetPageIndex(destBookmark("neg", -1))).toBeNull();
    expect(bookmarkTargetPageIndex(destBookmark("nan", NaN))).toBeNull();
  });
});

describe("buildPdfOutline", () => {
  it("returns an empty array for a document with no bookmarks", () => {
    expect(buildPdfOutline([])).toEqual([]);
    expect(buildPdfOutline(null)).toEqual([]);
    expect(buildPdfOutline(undefined)).toEqual([]);
  });

  it("normalizes a nested chapter/subchapter tree", () => {
    const tree = buildPdfOutline([
      destBookmark("Chapter 1", 0, [
        destBookmark("1.1 Intro", 1),
        gotoBookmark("1.2 Setup", 3),
      ]),
      destBookmark("Chapter 2", 10),
    ]);
    expect(tree).toEqual([
      {
        title: "Chapter 1",
        pageIndex: 0,
        children: [
          { title: "1.1 Intro", pageIndex: 1, children: [] },
          { title: "1.2 Setup", pageIndex: 3, children: [] },
        ],
      },
      { title: "Chapter 2", pageIndex: 10, children: [] },
    ]);
  });

  it("keeps a targetless grouping node that has navigable children", () => {
    const tree = buildPdfOutline([
      { title: "Part I", children: [destBookmark("Chapter 1", 5)] },
    ]);
    expect(tree).toEqual([
      {
        title: "Part I",
        pageIndex: null,
        children: [{ title: "Chapter 1", pageIndex: 5, children: [] }],
      },
    ]);
  });

  it("drops a node that neither jumps anywhere nor has navigable children", () => {
    const tree = buildPdfOutline([
      { title: "Dead", children: [{ title: "Also dead" }] },
      destBookmark("Real", 2),
    ]);
    expect(tree).toEqual([{ title: "Real", pageIndex: 2, children: [] }]);
  });

  it("falls back to 'Untitled' when a bookmark omits its title", () => {
    const tree = buildPdfOutline([
      { title: "", target: { type: "destination", destination: { pageIndex: 0, zoom: { mode: 0 } as never, view: [] } } },
    ]);
    expect(tree[0].title).toBe("Untitled");
  });
});
