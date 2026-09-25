import { escapeHtml } from "@/lib/html-utils";

export const PAGE_PRINT_ACTIVE_CLASS = "page-print-active";

export interface PageInkExport {
  svg: string;
  width: number;
  height: number;
}

export interface PageContentExport {
  html: string;
  frameHeight: number;
}

export interface StandaloneHtmlBundleInput {
  title: string;
  bodyHtml: string;
  ink?: PageInkExport | null;
  frameHeight: number;
}

const VAULT_ASSET_PATTERN = /(?:src|href)=["'](\/vault\/[^"']+)["']/gi;

const EXPORT_CONTENT_CSS = `
:root {
  color-scheme: light;
  --foreground: #0d0d0d;
  --muted-foreground: #8e8ea0;
  --border: #e6e6eb;
  --accent: #3d8f9b;
  --font-sans: "Hanken Grotesk", system-ui, sans-serif;
  --font-serif: "Hanken Grotesk", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
  --font-accent: "Caveat", cursive;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 24px 20px 40px;
  background: #ffffff;
  color: var(--foreground);
  font-family: var(--font-serif);
}

.exported-page {
  max-width: 760px;
  margin: 0 auto;
}

.exported-page__header h1 {
  margin: 0 0 1.25rem;
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.exported-page__body {
  position: relative;
  width: 100%;
}

.exported-page__content {
  position: relative;
  z-index: 1;
}

.exported-page__ink {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: visible;
}

.exported-page__ink svg {
  display: block;
  width: 100%;
  height: 100%;
}

.editor-content {
  font-size: 16px;
  line-height: 1.72;
  color: var(--foreground);
  width: 100%;
}

.editor-content > :first-child { margin-top: 0; }

.exported-page__content.editor-content > h1:first-child {
  display: none;
}

.editor-content h1 {
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.2;
  margin: 1.5em 0 0.4em;
}

.editor-content h2 {
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 1.25em 0 0.35em;
}

.editor-content h3 {
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 1em 0 0.3em;
}

.editor-content p { margin: 0 0 0.75em; }
.editor-content strong { font-weight: 700; }
.editor-content em { font-style: italic; }
.editor-content s { text-decoration: line-through; }

.editor-content code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: rgba(13, 13, 13, 0.08);
  border-radius: 3px;
  padding: 0.1em 0.35em;
}

.editor-content pre {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: rgba(13, 13, 13, 0.06);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1em 1.25em;
  overflow-x: auto;
  margin: 1em 0;
}

.editor-content pre code {
  background: none;
  padding: 0;
}

.editor-content blockquote {
  border-left: 3px solid var(--accent);
  margin: 1em 0;
  padding-left: 1.1em;
  color: var(--muted-foreground);
  font-style: italic;
}

.editor-content hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5em 0;
}

.editor-content ul,
.editor-content ol {
  padding-left: 1.5em;
  margin: 0.5em 0 0.75em;
}

.editor-content li { margin: 0.2em 0; }
.editor-content li > p { margin: 0; }

.editor-content ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0.25em;
}

.editor-content ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
}

.editor-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  font-size: 0.9em;
}

.editor-content th,
.editor-content td {
  border: 1px solid var(--border);
  padding: 0.4em 0.75em;
  text-align: left;
}

.editor-content th {
  background: rgba(13, 13, 13, 0.05);
  font-weight: 600;
}

.editor-image,
.editor-content img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0.5rem 0;
  border-radius: 4px;
}

.editor-link,
.editor-content a {
  color: var(--accent);
  text-decoration: underline;
}

.file-attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #f1f1f4;
  font-size: 0.85rem;
}

mark {
  background-color: #f6e58d;
  border-radius: 2px;
  padding: 0 0.1em;
}

@media (max-width: 640px) {
  body { padding: 16px 14px 28px; }
  .exported-page__header h1 { font-size: 1.6rem; }
}
`;

export function sanitizeExportFilename(title: string) {
  const trimmed = title.trim() || "Untitled page";
  const sanitized = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return sanitized || "Untitled page";
}

export function collectVaultAssetUrls(html: string) {
  const urls = new Set<string>();
  for (const match of html.matchAll(VAULT_ASSET_PATTERN)) {
    const url = match[1];
    if (url) urls.add(url);
  }
  return [...urls];
}

export async function assetUrlToDataUri(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${url}`);
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read asset blob"));
    reader.readAsDataURL(blob);
  });
}

export async function inlineVaultAssetsInHtml(
  html: string,
  fetchImpl: typeof fetch = fetch
) {
  const urls = collectVaultAssetUrls(html);
  if (urls.length === 0) return html;

  const replacements = new Map<string, string>();
  await Promise.all(
    urls.map(async (url) => {
      try {
        replacements.set(url, await assetUrlToDataUri(url, fetchImpl));
      } catch {
        replacements.set(url, url);
      }
    })
  );

  let next = html;
  for (const [url, dataUri] of replacements) {
    next = next.split(url).join(dataUri);
  }
  return next;
}

export function stripDuplicatePageHeading(html: string) {
  return html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/i, "");
}

export function buildStandaloneHtmlBundle(input: StandaloneHtmlBundleInput) {
  const title = escapeHtml(input.title.trim() || "Untitled page");
  const bodyHtml = stripDuplicatePageHeading(input.bodyHtml);
  const inkLayer = input.ink
    ? `<div class="exported-page__ink" aria-hidden="true">${input.ink.svg}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="Smart Notes page export">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">
  <style>${EXPORT_CONTENT_CSS}</style>
</head>
<body>
  <article class="exported-page">
    <header class="exported-page__header">
      <h1>${title}</h1>
    </header>
    <div class="exported-page__body" style="min-height:${Math.max(input.frameHeight, 1)}px">
      <div class="exported-page__content editor-content">
        ${bodyHtml}
      </div>
      ${inkLayer}
    </div>
  </article>
</body>
</html>`;
}

export function triggerHtmlBundleDownload(filename: string, html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `${sanitizeExportFilename(filename)}.html`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function setPagePrintActive(active: boolean) {
  document.body.classList.toggle(PAGE_PRINT_ACTIVE_CLASS, active);
}

const PRINT_LEADING_H1_ATTR = "data-print-leading-h1";
const EDITOR_CONTENT_SELECTOR = '[data-testid="rich-text-editor"]';
const AI_INPUT_SELECTOR = '[data-testid="ai-input"]';
const EDITABLE_CONTROL_SELECTOR = "input, textarea, select";

export function shouldHandlePagePrintShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  if (target.closest(EDITABLE_CONTROL_SELECTOR) || target.closest(AI_INPUT_SELECTOR)) {
    return false;
  }

  const editable = target.closest("[contenteditable='true']");
  return !editable || Boolean(target.closest(EDITOR_CONTENT_SELECTOR));
}

/**
 * Mark the first h1 in the editor as the leading title heading so the @media
 * print rule can suppress it reliably regardless of ProseMirror DOM structure.
 * Call before window.print(); pair with clearPagePrintLeadingH1 in afterprint.
 */
export function setPagePrintLeadingH1(
  editorSelector = EDITOR_CONTENT_SELECTOR
): Element | null {
  const editor = document.querySelector(editorSelector);
  const firstEl = editor?.firstElementChild ?? null;
  if (firstEl?.tagName === "H1") {
    firstEl.setAttribute(PRINT_LEADING_H1_ATTR, "true");
    return firstEl;
  }
  return null;
}

export function clearPagePrintLeadingH1() {
  document
    .querySelectorAll(`[${PRINT_LEADING_H1_ATTR}]`)
    .forEach((el) => el.removeAttribute(PRINT_LEADING_H1_ATTR));
}

const PRINT_INK_SNAPSHOT_ATTR = "data-print-ink-snapshot";

export function mountPrintInkSnapshot(ink: PageInkExport, host: HTMLElement) {
  removePrintInkSnapshot();
  const layer = document.createElement("div");
  layer.setAttribute(PRINT_INK_SNAPSHOT_ATTR, "true");
  layer.className = "print-ink-snapshot";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = ink.svg;
  host.appendChild(layer);
}

export function removePrintInkSnapshot() {
  document.querySelectorAll(`[${PRINT_INK_SNAPSHOT_ATTR}]`).forEach((node) => node.remove());
}
