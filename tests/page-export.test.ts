/**
 * @jest-environment jsdom
 */
import {
  buildStandaloneHtmlBundle,
  clearPagePrintLeadingH1,
  collectVaultAssetUrls,
  inlineVaultAssetsInHtml,
  sanitizeExportFilename,
  setPagePrintLeadingH1,
  shouldHandlePagePrintShortcutTarget,
  stripDuplicatePageHeading,
} from "@/lib/page-export";

describe("page-export", () => {
  test("sanitizeExportFilename removes unsafe characters", () => {
    expect(sanitizeExportFilename('Notes: "Q2" / plan')).toBe("Notes Q2 plan");
    expect(sanitizeExportFilename("   ")).toBe("Untitled page");
  });

  test("collectVaultAssetUrls finds image and attachment vault paths", () => {
    const html =
      '<p><img src="/vault/nb/sec/page.assets/photo.png" alt="x" /></p>' +
      '<a class="file-attachment-chip" href="/vault/nb/sec/page.assets/doc.pdf">doc</a>';
    expect(collectVaultAssetUrls(html)).toEqual([
      "/vault/nb/sec/page.assets/photo.png",
      "/vault/nb/sec/page.assets/doc.pdf",
    ]);
  });

  test("inlineVaultAssetsInHtml replaces vault URLs with data URIs", async () => {
    class MockFileReader {
      result = "data:image/png;base64,YWJj";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    }
    const originalFileReader = global.FileReader;
    global.FileReader = MockFileReader as unknown as typeof FileReader;

    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["abc"], { type: "image/png" }),
    });

    try {
      const html = '<img src="/vault/nb/sec/page.assets/photo.png" alt="shot" />';
      const result = await inlineVaultAssetsInHtml(html, fetchImpl as unknown as typeof fetch);

      expect(fetchImpl).toHaveBeenCalledWith("/vault/nb/sec/page.assets/photo.png");
      expect(result).toContain("data:image/png;base64,");
      expect(result).not.toContain("/vault/nb/sec/page.assets/photo.png");
    } finally {
      global.FileReader = originalFileReader;
    }
  });

  test("stripDuplicatePageHeading removes the leading page title h1", () => {
    expect(stripDuplicatePageHeading("<h1>Title</h1><p>Body</p>")).toBe("<p>Body</p>");
  });

  test("setPagePrintLeadingH1 marks the first h1 in the editor for print suppression (SN-96)", () => {
    document.body.innerHTML = `
      <div data-testid="rich-text-editor">
        <h1>My Page Title</h1>
        <p>Body content</p>
      </div>`;

    const marked = setPagePrintLeadingH1();
    expect(marked).not.toBeNull();
    expect(marked?.getAttribute("data-print-leading-h1")).toBe("true");
  });

  test("setPagePrintLeadingH1 returns null when editor has no leading h1 (SN-96)", () => {
    document.body.innerHTML = `
      <div data-testid="rich-text-editor">
        <p>No heading first</p>
        <h1>Later heading</h1>
      </div>`;

    const marked = setPagePrintLeadingH1();
    expect(marked).toBeNull();
    expect(document.querySelector("[data-print-leading-h1]")).toBeNull();
  });

  test("clearPagePrintLeadingH1 removes the attribute (SN-96)", () => {
    document.body.innerHTML = `
      <div data-testid="rich-text-editor">
        <h1 data-print-leading-h1="true">Title</h1>
      </div>`;

    clearPagePrintLeadingH1();
    expect(document.querySelector("[data-print-leading-h1]")).toBeNull();
  });

  test("print shortcut target guard allows editor focus but excludes editable controls (SN-96)", () => {
    document.body.innerHTML = `
      <div data-testid="rich-text-editor" contenteditable="true">
        <p><span id="editor-target">Body</span></p>
      </div>
      <div contenteditable="true"><span id="other-editable">Draft</span></div>
      <textarea id="textarea-target"></textarea>
      <input id="input-target" />
      <select id="select-target"></select>
      <div data-testid="ai-input"><span id="ai-target">Ask</span></div>`;

    expect(shouldHandlePagePrintShortcutTarget(document.getElementById("editor-target"))).toBe(true);
    expect(shouldHandlePagePrintShortcutTarget(document.getElementById("other-editable"))).toBe(false);
    expect(shouldHandlePagePrintShortcutTarget(document.getElementById("textarea-target"))).toBe(false);
    expect(shouldHandlePagePrintShortcutTarget(document.getElementById("input-target"))).toBe(false);
    expect(shouldHandlePagePrintShortcutTarget(document.getElementById("select-target"))).toBe(false);
    expect(shouldHandlePagePrintShortcutTarget(document.getElementById("ai-target"))).toBe(false);
  });

  test("buildStandaloneHtmlBundle embeds title, body, and ink overlay", () => {
    const bundle = buildStandaloneHtmlBundle({
      title: "Research memo",
      bodyHtml: "<h1>Research memo</h1><p>Body copy</p>",
      frameHeight: 640,
      ink: {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>',
        width: 100,
        height: 50,
      },
    });

    expect(bundle).toContain("<title>Research memo</title>");
    expect(bundle).toContain('<div class="exported-page__content editor-content">\n        <p>Body copy</p>');
    expect(bundle).toContain('class="exported-page__ink"');
    expect(bundle).toContain('style="min-height:640px"');
    expect(bundle).toContain("<svg");
  });
});
