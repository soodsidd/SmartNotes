/**
 * Unit tests for self-hosted PDF font fallback config (SN-148).
 */

import { FontCharset } from "@embedpdf/models";
import {
  PDF_LATIN_FONTS_BASE_URL,
  LATIN_FALLBACK_VARIANTS,
  createPdfFontFallbackConfig,
} from "@/lib/pdf-font-fallback";

describe("pdf-font-fallback", () => {
  it("points at self-hosted latin fonts, not a CDN", () => {
    const config = createPdfFontFallbackConfig();
    expect(config.baseUrl).toBe(PDF_LATIN_FONTS_BASE_URL);
    expect(config.baseUrl).not.toMatch(/jsdelivr|cdn\./i);
    expect(LATIN_FALLBACK_VARIANTS.every((v) => !v.url.includes("/"))).toBe(
      true
    );
  });

  it("covers ANSI/DEFAULT so Helvetica-style PDFs are not blank", () => {
    const config = createPdfFontFallbackConfig();
    expect(config.fonts[FontCharset.ANSI]).toEqual(LATIN_FALLBACK_VARIANTS);
    expect(config.fonts[FontCharset.DEFAULT]).toEqual(LATIN_FALLBACK_VARIANTS);
    expect(config.defaultFont).toEqual(LATIN_FALLBACK_VARIANTS);
  });

  it("exposes a fontLoader for preloaded bytes", () => {
    const config = createPdfFontFallbackConfig();
    expect(typeof config.fontLoader).toBe("function");
    expect(config.fontLoader!("missing.ttf")).toBeNull();
  });
});
