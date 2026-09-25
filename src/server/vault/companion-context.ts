import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { readPage } from "./pages";
import { resolveVaultPath, toVaultRelativePath } from "./paths";
import { formatNotebookContext, readNotebookContext } from "./jupyter-notebook";
import { readPdfAnnotations } from "./pdf-annotations";
import { extractPdfPageTextItems } from "./pdf-text-geometry";
import {
  collectPdfHighlightQuoteTargets,
  formatPdfAnnotationCompanionContext,
  reconstructMarkedText,
  summarizePdfAnnotationsForCompanion,
  type HighlightGeometryTextItem,
} from "@/lib/pdf-annotations";

type PdfParserConstructor = new (input: { data: Buffer }) => {
  getText: (options?: { partial?: number[]; first?: number; last?: number }) => Promise<{
    text?: unknown;
    total?: unknown;
    getPageText?: (page: number) => string;
  }>;
  getInfo: () => Promise<{ total?: unknown }>;
  destroy: () => Promise<void>;
};

let cachedPdfParser: PdfParserConstructor | null | undefined;

export const COMPANION_CONTEXT_LIMITS = {
  maxPdfFiles: 3,
  maxPdfBytes: 25 * 1024 * 1024,
  maxPdfPagesPerRead: 3,
  /**
   * Default maximum characters of PDF text to include per file.
   * Raised to 60 000 (≈ 15 K tokens) so full technical documents fit without
   * truncation. When a document exceeds this limit, the truncation note
   * includes the total character count and the pdfChunkOffset value the caller
   * should pass to read the next chunk.
   */
  maxPdfTextChars: 60_000,
  /** Per-highlight marked-text (quote) character cap in companion annotation context. */
  maxHighlightQuoteChars: 280,
  /** Bound on how many distinct pages get positioned-text extraction for quotes. */
  maxHighlightQuotePages: 20,
} as const;

async function getPdfParser(): Promise<PdfParserConstructor | null> {
  if (cachedPdfParser !== undefined) {
    return cachedPdfParser;
  }
  try {
    const mod = (await import("pdf-parse")) as {
      PDFParse?: PdfParserConstructor;
      default?: { PDFParse?: PdfParserConstructor };
    };
    cachedPdfParser = mod.PDFParse ?? mod.default?.PDFParse ?? null;
  } catch {
    cachedPdfParser = null;
  }
  return cachedPdfParser;
}

function safeDecodeUri(input: string) {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function stripUrlNoise(input: string) {
  return input.split("#")[0]!.split("?")[0]!.trim();
}

function normalizePdfHref(pagePath: string, href: string): string | null {
  const cleaned = stripUrlNoise(safeDecodeUri(href));
  if (!cleaned || /^https?:\/\//i.test(cleaned) || /^data:/i.test(cleaned)) {
    return null;
  }

  if (cleaned.startsWith("/vault/")) {
    return toVaultRelativePath(cleaned.slice("/vault/".length));
  }

  if (cleaned.startsWith("/")) {
    return null;
  }

  if (/^[A-Za-z]:[\\/]/.test(cleaned)) {
    const vaultRoot = resolveVaultPath(pagePath, "page").vaultRoot;
    const relative = path.relative(vaultRoot, cleaned);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    return toVaultRelativePath(relative);
  }

  const pageDir = path.posix.dirname(toVaultRelativePath(pagePath));
  return toVaultRelativePath(path.posix.normalize(path.posix.join(pageDir, cleaned)));
}

export function findEmbeddedPdfReferences(pagePath: string, html: string) {
  const $ = cheerio.load(html);
  const refs = new Map<string, { href: string; name: string }>();

  $("a[href], [data-href]").each((_index, element) => {
    const node = $(element);
    const rawHref = node.attr("href") || node.attr("data-href") || "";
    if (!/\.pdf(?:[?#]|$)/i.test(rawHref)) {
      return;
    }
    const relativePath = normalizePdfHref(pagePath, rawHref);
    if (!relativePath || !relativePath.toLowerCase().endsWith(".pdf")) {
      return;
    }
    const name = node.text().trim() || path.posix.basename(relativePath);
    refs.set(relativePath, { href: relativePath, name });
  });

  return [...refs.values()];
}

export async function extractPdfText(filePath: string) {
  const PdfParser = await getPdfParser();
  if (!PdfParser) {
    return { ok: false as const, reason: "PDF text extraction is unavailable on this server." };
  }

  try {
    const buffer = await fs.readFile(filePath);
    const parser = new PdfParser({ data: buffer });
    try {
      const result = await parser.getText();
      const text = typeof result.text === "string" ? result.text.trim() : "";
      if (!text) {
        return { ok: false as const, reason: "No readable text was extracted; the PDF may be image-only or encrypted." };
      }
      return { ok: true as const, text };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch {
    return { ok: false as const, reason: "PDF text extraction failed for this file." };
  }
}

export type PdfPageTextResult =
  | {
      ok: true;
      page: number;
      totalPages: number;
      text: string;
      truncated: boolean;
      totalChars: number;
    }
  | {
      ok: false;
      code: "PDF_UNAVAILABLE" | "PDF_PAGE_OUT_OF_RANGE" | "PDF_PAGE_EMPTY";
      reason: string;
      totalPages?: number;
    };

export type PdfPageCountResult =
  | { ok: true; totalPages: number }
  | { ok: false; code: "PDF_UNAVAILABLE"; reason: string };

export interface PdfPageRangeItem {
  page: number;
  text: string;
  truncated: boolean;
  totalChars: number;
  error?: string;
}

export type PdfPageRangeTextResult =
  | {
      ok: true;
      startPage: number;
      endPage: number;
      totalPages: number;
      pages: PdfPageRangeItem[];
      truncated: boolean;
      totalChars: number;
    }
  | {
      ok: false;
      code: "PDF_UNAVAILABLE" | "PDF_PAGE_OUT_OF_RANGE" | "PDF_PAGE_EMPTY" | "PDF_PAGE_RANGE_TOO_LARGE";
      reason: string;
      totalPages?: number;
    };

/** Extract one 1-based PDF page without parsing or returning whole-document text. */
export async function extractPdfPageText(
  filePath: string,
  page: number,
  maxChars: number = COMPANION_CONTEXT_LIMITS.maxPdfTextChars
): Promise<PdfPageTextResult> {
  if (!Number.isInteger(page) || page < 1) {
    return {
      ok: false,
      code: "PDF_PAGE_OUT_OF_RANGE",
      reason: `PDF page ${page} is out of range; page numbers start at 1.`,
    };
  }

  const PdfParser = await getPdfParser();
  if (!PdfParser) {
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      reason: "PDF text extraction is unavailable on this server.",
    };
  }

  try {
    const buffer = await fs.readFile(filePath);
    const parser = new PdfParser({ data: buffer });
    try {
      const result = await parser.getText({ partial: [page] });
      const totalPages =
        typeof result.total === "number" && Number.isInteger(result.total) && result.total >= 0
          ? result.total
          : 0;

      if (totalPages > 0 && page > totalPages) {
        return {
          ok: false,
          code: "PDF_PAGE_OUT_OF_RANGE",
          reason: `PDF page ${page} is out of range; this document has ${totalPages} page(s).`,
          totalPages,
        };
      }

      const rawText =
        typeof result.getPageText === "function"
          ? result.getPageText(page)
          : typeof result.text === "string"
            ? result.text
            : "";
      const text = rawText.trim();
      if (!text) {
        return {
          ok: false,
          code: "PDF_PAGE_EMPTY",
          reason: `No extractable text was found on PDF page ${page}; it may be image-only.`,
          totalPages: totalPages || undefined,
        };
      }

      const boundedMaxChars = Math.max(1, Math.min(maxChars, COMPANION_CONTEXT_LIMITS.maxPdfTextChars));
      return {
        ok: true,
        page,
        totalPages,
        text: text.slice(0, boundedMaxChars),
        truncated: text.length > boundedMaxChars,
        totalChars: text.length,
      };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch {
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      reason: `PDF page ${page} could not be read.`,
    };
  }
}

type ResolvedVaultPdf =
  | { ok: true; href: string; absolutePath: string }
  | { ok: false; code: "PDF_UNAVAILABLE"; reason: string; href: string };

async function resolveVaultPdf(href: string): Promise<ResolvedVaultPdf> {
  const cleaned = stripUrlNoise(safeDecodeUri(href));
  const relativePath = cleaned.startsWith("/vault/")
    ? toVaultRelativePath(cleaned.slice("/vault/".length))
    : toVaultRelativePath(cleaned);

  if (
    !relativePath ||
    !relativePath.toLowerCase().endsWith(".pdf") ||
    /^https?:\/\//i.test(cleaned) ||
    /^data:/i.test(cleaned) ||
    (cleaned.startsWith("/") && !cleaned.startsWith("/vault/")) ||
    /^[A-Za-z]:[\\/]/.test(cleaned)
  ) {
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      reason: "PDF href must identify a .pdf file inside the vault.",
      href: relativePath,
    };
  }

  try {
    const resolved = resolveVaultPath(relativePath, "section");
    const stat = await fs.stat(resolved.absolutePath).catch(() => null);
    if (!stat?.isFile()) {
      return {
        ok: false,
        code: "PDF_UNAVAILABLE",
        reason: "PDF file is missing.",
        href: relativePath,
      };
    }
    return {
      ok: true,
      href: relativePath,
      absolutePath: resolved.absolutePath,
    };
  } catch {
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      reason: "PDF path could not be resolved inside the vault.",
      href: relativePath,
    };
  }
}

/** Resolve and read a vault-relative or `/vault/...` PDF href for agent tools. */
export async function readVaultPdfPage(
  href: string,
  page: number
): Promise<PdfPageTextResult & { href: string }> {
  const resolved = await resolveVaultPdf(href);
  if (!resolved.ok) return resolved;
  return {
    ...(await extractPdfPageText(resolved.absolutePath, page)),
    href: resolved.href,
  };
}

/** Return page count without extracting document text. */
export async function readVaultPdfPageCount(
  href: string
): Promise<PdfPageCountResult & { href: string }> {
  const resolved = await resolveVaultPdf(href);
  if (!resolved.ok) return resolved;
  const PdfParser = await getPdfParser();
  if (!PdfParser) {
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      reason: "PDF metadata is unavailable on this server.",
      href: resolved.href,
    };
  }
  try {
    const parser = new PdfParser({ data: await fs.readFile(resolved.absolutePath) });
    try {
      const info = await parser.getInfo();
      const totalPages =
        typeof info.total === "number" && Number.isInteger(info.total) && info.total > 0
          ? info.total
          : 0;
      if (!totalPages) {
        return {
          ok: false,
          code: "PDF_UNAVAILABLE",
          reason: "PDF page count could not be determined.",
          href: resolved.href,
        };
      }
      return { ok: true, href: resolved.href, totalPages };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch {
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      reason: "PDF page count could not be read.",
      href: resolved.href,
    };
  }
}

/** Read a small inclusive range while keeping the combined returned text bounded. */
export async function readVaultPdfPages(
  href: string,
  startPage: number,
  endPage: number
): Promise<PdfPageRangeTextResult & { href: string }> {
  const requestedCount = endPage - startPage + 1;
  if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage) {
    return {
      ok: false,
      code: "PDF_PAGE_OUT_OF_RANGE",
      reason: "PDF page range must use 1-based integers with endPage greater than or equal to startPage.",
      href: "",
    };
  }
  if (requestedCount > COMPANION_CONTEXT_LIMITS.maxPdfPagesPerRead) {
    return {
      ok: false,
      code: "PDF_PAGE_RANGE_TOO_LARGE",
      reason: `PDF page ranges are limited to ${COMPANION_CONTEXT_LIMITS.maxPdfPagesPerRead} pages per request.`,
      href: "",
    };
  }

  const resolved = await resolveVaultPdf(href);
  if (!resolved.ok) return resolved;
  const PdfParser = await getPdfParser();
  if (!PdfParser) {
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      reason: "PDF text extraction is unavailable on this server.",
      href: resolved.href,
    };
  }

  try {
    const parser = new PdfParser({ data: await fs.readFile(resolved.absolutePath) });
    try {
      const result = await parser.getText({ first: startPage, last: endPage });
      const totalPages =
        typeof result.total === "number" && Number.isInteger(result.total) && result.total >= 0
          ? result.total
          : 0;
      if (totalPages > 0 && endPage > totalPages) {
        return {
          ok: false,
          code: "PDF_PAGE_OUT_OF_RANGE",
          reason: `PDF page range ${startPage}-${endPage} is out of range; this document has ${totalPages} page(s).`,
          totalPages,
          href: resolved.href,
        };
      }

      let remainingChars: number = COMPANION_CONTEXT_LIMITS.maxPdfTextChars;
      let totalChars = 0;
      let truncated = false;
      const pages: PdfPageRangeItem[] = [];
      for (let page = startPage; page <= endPage; page += 1) {
        const rawText =
          typeof result.getPageText === "function" ? result.getPageText(page).trim() : "";
        totalChars += rawText.length;
        if (!rawText) {
          pages.push({
            page,
            text: "",
            truncated: false,
            totalChars: 0,
            error: `No extractable text was found on PDF page ${page}; it may be image-only.`,
          });
          continue;
        }
        const text = rawText.slice(0, remainingChars);
        const pageTruncated = text.length < rawText.length;
        pages.push({ page, text, truncated: pageTruncated, totalChars: rawText.length });
        remainingChars = Math.max(0, remainingChars - text.length);
        truncated ||= pageTruncated;
      }
      if (pages.every((page) => !page.text)) {
        return {
          ok: false,
          code: "PDF_PAGE_EMPTY",
          reason: `No extractable text was found on PDF pages ${startPage}-${endPage}; they may be image-only.`,
          totalPages: totalPages || undefined,
          href: resolved.href,
        };
      }
      return {
        ok: true,
        href: resolved.href,
        startPage,
        endPage,
        totalPages,
        pages,
        truncated,
        totalChars,
      };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch {
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      reason: `PDF pages ${startPage}-${endPage} could not be read.`,
      href: resolved.href,
    };
  }
}

interface PdfContextOptions {
  /** Byte offset into the extracted text for chunked reading (default 0). */
  pdfChunkOffset?: number;
  /** Maximum characters to include per PDF file (overrides the default limit). */
  pdfMaxChars?: number;
  /** Active immersive-reader attachment href. */
  activePdfHref?: string;
  /** Display name reported by the active immersive reader. */
  activePdfFileName?: string;
  /** Current 1-based page in the active immersive reader. */
  pdfPage?: number;
  /** Page count reported by the loaded immersive reader document. */
  pdfPageCount?: number;
}

async function buildPdfContext(pagePath: string, html: string, options: PdfContextOptions = {}) {
  const allRefs = findEmbeddedPdfReferences(pagePath, html);
  const activePdfPath =
    options.activePdfHref && Number.isInteger(options.pdfPage) && (options.pdfPage ?? 0) > 0
      ? normalizePdfHref(pagePath, options.activePdfHref)
      : null;
  const currentPage = activePdfPath ? options.pdfPage : undefined;
  const activeRef = activePdfPath
    ? {
        href: activePdfPath,
        name:
          options.activePdfFileName?.trim() ||
          allRefs.find((ref) => ref.href.toLowerCase() === activePdfPath.toLowerCase())?.name ||
          path.posix.basename(activePdfPath),
      }
    : undefined;
  const refs = activeRef
    ? [activeRef]
    : allRefs.slice(0, COMPANION_CONTEXT_LIMITS.maxPdfFiles);
  const lines: string[] = [];
  const omitted = activeRef ? 0 : allRefs.length - refs.length;
  const maxChars = options.pdfMaxChars ?? COMPANION_CONTEXT_LIMITS.maxPdfTextChars;
  const chunkOffset = Math.max(0, options.pdfChunkOffset ?? 0);

  if (!refs.length) {
    return "";
  }

  lines.push(
    currentPage
      ? `## Current PDF page (${currentPage})`
      : "## Embedded PDF page context"
  );

  for (const ref of refs) {
    lines.push("", `### ${ref.name}`, `Path: ${ref.href}`);
    if (currentPage) {
      lines.push(
        `Reader state: ${JSON.stringify({
          href: ref.href,
          fileName: ref.name,
          currentPage,
          ...(Number.isInteger(options.pdfPageCount) && (options.pdfPageCount ?? 0) > 0
            ? { pageCount: options.pdfPageCount }
            : {}),
        })}`
      );
    }
    try {
      const resolved = resolveVaultPath(ref.href, "section");
      const stat = await fs.stat(resolved.absolutePath).catch(() => null);
      if (!stat?.isFile()) {
        lines.push("[PDF unavailable: file is missing.]");
        continue;
      }
      if (!currentPage && stat.size > COMPANION_CONTEXT_LIMITS.maxPdfBytes) {
        lines.push(`[PDF omitted: file is larger than ${Math.round(COMPANION_CONTEXT_LIMITS.maxPdfBytes / 1024 / 1024)} MB.]`);
        continue;
      }
      if (currentPage) {
        const extracted = await extractPdfPageText(resolved.absolutePath, currentPage, maxChars);
        if (!extracted.ok) {
          lines.push(`[${extracted.reason}]`);
        } else {
          if (!options.pdfPageCount && extracted.totalPages > 0) {
            lines.push(`Page count: ${extracted.totalPages}`);
          }
          lines.push("```text", extracted.text, "```");
          if (extracted.truncated) {
            lines.push(
              `[PDF page text truncated: showing ${extracted.text.length} of ${extracted.totalChars} characters.]`
            );
          }
        }
      } else {
        const extracted = await extractPdfText(resolved.absolutePath);
        if (!extracted.ok) {
          lines.push(`[PDF unavailable: ${extracted.reason}]`);
        } else {
          const totalChars = extracted.text.length;
          const window = extracted.text.slice(chunkOffset, chunkOffset + maxChars);
          const windowEnd = chunkOffset + window.length;
          const hasMore = windowEnd < totalChars;
          const text = hasMore ? window.trimEnd() : window;

          if (chunkOffset > 0) {
            lines.push(`(Showing characters ${chunkOffset}–${windowEnd} of ${totalChars} total.)`);
          }

          lines.push("```text", text, "```");

          if (hasMore) {
            lines.push(
              `[PDF text truncated: showing ${windowEnd} of ${totalChars} characters.` +
                ` Re-request with pdfChunkOffset=${windowEnd} to read the next section.]`
            );
          }
        }
      }

      try {
        const sidecar = await readPdfAnnotations(ref.href);

        // SN-218: reconstruct marked source text under user highlights from
        // sidecar geometry + positioned page text, so already-saved highlights
        // surface their quote without re-annotating. Prefetch only the pages that
        // actually carry a highlight lacking a persisted quote, bounded so a
        // highlight-heavy book cannot fan out into many page parses.
        const quotePages = new Set<number>();
        for (const target of collectPdfHighlightQuoteTargets(sidecar)) {
          if (target.pageIndex === null) continue;
          quotePages.add(target.pageIndex + 1);
          if (quotePages.size >= COMPANION_CONTEXT_LIMITS.maxHighlightQuotePages) break;
        }
        const pageItems = new Map<number, HighlightGeometryTextItem[] | null>();
        for (const pageNumber of quotePages) {
          pageItems.set(pageNumber, await extractPdfPageTextItems(resolved.absolutePath, pageNumber));
        }

        const summary = summarizePdfAnnotationsForCompanion(sidecar, {
          maxQuoteChars: COMPANION_CONTEXT_LIMITS.maxHighlightQuoteChars,
          resolveHighlightQuote: ({ pageIndex, segmentRects }) => {
            if (pageIndex === null) return null;
            const items = pageItems.get(pageIndex + 1);
            if (!items) return null;
            return reconstructMarkedText(segmentRects, items, {
              maxChars: COMPANION_CONTEXT_LIMITS.maxHighlightQuoteChars,
            });
          },
        });
        const annotationBlock = formatPdfAnnotationCompanionContext(
          ref.name,
          ref.href,
          summary
        );
        if (annotationBlock) {
          lines.push("", annotationBlock);
        }
      } catch {
        // Sidecar read failures must not block PDF text context.
      }
    } catch {
      lines.push("[PDF unavailable: path could not be resolved inside the vault.]");
    }
  }

  if (omitted > 0) {
    lines.push("", `[${omitted} additional embedded PDF(s) omitted by context limit.]`);
  }

  return lines.join("\n");
}

async function buildNotebookContext(
  pagePath: string,
  focus: { index?: number; cellId?: string } = {}
) {
  try {
    const page = await readPage(pagePath);
    if (page.metadata.note_type !== "jupyter") {
      return "";
    }
    return formatNotebookContext(await readNotebookContext(page.path, {
      focusedCellIndex: focus.index,
      focusedCellId: focus.cellId,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notebook context could not be read.";
    return ["## Jupyter notebook context", `[Notebook unavailable: ${message}]`].join("\n");
  }
}

export async function buildCompanionPageContext(input: {
  path: string;
  basePageContext: string;
  pdfChunkOffset?: number;
  pdfMaxChars?: number;
  activePdfHref?: string;
  activePdfFileName?: string;
  pdfPage?: number;
  pdfPageCount?: number;
  activeJupyterCellIndex?: number;
  activeJupyterCellId?: string;
}) {
  const base = input.basePageContext.trim();
  const blocks = [base].filter(Boolean);

  try {
    const page = await readPage(input.path);
    const pdfContext = await buildPdfContext(page.path, page.body, {
      pdfChunkOffset: input.pdfChunkOffset,
      pdfMaxChars: input.pdfMaxChars,
      activePdfHref: input.activePdfHref,
      activePdfFileName: input.activePdfFileName,
      pdfPage: input.pdfPage,
      pdfPageCount: input.pdfPageCount,
    });
    if (pdfContext) {
      blocks.push(pdfContext);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Page file could not be read.";
    blocks.push(["## Embedded PDF page context", `[Page assets unavailable: ${message}]`].join("\n"));
  }

  const notebookContext = await buildNotebookContext(input.path, {
    index: input.activeJupyterCellIndex,
    cellId: input.activeJupyterCellId,
  });
  if (notebookContext) {
    blocks.push(notebookContext);
  }

  return {
    pageContext: blocks.join("\n\n"),
  };
}

export const __testInternals = {
  normalizePdfHref,
};
