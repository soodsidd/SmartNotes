export interface PdfRecordSource {
  pdfPath: string;
  pdfTitle: string;
  page: number;
  quote: string | null;
  /** The source text is absent only when extraction could not recover it. */
  quoteUnavailable?: boolean;
  /** Geometry reconstruction can normalize PDF whitespace. */
  quoteRecovered?: boolean;
  /** SN-336: an image clip rendered from the PDF (figure area or full page). */
  clip?: PdfRecordClip;
}

/** Rendered-clip metadata. The PNG itself travels beside the JSON input. */
export interface PdfRecordClip {
  kind: "area" | "page";
  /** Pixel size of the stored PNG. */
  width: number;
  height: number;
}

/** Normalized crop within the displayed page frame (0..1, top-left origin). */
export interface PdfCropFraction { x: number; y: number; width: number; height: number }

/** Smallest intentional crop, as a fraction of the page's shorter side. */
export const PDF_CROP_MIN_FRACTION = 0.02;
/** Longest rendered side and total pixel budget for a stored clip. */
export const PDF_CLIP_MAX_SIDE = 2400;
export const PDF_CLIP_MAX_PIXELS = 6_000_000;
export const PDF_CLIP_MAX_BYTES = 15 * 1024 * 1024;

export interface PdfRecordInput extends PdfRecordSource {
  id: string;
  destinationPath: string;
  thought?: string;
  question?: string;
  answer?: string;
}

export function pdfRecordAnchor(id: string): string {
  return `<!-- pdf-record:${id} -->`;
}

export function escapePdfRecordHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** EmbedPDF writes the selected highlight text into custom.text at creation. */
export function exactPdfHighlightQuote(custom: unknown): string | null {
  if (!custom || typeof custom !== "object") return null;
  const value = custom as { text?: unknown; quote?: unknown };
  if (typeof value.text === "string" && value.text.length) return value.text;
  if (typeof value.quote === "string" && value.quote.length) return value.quote;
  return null;
}

/** Deterministic per-record asset name: a retry overwrites, never duplicates. */
export function pdfRecordAssetName(id: string): string {
  return `pdf-record-${id}.png`;
}

export function pdfRecordAssetPath(destinationPath: string, id: string): string {
  return `${destinationPath.replace(/\.html$/i, ".assets")}/${pdfRecordAssetName(id)}`;
}

function vaultUrl(path: string): string {
  return `/vault/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Order two drag corners into a frame-clamped crop rectangle. */
export function normalizePdfCrop(a: { x: number; y: number }, b: { x: number; y: number }): PdfCropFraction {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x1 = clamp(Math.min(a.x, b.x)), x2 = clamp(Math.max(a.x, b.x));
  const y1 = clamp(Math.min(a.y, b.y)), y2 = clamp(Math.max(a.y, b.y));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function isIntentionalPdfCrop(crop: PdfCropFraction | null): crop is PdfCropFraction {
  return Boolean(crop && crop.width >= PDF_CROP_MIN_FRACTION && crop.height >= PDF_CROP_MIN_FRACTION);
}

/**
 * Map a crop on the displayed (possibly rotated) page to the unrotated PDF
 * page rect EmbedPDF renders, in PDF points with a top-left origin.
 * `rotation` is quarter turns clockwise (EmbedPDF Rotation 0..3).
 */
export function pdfCropToPageRect(crop: PdfCropFraction, pageSize: { width: number; height: number }, rotation: number) {
  const { width: W, height: H } = pageSize;
  const turn = ((rotation % 4) + 4) % 4;
  const { x, y, width: w, height: h } = crop;
  // Inverse of the display rotation applied to normalized coordinates.
  const [nx, ny, nw, nh] = turn === 0 ? [x, y, w, h]
    : turn === 1 ? [y, 1 - x - w, h, w]
    : turn === 2 ? [1 - x - w, 1 - y - h, w, h]
    : [1 - y - h, x, h, w];
  return { origin: { x: nx * W, y: ny * H }, size: { width: nw * W, height: nh * H } };
}

/** Readable render scale: up to 4x PDF points (288 dpi), within side and pixel budgets. */
export function pdfClipScale(rectSize: { width: number; height: number }): number {
  const bySide = PDF_CLIP_MAX_SIDE / Math.max(rectSize.width, rectSize.height, 1);
  const byPixels = Math.sqrt(PDF_CLIP_MAX_PIXELS / Math.max(rectSize.width * rectSize.height, 1));
  return Math.min(4, bySide, byPixels);
}

export function pdfRecordMarkup(input: PdfRecordInput): string {
  const esc = escapePdfRecordHtml;
  const href = `${vaultUrl(input.pdfPath)}#page=${input.page}`;
  const clipLabel = input.clip?.kind === "page" ? `Page ${input.page} of ${input.pdfTitle}` : `Figure area from ${input.pdfTitle}, page ${input.page}`;
  const clip = input.clip
    ? `<p><img src="${esc(vaultUrl(pdfRecordAssetPath(input.destinationPath, input.id)))}" alt="${esc(clipLabel)}" data-pdf-record-clip="${input.clip.kind}"></p><p><em>${input.clip.kind === "page" ? "Full PDF page" : "PDF area"} rendered from the source at ${input.clip.width}×${input.clip.height}px.</em></p>`
    : "";
  const quote = input.clip && input.quote === null ? "" : input.quote === null
    ? "<p><strong>Source passage:</strong> Text unavailable from this PDF highlight.</p>"
    : `<p><strong>${input.quoteRecovered ? "Source text (recovered from PDF extraction; spacing may differ):" : "Source passage (verbatim):"}</strong></p><blockquote data-pdf-source-quote="true" style="white-space: pre-wrap">${esc(input.quote)}</blockquote>`;
  return `${pdfRecordAnchor(input.id)}\n<section data-pdf-record="${input.id}"><p><strong>${esc(input.pdfTitle)}</strong> · Page ${input.page} · <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Return to PDF source</a></p><p>PDF path: ${esc(input.pdfPath)}</p>${clip}${quote}${input.thought ? `<p><strong>My thought:</strong> ${esc(input.thought)}</p>` : ""}${input.question ? `<p><strong>Question/action:</strong> ${esc(input.question)}</p>` : ""}${input.answer ? `<p><strong>AI answer:</strong> ${esc(input.answer)}</p>` : ""}</section>\n<!-- /pdf-record:${input.id} -->`;
}

export function removePdfRecord(body: string, id: string): string | null {
  const start = body.indexOf(pdfRecordAnchor(id));
  if (start < 0) return null;
  const endMarker = `<!-- /pdf-record:${id} -->`;
  const end = body.indexOf(endMarker, start);
  if (end < 0) return null;
  return body.slice(0, start).replace(/\n$/, "") + body.slice(end + endMarker.length);
}

const CROP_STEP = 0.02;

/** Keyboard crop: arrows move, Shift+arrows resize; the first key seeds a centered area. */
export function nudgePdfCrop(crop: PdfCropFraction | null, key: string, resize: boolean): PdfCropFraction | null {
  const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[key];
  if (!crop) return delta || key === "Enter" ? { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } : null;
  if (!delta) return crop;
  const [dx, dy] = delta.map(value => value * CROP_STEP);
  if (resize) {
    return {
      ...crop,
      width: Math.min(1 - crop.x, Math.max(PDF_CROP_MIN_FRACTION, crop.width + dx)),
      height: Math.min(1 - crop.y, Math.max(PDF_CROP_MIN_FRACTION, crop.height + dy)),
    };
  }
  return {
    ...crop,
    x: Math.min(1 - crop.width, Math.max(0, crop.x + dx)),
    y: Math.min(1 - crop.height, Math.max(0, crop.y + dy)),
  };
}
