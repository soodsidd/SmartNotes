import { applyDesignElementEdit, readDesignMaxPages, setDesignMaxPages } from "@/lib/design-html-edit";

describe("design HTML edit serialization", () => {
  it("replaces only the edited element's inner bytes in a complete artifact", () => {
    const html = '<!DOCTYPE html>\n<html><head><style>p{color:teal}</style></head><body>\n<!-- keep -->\n<p class=\'intro\'>Old &amp; text</p>\n<section data-x="a">untouched</section>\n</body></html>';
    const next = applyDesignElementEdit(html, [0], "New <strong>text</strong>");
    expect(next).toBe(html.replace("Old &amp; text", "New <strong>text</strong>"));
    expect(next).toContain("<head><style>p{color:teal}</style></head>");
    expect(next).toContain("<section data-x=\"a\">untouched</section>");
  });

  it("supports a fragment and rejects a path that cannot be mapped safely", () => {
    const html = '<div class="card"><p>One</p><p>Two</p></div>';
    expect(applyDesignElementEdit(html, [0, 1], "Changed")).toBe('<div class="card"><p>One</p><p>Changed</p></div>');
    expect(applyDesignElementEdit(html, [5], "Wrong")).toBeNull();
  });

  it("replaces a whole element in outer mode for list conversion", () => {
    const html = '<html><head><title>x</title></head><body><p>Lead</p><div><p class="k">Item</p></div></body></html>';
    expect(applyDesignElementEdit(html, [1, 0], '<ul><li>Item</li></ul>', "outer")).toBe(
      '<html><head><title>x</title></head><body><p>Lead</p><div><ul><li>Item</li></ul></div></body></html>'
    );
  });

  it("persists an optional max-page setting without changing other markup", () => {
    const html = "<html><head><style>.a{color:red}</style></head><body>Text</body></html>";
    const withLimit = setDesignMaxPages(html, 2);
    expect(readDesignMaxPages(withLimit)).toBe(2);
    expect(setDesignMaxPages(withLimit, null)).toBe(html);
  });
});
