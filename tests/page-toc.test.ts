/**
 * @jest-environment jsdom
 */

import { Editor } from "@tiptap/core";
import {
  allocateStableHeadingId,
  collectTocHeadingEntries,
  documentHasPageToc,
  PAGE_TOC_ATTR,
  measureHeadingTextAnchor,
  removePageToc,
  resolveBackToTopPlacement,
  slugifyHeadingTitle,
  togglePageToc,
  upsertPageToc,
  BACK_TO_TOP_TARGET_SIZE,
} from "@/lib/page-toc";
import {
  annotationSceneHasInk,
  remapAnnotationSceneVertical,
} from "@/lib/annotation-vertical-remap";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";

function makeEditor(content: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: createEditorExtensions(),
    content,
  });
}

describe("page TOC helpers (SN-220)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("slugifies titles and allocates unique ids", () => {
    expect(slugifyHeadingTitle("Hello World!")).toBe("hello-world");
    const used = new Set<string>();
    expect(allocateStableHeadingId("Alpha", used)).toBe("alpha");
    expect(allocateStableHeadingId("Alpha", used)).toBe("alpha-2");
    expect(allocateStableHeadingId("Beta", used, "custom-id")).toBe("custom-id");
  });

  it("inserts a single top-of-page TOC with stable heading anchors", () => {
    const editor = makeEditor(
      ["<h1>Alpha</h1>", "<p>A</p>", "<h2>Beta</h2>", "<p>B</p>"].join("")
    );

    const result = upsertPageToc(editor);
    expect(result).toEqual({ ok: true, action: "inserted", entryCount: 2 });
    expect(documentHasPageToc(editor.state.doc)).toBe(true);

    const html = editor.getHTML();
    expect(html).toContain(`${PAGE_TOC_ATTR}="true"`);
    expect(html).toContain('data-toc-target="alpha"');
    expect(html).toContain('data-toc-target="beta"');
    expect(html).toContain('id="alpha"');
    expect(html).toContain('id="beta"');
    // In-page jumps use <button>, never navigable href hashes.
    expect(html).toContain("<button");
    expect(html).not.toMatch(/data-toc-target="[^"]+"[^>]*href=/);
    expect(html.match(new RegExp(PAGE_TOC_ATTR, "g"))?.length).toBe(1);

    editor.destroy();
  });

  it("refreshes TOC entries without duplicating the block", () => {
    const editor = makeEditor(
      [
        "<h1>Alpha</h1>",
        "<p>A</p>",
        "<h2>Beta</h2>",
        "<p>B</p>",
        "<h2>Gamma</h2>",
        "<p>C</p>",
      ].join("")
    );
    expect(upsertPageToc(editor)).toEqual({
      ok: true,
      action: "inserted",
      entryCount: 3,
    });

    editor.chain().focus("end").insertContent("<h2>Delta</h2><p>D</p>").run();
    const refreshed = upsertPageToc(editor);
    expect(refreshed).toEqual({ ok: true, action: "updated", entryCount: 4 });

    const html = editor.getHTML();
    expect(html.match(new RegExp(PAGE_TOC_ATTR, "g"))?.length).toBe(1);
    expect(html).toContain('data-toc-target="alpha"');
    expect(html).toContain('data-toc-target="beta"');
    expect(html).toContain('data-toc-target="gamma"');
    expect(html).toContain('data-toc-target="delta"');

    editor.destroy();
  });

  it("removes the TOC cleanly", () => {
    const editor = makeEditor(["<h1>Alpha</h1>", "<p>A</p>"].join(""));
    expect(upsertPageToc(editor).ok).toBe(true);
    expect(removePageToc(editor)).toEqual({ ok: true, action: "removed", entryCount: 0 });
    expect(documentHasPageToc(editor.state.doc)).toBe(false);
    expect(editor.getHTML()).not.toContain(PAGE_TOC_ATTR);
    editor.destroy();
  });

  it("refuses TOC upsert when there are no headings", () => {
    const editor = makeEditor("<p>No headings here</p>");
    expect(upsertPageToc(editor)).toEqual({
      ok: false,
      reason: "Add at least one heading (H1–H3) before generating a table of contents.",
    });
    editor.destroy();
  });

  it("toggles the TOC off when present and back on when absent (SN-230)", () => {
    const editor = makeEditor(["<h1>Alpha</h1>", "<p>A</p>", "<h2>Beta</h2>"].join(""));

    expect(togglePageToc(editor)).toEqual({ ok: true, action: "inserted", entryCount: 2 });
    expect(documentHasPageToc(editor.state.doc)).toBe(true);

    expect(togglePageToc(editor)).toEqual({ ok: true, action: "removed", entryCount: 0 });
    expect(documentHasPageToc(editor.state.doc)).toBe(false);

    expect(togglePageToc(editor)).toEqual({ ok: true, action: "inserted", entryCount: 2 });
    expect(documentHasPageToc(editor.state.doc)).toBe(true);
    editor.destroy();
  });

  it("toggle refuses to insert without headings and leaves the doc unchanged (SN-230)", () => {
    const editor = makeEditor("<p>No headings here</p>");
    const before = editor.getHTML();
    const result = togglePageToc(editor);
    expect(result.ok).toBe(false);
    expect(documentHasPageToc(editor.state.doc)).toBe(false);
    expect(editor.getHTML()).toBe(before);
    editor.destroy();
  });

  it("refresh keeps a single TOC block while toggle removes it (SN-230)", () => {
    const editor = makeEditor(["<h1>Alpha</h1>", "<p>A</p>"].join(""));
    expect(upsertPageToc(editor).ok).toBe(true);

    editor.commands.setContent(`${editor.getHTML()}<h2>Gamma</h2>`);
    // Refresh path: entries update, block stays.
    expect(upsertPageToc(editor)).toEqual({ ok: true, action: "updated", entryCount: 2 });
    expect(documentHasPageToc(editor.state.doc)).toBe(true);
    expect(editor.getHTML()).toContain('data-toc-target="gamma"');
    expect(editor.getHTML().match(/data-page-toc="true"/g)).toHaveLength(1);

    expect(togglePageToc(editor).ok).toBe(true);
    expect(documentHasPageToc(editor.state.doc)).toBe(false);
    editor.destroy();
  });

  it("collects heading entries while skipping an existing TOC node", () => {
    const editor = makeEditor(["<h1>Alpha</h1>", "<p>A</p>"].join(""));
    upsertPageToc(editor);
    const entries = collectTocHeadingEntries(editor.state.doc);
    expect(entries).toEqual([{ id: "alpha", level: 1, title: "Alpha" }]);
    editor.destroy();
  });
});

describe("annotation vertical remap (SN-220)", () => {
  const sceneWithInk = {
    document: {
      store: {
        "shape:draw-1": {
          typeName: "shape",
          type: "draw",
          y: 200,
          props: {
            segments: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 40 }] }],
          },
        },
        "shape:box": {
          typeName: "shape",
          type: "geo",
          y: 80,
          props: { h: 20, w: 20 },
        },
      },
    },
  };

  it("detects ink presence", () => {
    expect(annotationSceneHasInk(sceneWithInk)).toBe(true);
    expect(annotationSceneHasInk({ document: { store: {} } })).toBe(false);
    expect(annotationSceneHasInk(null)).toBe(false);
  });

  it("shifts every shape and drawableBottom by the prose delta", () => {
    const result = remapAnnotationSceneVertical(sceneWithInk, 120, 900);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const store = (result.scene as typeof sceneWithInk).document.store;
    expect(store["shape:draw-1"].y).toBe(320);
    expect(store["shape:box"].y).toBe(200);
    expect(result.drawableBottom).toBe(1020);
    // Original scene must stay untouched.
    expect(sceneWithInk.document.store["shape:draw-1"].y).toBe(200);
  });

  it("is a no-op for zero delta", () => {
    const result = remapAnnotationSceneVertical(sceneWithInk, 0, 900);
    expect(result).toEqual({ ok: true, scene: sceneWithInk, drawableBottom: 900 });
  });

  it("refuses non-finite deltas", () => {
    const result = remapAnnotationSceneVertical(sceneWithInk, Number.NaN, 900);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/invalid/i);
  });

  it("allows ink-less snapshots through without remapping shapes", () => {
    const result = remapAnnotationSceneVertical({ document: { store: {} } }, 40, 900);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drawableBottom).toBe(940);
  });
  it("refuses shapes missing a finite page Y", () => {
    const bad = {
      document: {
        store: {
          "shape:bad": {
            typeName: "shape",
            type: "draw",
            y: "oops",
            props: {},
          },
        },
      },
    };
    const result = remapAnnotationSceneVertical(bad, 50, 400);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/valid page position/i);
  });

  it("refuses when drawableBottom would go negative", () => {
    const result = remapAnnotationSceneVertical(sceneWithInk, -5000, 100);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/drawable extent/i);
  });
});

describe("back-to-top placement (SN-231)", () => {
  const column = { contentLeft: 32, contentWidth: 640 };

  it("anchors the hit target just past the end of the heading text", () => {
    expect(
      resolveBackToTopPlacement({ textRight: 180, midY: 100, ...column })
    ).toEqual({ left: 182, top: 100, align: "leading" });
  });

  it("keeps the touch target inside the text column on full-width lines", () => {
    const placement = resolveBackToTopPlacement({ textRight: 668, midY: 40, ...column });
    expect(placement.left + BACK_TO_TOP_TARGET_SIZE).toBeLessThanOrEqual(
      column.contentLeft + column.contentWidth
    );
    // Clamped: the chevron flips to the trailing edge so it misses the words.
    expect(placement.align).toBe("trailing");
  });

  it("never lands on the collapse-chevron gutter for an empty heading", () => {
    const placement = resolveBackToTopPlacement({
      textRight: 4,
      midY: 12,
      contentLeft: 12,
      contentWidth: 300,
    });
    expect(placement.left).toBeGreaterThanOrEqual(20);
  });

  it("falls back to the heading box when no line rects are measurable", () => {
    const heading = document.createElement("h1");
    document.body.appendChild(heading);
    Object.defineProperty(heading, "offsetLeft", { value: 32, configurable: true });
    Object.defineProperty(heading, "offsetTop", { value: 96, configurable: true });
    Object.defineProperty(heading, "offsetHeight", { value: 40, configurable: true });
    Object.defineProperty(heading, "offsetWidth", { value: 640, configurable: true });

    expect(measureHeadingTextAnchor(heading)).toEqual({ textRight: 32, midY: 116 });
  });
});
