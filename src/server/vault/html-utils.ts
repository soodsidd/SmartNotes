import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

function normalizePlainText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** Strip HTML tags and decode entities to plain text for search, preview, and comment anchoring. */
export function stripHtml(html: string) {
  if (!html.trim()) {
    return "";
  }
  const $ = cheerio.load(html, null, false);
  return normalizePlainText($.root().text());
}

export function htmlContainsPlainText(html: string, quote: string) {
  if (!quote) {
    return false;
  }
  return stripHtml(html).includes(quote);
}

function walkTextNodes(node: AnyNode, visit: (node: AnyNode) => boolean) {
  if (visit(node)) {
    return true;
  }
  if (node.type === "tag") {
    const element = node as Element;
    for (const child of element.children) {
      if (walkTextNodes(child, visit)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Replace the first plain-text occurrence of `quote` inside HTML body content.
 * `replacement` is inserted as raw HTML (caller should escape plain text).
 */
export function replacePlainTextInHtml(html: string, quote: string, replacement: string) {
  if (!htmlContainsPlainText(html, quote)) {
    return null;
  }

  const directIndex = html.indexOf(quote);
  if (directIndex !== -1) {
    return `${html.slice(0, directIndex)}${replacement}${html.slice(directIndex + quote.length)}`;
  }

  const $ = cheerio.load(`<body>${html}</body>`, null, false);
  const body = $("body")[0];
  if (!body) {
    return null;
  }

  let replaced = false;
  walkTextNodes(body, (node) => {
    if (node.type !== "text" || replaced) {
      return false;
    }
    const textNode = node as { data?: string };
    const text = textNode.data ?? "";
    const index = text.indexOf(quote);
    if (index === -1) {
      return false;
    }
    textNode.data = `${text.slice(0, index)}${replacement}${text.slice(index + quote.length)}`;
    replaced = true;
    return true;
  });

  if (!replaced) {
    return null;
  }

  return $("body").html() ?? "";
}

export function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
