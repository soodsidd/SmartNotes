/**
 * PDF attachment annotation sidecar helpers (SN-136).
 *
 * EmbedPDF annotations for a vault PDF live beside the asset as
 * `<pdf-basename>.pdf.annotations.json`. The original PDF bytes are never
 * mutated — persistence is exportAnnotations()/importAnnotations() only.
 */

export const PDF_ANNOTATION_SIDECAR_VERSION = 1 as const;
export const PDF_ANNOTATION_SOURCE = "embedpdf-annotation" as const;

/** Tools exposed in Annotate mode (ink + native highlight). */
export const PDF_ANNOTATE_TOOLS = ["ink", "highlight"] as const;
export type PdfAnnotateToolId = (typeof PDF_ANNOTATE_TOOLS)[number];

export interface PdfAnnotationTransferItem {
  annotation: Record<string, unknown>;
  ctx?: Record<string, unknown>;
}

export interface PdfAnnotationSidecar {
  version: typeof PDF_ANNOTATION_SIDECAR_VERSION;
  source: typeof PDF_ANNOTATION_SOURCE;
  items: PdfAnnotationTransferItem[];
}

/** Strip query/hash and safely decode a vault URL segment. */
function stripUrlNoise(input: string): string {
  return input.split("#")[0]!.split("?")[0]!.trim();
}

function safeDecodeUri(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

/**
 * Convert a PDF `/vault/...` href into a vault-relative PDF path.
 * Returns null when the href is missing or not a PDF asset path.
 */
export function vaultHrefToPdfPath(href: string): string | null {
  const cleaned = stripUrlNoise(safeDecodeUri(href.trim()));
  if (!cleaned) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return null;

  let relative = cleaned;
  if (relative.startsWith("/vault/")) {
    relative = relative.slice("/vault/".length);
  } else if (relative.startsWith("/")) {
    return null;
  }

  relative = relative.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relative || relative.split("/").some((s) => s === "." || s === "..")) {
    return null;
  }
  if (!relative.toLowerCase().endsWith(".pdf")) {
    return null;
  }
  return relative;
}

/** Sidecar path beside a PDF asset: `note.assets/paper.pdf` → `note.assets/paper.pdf.annotations.json`. */
export function pdfAnnotationSidecarPath(pdfPath: string): string {
  const normalized = pdfPath.replaceAll("\\", "/");
  if (!normalized.toLowerCase().endsWith(".pdf")) {
    throw new Error("PDF annotation sidecar requires a .pdf path.");
  }
  return `${normalized}.annotations.json`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** EmbedPDF subtype ids we care about for sidecars and companion summaries. */
const PDF_SUBTYPE_HIGHLIGHT = 9;
const PDF_SUBTYPE_INK = 15;

/**
 * Only user-authored subtypes may live in the sidecar. EmbedPDF's
 * exportAnnotations() dumps the whole annotation store — including native PDF
 * annotations (links, widgets) discovered while pages render. A link-heavy
 * book exported ~7.4k LINK annotations into a 3.4MB sidecar whose re-import
 * froze the main thread for ~50s on every open (SN-151).
 */
const USER_AUTHORED_SUBTYPES: ReadonlySet<number> = new Set([
  PDF_SUBTYPE_HIGHLIGHT,
  PDF_SUBTYPE_INK,
]);

/** Keep only user-authored (ink/highlight) transfer items. */
export function filterUserAuthoredAnnotationItems<T>(items: T[]): T[] {
  return items.filter((entry) => {
    if (!isPlainObject(entry)) return false;
    const annotation = (entry as Record<string, unknown>).annotation;
    if (!isPlainObject(annotation)) return false;
    return (
      typeof annotation.type === "number" &&
      USER_AUTHORED_SUBTYPES.has(annotation.type)
    );
  });
}

/**
 * Validate and normalize a sidecar payload. Unknown/malformed input yields an
 * empty item list so a corrupt file never blocks reopening the reader.
 */
export function parsePdfAnnotationSidecar(data: unknown): PdfAnnotationSidecar {
  const empty: PdfAnnotationSidecar = {
    version: PDF_ANNOTATION_SIDECAR_VERSION,
    source: PDF_ANNOTATION_SOURCE,
    items: [],
  };
  if (!isPlainObject(data)) return empty;

  const rawItems = data.items;
  if (!Array.isArray(rawItems)) return empty;

  const items: PdfAnnotationTransferItem[] = [];
  for (const entry of rawItems) {
    if (!isPlainObject(entry) || !isPlainObject(entry.annotation)) continue;
    const type = entry.annotation.type;
    if (typeof type !== "number" || !USER_AUTHORED_SUBTYPES.has(type)) continue;
    const item: PdfAnnotationTransferItem = {
      annotation: entry.annotation,
    };
    if (isPlainObject(entry.ctx)) {
      // Drop non-JSON-safe stamp binary contexts; ink/highlight need none.
      const { data: _data, appearance: _appearance, imageData: _imageData, ...rest } = entry.ctx;
      if (Object.keys(rest).length > 0) {
        item.ctx = rest;
      }
    }
    items.push(item);
  }

  return {
    version: PDF_ANNOTATION_SIDECAR_VERSION,
    source: PDF_ANNOTATION_SOURCE,
    items,
  };
}

/** Build a JSON-serializable sidecar from exported EmbedPDF transfer items. */
export function buildPdfAnnotationSidecar(
  items: unknown
): PdfAnnotationSidecar {
  return parsePdfAnnotationSidecar({
    version: PDF_ANNOTATION_SIDECAR_VERSION,
    source: PDF_ANNOTATION_SOURCE,
    items: Array.isArray(items) ? items : [],
  });
}

export function serializePdfAnnotationSidecar(sidecar: PdfAnnotationSidecar): string {
  return `${JSON.stringify(sidecar)}\n`;
}

/** Axis-aligned rectangle in EmbedPDF page space (top-left origin, y grows down, PDF points). */
export interface RectGeometry {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * A single positioned run of page text in the SAME coordinate space EmbedPDF
 * uses for annotation geometry: top-left origin, y grows downward, unscaled PDF
 * points. The server adapter (pdfjs at scale 1) produces these; the pure matcher
 * below stays free of any PDF engine so it can be unit-tested with synthetic
 * geometry.
 */
export interface HighlightGeometryTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function isRectGeometry(value: unknown): value is RectGeometry {
  if (!isPlainObject(value)) return false;
  const origin = value.origin;
  const size = value.size;
  return (
    isPlainObject(origin) &&
    isPlainObject(size) &&
    typeof origin.x === "number" &&
    typeof origin.y === "number" &&
    typeof size.width === "number" &&
    typeof size.height === "number"
  );
}

/** Minimum fraction of a text run that must overlap a highlight rect to count as marked. */
const HIGHLIGHT_OVERLAP_RATIO = 0.3;

/**
 * SN-218: reconstruct the marked source text under a highlight from its
 * `segmentRects` geometry plus positioned page text. Conservative by design — a
 * run is only included when it overlaps a highlight rect on both axes by at least
 * {@link HIGHLIGHT_OVERLAP_RATIO}, so mild geometry drift yields *no* text rather
 * than a neighbouring passage (never invent the marked text). Returns null when
 * nothing overlaps confidently.
 */
export function reconstructMarkedText(
  segmentRects: unknown,
  items: HighlightGeometryTextItem[],
  options?: { maxChars?: number }
): { text: string; truncated: boolean } | null {
  const maxChars = Math.max(1, options?.maxChars ?? 280);
  if (!Array.isArray(segmentRects) || !Array.isArray(items) || items.length === 0) {
    return null;
  }
  const rects = segmentRects
    .filter(isRectGeometry)
    .map((rect) => ({
      x: rect.origin.x,
      y: rect.origin.y,
      w: rect.size.width,
      h: rect.size.height,
    }))
    .filter((rect) => rect.w > 0 && rect.h > 0);
  if (rects.length === 0) return null;

  const picked: HighlightGeometryTextItem[] = [];
  for (const item of items) {
    if (!item || typeof item.text !== "string" || !item.text.trim()) continue;
    if (!(item.width > 0) || !(item.height > 0)) continue;
    for (const rect of rects) {
      const vOverlap =
        Math.min(item.y + item.height, rect.y + rect.h) - Math.max(item.y, rect.y);
      const hOverlap =
        Math.min(item.x + item.width, rect.x + rect.w) - Math.max(item.x, rect.x);
      if (vOverlap <= 0 || hOverlap <= 0) continue;
      if (vOverlap / item.height >= HIGHLIGHT_OVERLAP_RATIO && hOverlap / item.width >= HIGHLIGHT_OVERLAP_RATIO) {
        picked.push(item);
        break;
      }
    }
  }
  if (picked.length === 0) return null;

  // Reading order: top-to-bottom by line, then left-to-right within a line.
  picked.sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > Math.min(a.height, b.height) * 0.6) return dy;
    return a.x - b.x;
  });

  const text = picked
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length > maxChars) {
    return { text: `${text.slice(0, maxChars).trimEnd()}…`, truncated: true };
  }
  return { text, truncated: false };
}

/** A persisted marked-text quote stored on a highlight annotation, if any. */
function readPersistedQuote(annotation: Record<string, unknown>): string {
  const custom = annotation.custom;
  if (!isPlainObject(custom)) return "";
  const quote = custom.quote;
  return typeof quote === "string" ? quote.trim() : "";
}

/** A highlight whose marked text must be recovered from geometry (no persisted quote). */
export interface PdfHighlightQuoteTarget {
  pageIndex: number | null;
  segmentRects: RectGeometry[];
}

/**
 * SN-218: highlights that carry usable `segmentRects` but no persisted quote, so
 * the caller knows which pages to extract positioned text for before summarizing.
 */
export function collectPdfHighlightQuoteTargets(
  sidecar: PdfAnnotationSidecar
): PdfHighlightQuoteTarget[] {
  const targets: PdfHighlightQuoteTarget[] = [];
  for (const item of sidecar.items) {
    if (item.annotation.type !== PDF_SUBTYPE_HIGHLIGHT) continue;
    if (readPersistedQuote(item.annotation)) continue;
    const segmentRects = Array.isArray(item.annotation.segmentRects)
      ? item.annotation.segmentRects.filter(isRectGeometry)
      : [];
    if (segmentRects.length === 0) continue;
    const pageIndex =
      typeof item.annotation.pageIndex === "number" ? item.annotation.pageIndex : null;
    targets.push({ pageIndex, segmentRects });
  }
  return targets;
}

/** One summarized user-authored highlight: page, marked text, and any comment. */
export interface PdfAnnotationHighlightSummary {
  pageIndex: number | null;
  /** Owner comment on the highlight (`contents`), when present. */
  note?: string;
  /** Recovered marked source text (persisted quote or geometry reconstruction). */
  quote?: string;
  /** True when the quote was capped to the character budget. */
  quoteTruncated?: boolean;
  /** True when marked text could not be recovered (image-only / missing geometry). */
  quoteUnavailable?: boolean;
}

export interface PdfAnnotationCompanionSummary {
  inkCount: number;
  highlightCount: number;
  /** Back-compat: highlights that carry a non-empty `contents` note. */
  commentedHighlights: Array<{
    pageIndex: number | null;
    note: string;
  }>;
  /** SN-218: per user-authored highlight — page, marked text, and comment. */
  highlights: PdfAnnotationHighlightSummary[];
  /** Highlights with quote/comment that exceeded the entry cap and were dropped. */
  omittedHighlights: number;
}

/** Resolve marked text for a highlight from page geometry (server-injected). */
export type HighlightQuoteResolver = (input: {
  pageIndex: number | null;
  segmentRects: RectGeometry[];
}) => { text: string; truncated: boolean } | null;

/**
 * Compact companion-facing summary of a PDF annotation sidecar. Caps note and
 * quote text so a large sidecar cannot blow the model context window. When a
 * {@link HighlightQuoteResolver} is supplied, each highlight without a persisted
 * quote gets its marked text reconstructed from geometry; failures are reported
 * honestly as unavailable rather than invented (SN-218).
 */
export function summarizePdfAnnotationsForCompanion(
  sidecar: PdfAnnotationSidecar,
  options?: {
    maxNotes?: number;
    maxNoteChars?: number;
    maxHighlights?: number;
    maxQuoteChars?: number;
    resolveHighlightQuote?: HighlightQuoteResolver;
  }
): PdfAnnotationCompanionSummary {
  const maxNotes = options?.maxNotes ?? 40;
  const maxNoteChars = options?.maxNoteChars ?? 400;
  const maxHighlights = options?.maxHighlights ?? 40;
  const maxQuoteChars = options?.maxQuoteChars ?? 280;
  const resolveQuote = options?.resolveHighlightQuote;
  let inkCount = 0;
  let highlightCount = 0;
  const commentedHighlights: PdfAnnotationCompanionSummary["commentedHighlights"] = [];
  const highlights: PdfAnnotationHighlightSummary[] = [];
  let omittedHighlights = 0;

  const boundQuote = (text: string): { quote: string; truncated: boolean } => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length > maxQuoteChars) {
      return { quote: `${trimmed.slice(0, maxQuoteChars).trimEnd()}…`, truncated: true };
    }
    return { quote: trimmed, truncated: false };
  };

  for (const item of sidecar.items) {
    const type = item.annotation.type;
    const pageIndex =
      typeof item.annotation.pageIndex === "number" ? item.annotation.pageIndex : null;
    if (type === PDF_SUBTYPE_INK) {
      inkCount += 1;
      continue;
    }
    if (type !== PDF_SUBTYPE_HIGHLIGHT) continue;

    highlightCount += 1;
    const rawNote =
      typeof item.annotation.contents === "string" ? item.annotation.contents.trim() : "";
    const note = rawNote
      ? rawNote.length > maxNoteChars
        ? `${rawNote.slice(0, maxNoteChars)}…`
        : rawNote
      : "";
    if (note && commentedHighlights.length < maxNotes) {
      commentedHighlights.push({ pageIndex, note });
    }

    // Marked text: persisted quote wins; otherwise reconstruct from geometry.
    const entry: PdfAnnotationHighlightSummary = { pageIndex };
    let quoteFound = false;
    const persisted = readPersistedQuote(item.annotation);
    const segmentRects = Array.isArray(item.annotation.segmentRects)
      ? item.annotation.segmentRects.filter(isRectGeometry)
      : [];
    if (persisted) {
      const { quote, truncated } = boundQuote(persisted);
      entry.quote = quote;
      if (truncated) entry.quoteTruncated = true;
      quoteFound = true;
    } else if (resolveQuote) {
      const reconstructed = resolveQuote({ pageIndex, segmentRects });
      if (reconstructed && reconstructed.text.trim()) {
        const { quote, truncated } = boundQuote(reconstructed.text);
        entry.quote = quote;
        if (truncated || reconstructed.truncated) entry.quoteTruncated = true;
        quoteFound = true;
      } else {
        entry.quoteUnavailable = true;
      }
    }

    if (note) entry.note = note;

    // Surface an entry only when it says something beyond the bare count: a
    // recovered quote, an owner comment, or an honest "unavailable" for a
    // commented highlight whose text could not be recovered.
    const worthListing = quoteFound || Boolean(note);
    if (worthListing) {
      if (highlights.length < maxHighlights) {
        highlights.push(entry);
      } else {
        omittedHighlights += 1;
      }
    }
  }

  return { inkCount, highlightCount, commentedHighlights, highlights, omittedHighlights };
}

/** Markdown block for companion page context (empty string when nothing to report). */
export function formatPdfAnnotationCompanionContext(
  pdfName: string,
  pdfPath: string,
  summary: PdfAnnotationCompanionSummary
): string {
  if (
    summary.inkCount === 0 &&
    summary.highlightCount === 0 &&
    summary.highlights.length === 0
  ) {
    return "";
  }
  const lines = [
    `### Annotations — ${pdfName}`,
    `Path: ${pdfPath}`,
    `Ink strokes: ${summary.inkCount}; highlights: ${summary.highlightCount}.`,
  ];
  if (summary.highlights.length > 0) {
    lines.push("Highlighted passages (marked source text; annotation summary, not the full page):");
    for (const entry of summary.highlights) {
      const page = entry.pageIndex === null ? "page ?" : `page ${entry.pageIndex + 1}`;
      const marked = entry.quote
        ? `“${entry.quote}”${entry.quoteTruncated ? " (marked text truncated)" : ""}`
        : entry.quoteUnavailable
          ? "[marked text unavailable — not extractable from this page]"
          : "[marked text not summarized]";
      const comment = entry.note ? ` — comment: ${entry.note}` : "";
      lines.push(`- (${page}) ${marked}${comment}`);
    }
    if (summary.omittedHighlights > 0) {
      lines.push(`[${summary.omittedHighlights} additional annotated highlight(s) omitted by context limit.]`);
    }
  }
  return lines.join("\n");
}
