export interface PdfRecordSource {
  pdfPath: string;
  pdfTitle: string;
  page: number;
  quote: string | null;
  /** The source text is absent only when extraction could not recover it. */
  quoteUnavailable?: boolean;
  /** Geometry reconstruction can normalize PDF whitespace. */
  quoteRecovered?: boolean;
}

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

export function pdfRecordMarkup(input: PdfRecordInput): string {
  const esc = escapePdfRecordHtml;
  const href = `/vault/${input.pdfPath.split("/").map(encodeURIComponent).join("/")}#page=${input.page}`;
  const quote = input.quote === null
    ? "<p><strong>Source passage:</strong> Text unavailable from this PDF highlight.</p>"
    : `<p><strong>${input.quoteRecovered ? "Source text (recovered from PDF extraction; spacing may differ):" : "Source passage (verbatim):"}</strong></p><blockquote data-pdf-source-quote="true" style="white-space: pre-wrap">${esc(input.quote)}</blockquote>`;
  return `${pdfRecordAnchor(input.id)}\n<section data-pdf-record="${input.id}"><p><strong>${esc(input.pdfTitle)}</strong> · Page ${input.page} · <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Return to PDF source</a></p><p>PDF path: ${esc(input.pdfPath)}</p>${quote}${input.thought ? `<p><strong>My thought:</strong> ${esc(input.thought)}</p>` : ""}${input.question ? `<p><strong>Question/action:</strong> ${esc(input.question)}</p>` : ""}${input.answer ? `<p><strong>AI answer:</strong> ${esc(input.answer)}</p>` : ""}</section>\n<!-- /pdf-record:${input.id} -->`;
}

export function removePdfRecord(body: string, id: string): string | null {
  const start = body.indexOf(pdfRecordAnchor(id));
  if (start < 0) return null;
  const endMarker = `<!-- /pdf-record:${id} -->`;
  const end = body.indexOf(endMarker, start);
  if (end < 0) return null;
  return body.slice(0, start).replace(/\n$/, "") + body.slice(end + endMarker.length);
}
