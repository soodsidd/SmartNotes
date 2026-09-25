function normalizePlainText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase();

    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos" || normalized === "#39") return "'";
    if (normalized === "nbsp") return " ";

    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return entity;
  });
}

/** Strip HTML tags and decode entities to plain text for search and previews. */
export function stripHtml(html: string) {
  if (!html.trim()) {
    return "";
  }

  const withStructuralBreaks = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/blockquote|\/section|\/article|\/pre)\b[^>]*>/gi, "\n")
    .replace(/<(p|div|li|tr|h[1-6]|blockquote|section|article|pre)\b[^>]*>/gi, " ");

  const withoutTags = withStructuralBreaks.replace(/<[^>]+>/g, " ");
  return normalizePlainText(decodeHtmlEntities(withoutTags));
}

export function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
