import { PageContentCache } from "@/lib/page-content-cache";

jest.mock("@/lib/api/annotations", () => ({
  fetchAnnotationsScene: jest.fn(),
}));

import { fetchAnnotationsScene } from "@/lib/api/annotations";

const mockFetchAnnotationsScene = fetchAnnotationsScene as jest.MockedFunction<
  typeof fetchAnnotationsScene
>;

describe("PageContentCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stores and retrieves page html with LRU eviction", () => {
    const cache = new PageContentCache({ maxEntries: 2 });

    cache.set("a.html", { html: "<p>A</p>" });
    cache.set("b.html", { html: "<p>B</p>" });
    cache.get("a.html");
    cache.set("c.html", { html: "<p>C</p>" });

    expect(cache.get("a.html")?.html).toBe("<p>A</p>");
    expect(cache.get("b.html")).toBeUndefined();
    expect(cache.get("c.html")?.html).toBe("<p>C</p>");
  });

  it("marks annotations ready and reuses cached scenes", async () => {
    const cache = new PageContentCache();
    cache.set("page.html", { html: "<p>Body</p>" });
    cache.setAnnotations("page.html", { document: { store: {} } });

    const payload = await cache.ensureAnnotations("page.html");

    expect(payload).toEqual({ scene: { document: { store: {} } }, drawableBottom: undefined });
    expect(mockFetchAnnotationsScene).not.toHaveBeenCalled();
  });

  it("dedupes inflight annotation fetches", async () => {
    const cache = new PageContentCache();
    cache.set("page.html", { html: "<p>Body</p>" });

    let resolveFetch: (value: { scene: unknown; drawableBottom?: number }) => void = () => undefined;
    mockFetchAnnotationsScene.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const first = cache.ensureAnnotations("page.html");
    const second = cache.ensureAnnotations("page.html");

    resolveFetch({ scene: { document: { store: { ink: true } } }, drawableBottom: 1500 });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { scene: { document: { store: { ink: true } } }, drawableBottom: 1500 },
      { scene: { document: { store: { ink: true } } }, drawableBottom: 1500 },
    ]);
    expect(mockFetchAnnotationsScene).toHaveBeenCalledTimes(1);
    expect(cache.hasAnnotations("page.html")).toBe(true);
  });
});
