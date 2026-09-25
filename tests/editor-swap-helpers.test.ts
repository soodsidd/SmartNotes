import { buildEffectiveEditorHtml, planPageSwap } from "@/lib/editor-swap-helpers";
import type { CachedPageEntry } from "@/lib/page-content-cache";

describe("editor swap helpers", () => {
  it("wraps plain content with an h1 title", () => {
    expect(
      buildEffectiveEditorHtml({
        path: "Notebook/Section/page.html",
        title: "My Page",
        content: "Hello world",
      })
    ).toBe("<h1>My Page</h1>Hello world");
  });

  it("keeps saved html documents intact", () => {
    const html = "<h1>Saved</h1><p>Body</p>";

    expect(
      buildEffectiveEditorHtml({
        path: "Notebook/Section/page.html",
        title: "Ignored",
        content: html,
      })
    ).toBe(html);
  });

  it("plans synchronous swaps when annotations are cached", () => {
    const cacheEntry: CachedPageEntry = {
      html: "<h1>Cached</h1>",
      annotationsScene: { document: { store: {} } },
      annotationsReady: true,
    };

    const plan = planPageSwap(
      {
        path: "Notebook/Section/page.html",
        title: "Cached",
        content: "<h1>Cached</h1><p>Body</p>",
      },
      cacheEntry
    );

    expect(plan.readiness).toBe("ready");
    expect(plan.html).toBe("<h1>Cached</h1><p>Body</p>");
    expect(plan.annotationsScene).toEqual({ document: { store: {} } });
  });

  it("defers ink swap until annotations hydrate on cache miss", () => {
    const plan = planPageSwap(
      {
        path: "Notebook/Section/page.html",
        title: "Fresh",
        content: "<p>Body</p>",
      },
      undefined
    );

    expect(plan.readiness).toBe("pending-annotations");
    expect(plan.annotationsScene).toBeNull();
  });
});
