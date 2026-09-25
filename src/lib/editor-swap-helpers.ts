import type { CachedPageEntry } from "@/lib/page-content-cache";

export interface PageDraftLike {
  path: string;
  title: string;
  content: string;
}

function escapeHtmlForEditor(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildEffectiveEditorHtml(draft: PageDraftLike, previewContent?: string): string {
  const sourceContent = previewContent ?? draft.content;
  if (sourceContent.trimStart().startsWith("<") || sourceContent.trimStart().startsWith("<!")) {
    return sourceContent;
  }

  const body = sourceContent.trim() ? sourceContent : "<p></p>";
  return `<h1>${escapeHtmlForEditor(draft.title)}</h1>${body}`;
}

export type PageSwapReadiness = "ready" | "pending-annotations";

export interface PageSwapPlan {
  path: string;
  html: string;
  readiness: PageSwapReadiness;
  annotationsScene: unknown | null;
}

export function planPageSwap(
  draft: PageDraftLike,
  cacheEntry: CachedPageEntry | undefined,
  previewContent?: string
): PageSwapPlan {
  const annotationsReady = cacheEntry?.annotationsReady === true;

  return {
    path: draft.path,
    html: buildEffectiveEditorHtml(draft, previewContent),
    readiness: annotationsReady ? "ready" : "pending-annotations",
    annotationsScene: annotationsReady ? (cacheEntry?.annotationsScene ?? null) : null,
  };
}
