import { stripHtml } from "./html-utils";
import { VaultError } from "./errors";
import { readVaultTree } from "./pages";
import type { SearchResult } from "@/lib/search";

const EXCERPT_TARGET_LENGTH = 120;

function buildExcerpt(source: string, matchStart: number | null, matchLength: number) {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    return "";
  }

  if (matchStart === null || matchStart < 0) {
    const preview = normalizedSource.slice(0, EXCERPT_TARGET_LENGTH).trimEnd();
    return preview.length < normalizedSource.length ? `${preview}...` : preview;
  }

  const safeMatchLength = Math.max(matchLength, 1);
  const halfWindow = Math.max(0, Math.floor((EXCERPT_TARGET_LENGTH - safeMatchLength) / 2));
  let start = Math.max(0, matchStart - halfWindow);
  let end = Math.min(normalizedSource.length, matchStart + safeMatchLength + halfWindow);

  if (end - start < EXCERPT_TARGET_LENGTH) {
    const remaining = EXCERPT_TARGET_LENGTH - (end - start);
    start = Math.max(0, start - Math.floor(remaining / 2));
    end = Math.min(normalizedSource.length, end + Math.ceil(remaining / 2));
  }

  while (start > 0 && normalizedSource[start] !== " ") {
    start -= 1;
  }
  while (end < normalizedSource.length && normalizedSource[end - 1] !== " ") {
    end += 1;
  }

  const excerpt = normalizedSource.slice(start, Math.min(end, normalizedSource.length)).trim();
  return `${start > 0 ? "... " : ""}${excerpt}${end < normalizedSource.length ? " ..." : ""}`;
}

export async function searchVault(query: string, limit = 20): Promise<SearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    throw new VaultError("INVALID_INPUT", '"query" is required for page search.');
  }

  const tree = await readVaultTree();
  const matches: SearchResult[] = [];

  for (const notebook of tree.tree) {
    const pageGroups = [
      { breadcrumb: `${notebook.name} / Root`, pages: notebook.pages },
      ...notebook.sections.map((section) => ({
        breadcrumb: `${notebook.name} / ${section.name}`,
        pages: section.pages,
      })),
    ];

    for (const group of pageGroups) {
      for (const page of group.pages) {
        const bodyText = stripHtml(page.content);
        const titleIndex = page.title.toLowerCase().indexOf(normalizedQuery);
        const bodyIndex = bodyText.toLowerCase().indexOf(normalizedQuery);

        if (titleIndex === -1 && bodyIndex === -1) {
          continue;
        }

        matches.push({
          path: page.path,
          title: page.title,
          breadcrumb: group.breadcrumb,
          excerpt: buildExcerpt(
            bodyIndex >= 0 ? bodyText : page.title,
            bodyIndex >= 0 ? bodyIndex : titleIndex,
            normalizedQuery.length
          ),
          updatedAt: page.updatedAt,
          source: "server",
        });

        if (matches.length >= limit) {
          return matches;
        }
      }
    }
  }

  return matches;
}
