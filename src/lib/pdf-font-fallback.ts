/**
 * Self-hosted PDFium font fallback for the immersive reader (SN-148).
 *
 * Many vault PDFs reference Helvetica/etc without embedding. With
 * `fontFallback: null`, pages open (count OK) but paint blank.
 *
 * Sync XHR during PDFium MapFont is unreliable for same-origin `/pdf-fonts`
 * in this app; we preload TTFs via fetch and serve them through `fontLoader`.
 */

import { FontCharset } from "@embedpdf/models";

export interface PdfFontVariant {
  url: string;
  weight?: number;
  italic?: boolean;
}

export interface PdfFontFallbackConfig {
  fonts: Partial<Record<number, PdfFontVariant | PdfFontVariant[] | string>>;
  defaultFont?: PdfFontVariant | PdfFontVariant[] | string;
  baseUrl?: string;
  fontLoader?: (fontPath: string) => Uint8Array | null;
}

/** Relative names under public/pdf-fonts/latin. */
export const LATIN_FALLBACK_VARIANTS: PdfFontVariant[] = [
  { url: "NotoSans-Regular.ttf", weight: 400 },
  { url: "NotoSans-Italic.ttf", weight: 400, italic: true },
  { url: "NotoSans-Bold.ttf", weight: 700 },
  { url: "NotoSans-BoldItalic.ttf", weight: 700, italic: true },
];

export const PDF_LATIN_FONTS_BASE_URL = "/pdf-fonts/latin";

const fontBytes = new Map<string, Uint8Array>();
let preloadPromise: Promise<void> | null = null;

/** Prefetch self-hosted TTFs into memory for sync fontLoader lookups. */
export function preloadPdfFonts(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      await Promise.all(
        LATIN_FALLBACK_VARIANTS.map(async (variant) => {
          const path = `${PDF_LATIN_FONTS_BASE_URL}/${variant.url}`;
          const response = await fetch(path);
          if (!response.ok) {
            throw new Error(`PDF font prefetch failed (${response.status}): ${path}`);
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          fontBytes.set(variant.url, bytes);
          fontBytes.set(path, bytes);
        })
      );
    })().catch((error) => {
      preloadPromise = null;
      throw error;
    });
  }
  return preloadPromise;
}

function pdfFontLoader(fontPath: string): Uint8Array | null {
  if (fontBytes.has(fontPath)) return fontBytes.get(fontPath)!;
  const base = fontPath.split("/").pop();
  if (base && fontBytes.has(base)) return fontBytes.get(base)!;
  return null;
}

/**
 * EmbedPDF font fallback config pointing at self-hosted Latin fonts.
 * Call {@link preloadPdfFonts} before creating the engine.
 */
export function createPdfFontFallbackConfig(): PdfFontFallbackConfig {
  return {
    baseUrl: PDF_LATIN_FONTS_BASE_URL,
    defaultFont: LATIN_FALLBACK_VARIANTS,
    fontLoader: pdfFontLoader,
    fonts: {
      [FontCharset.ANSI]: LATIN_FALLBACK_VARIANTS,
      [FontCharset.DEFAULT]: LATIN_FALLBACK_VARIANTS,
      [FontCharset.SYMBOL]: LATIN_FALLBACK_VARIANTS,
      [FontCharset.EASTERNEUROPEAN]: LATIN_FALLBACK_VARIANTS,
      [FontCharset.CYRILLIC]: LATIN_FALLBACK_VARIANTS,
      [FontCharset.GREEK]: LATIN_FALLBACK_VARIANTS,
      [FontCharset.VIETNAMESE]: LATIN_FALLBACK_VARIANTS,
    },
  };
}
