import { buildEffectiveEditorHtml, planPageSwap, stripLegacyPageTitle } from "@/lib/editor-swap-helpers";
import type { CachedPageEntry } from "@/lib/page-content-cache";

describe("editor swap helpers", () => {
  it("leaves the page title to the single title bar", () => {
    expect(
      buildEffectiveEditorHtml({
        path: "Notebook/Section/page.html",
        title: "My Page",
        content: "Hello world",
      })
    ).toBe("Hello world");
  });

  it("removes a matching legacy title heading while preserving body headings", () => {
    const html = "<h1>Saved</h1><p>Body</p>";

    expect(
      buildEffectiveEditorHtml({
        path: "Notebook/Section/page.html",
        title: "Saved",
        content: html,
      })
    ).toBe("<p>Body</p>");
    expect(stripLegacyPageTitle("<h1>Chapter</h1><p>Body</p>", "Saved"))
      .toBe("<h1>Chapter</h1><p>Body</p>");
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
    expect(plan.html).toBe("<p>Body</p>");
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
