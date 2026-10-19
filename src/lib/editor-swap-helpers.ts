import type { CachedPageEntry } from "@/lib/page-content-cache";

export interface PageDraftLike {
  path: string;
  title: string;
  content: string;
}

export function stripLegacyPageTitle(content: string, title: string): string {
  const match = content.match(/^\s*<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i);
  if (!match) return content;
  const heading = match[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
  return heading === title.trim() ? content.slice(match[0].length) : content;
}

export function buildEffectiveEditorHtml(draft: PageDraftLike, previewContent?: string): string {
  const sourceContent = previewContent ?? draft.content;
  if (sourceContent.trimStart().startsWith("<") || sourceContent.trimStart().startsWith("<!")) {
    return stripLegacyPageTitle(sourceContent, draft.title) || "<p></p>";
  }

  const body = sourceContent.trim() ? sourceContent : "<p></p>";
  return body;
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
