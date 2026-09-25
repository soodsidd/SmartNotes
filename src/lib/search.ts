import Fuse from "fuse.js";
import { stripHtml } from "@/lib/html-utils";
import type { VaultNotebook } from "@/lib/vault-contract";

export interface SearchHighlightRange {
  start: number;
  end: number;
}

export interface SearchResult {
  path: string;
  title: string;
  breadcrumb: string;
  excerpt: string;
  updatedAt: string | null;
  titleHighlights?: SearchHighlightRange[];
  excerptHighlights?: SearchHighlightRange[];
  source?: "client" | "server" | "recent";
}

interface SearchIndexEntry {
  path: string;
  title: string;
  bodyText: string;
  breadcrumb: string;
  updatedAt: string | null;
  createdAt: string | null;
}

export interface VaultSearchIndex {
  entries: SearchIndexEntry[];
  fuse: Fuse<SearchIndexEntry>;
}

const EXCERPT_TARGET_LENGTH = 120;

function parseTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSnippet(
  source: string,
  matchStart: number | null,
  matchLength: number,
  targetLength = EXCERPT_TARGET_LENGTH
) {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    return { excerpt: "", excerptHighlights: [] as SearchHighlightRange[] };
  }

  if (matchStart === null || matchStart < 0) {
    const preview = normalizedSource.slice(0, targetLength).trimEnd();
    return {
      excerpt: preview.length < normalizedSource.length ? `${preview}...` : preview,
      excerptHighlights: [] as SearchHighlightRange[],
    };
  }

  const safeMatchLength = Math.max(matchLength, 1);
  const halfWindow = Math.max(0, Math.floor((targetLength - safeMatchLength) / 2));
  let start = Math.max(0, matchStart - halfWindow);
  let end = Math.min(normalizedSource.length, matchStart + safeMatchLength + halfWindow);

  if (end - start < targetLength) {
    const remaining = targetLength - (end - start);
    start = Math.max(0, start - Math.floor(remaining / 2));
    end = Math.min(normalizedSource.length, end + Math.ceil(remaining / 2));
  }

  while (start > 0 && normalizedSource[start] !== " ") {
    start -= 1;
  }
  while (end < normalizedSource.length && normalizedSource[end - 1] !== " ") {
    end += 1;
  }

  const windowText = normalizedSource.slice(start, Math.min(end, normalizedSource.length));
  const leadingTrim = windowText.length - windowText.trimStart().length;
  const trimmedWindow = windowText.trim();
  const prefix = start > 0 ? "... " : "";
  const suffix = end < normalizedSource.length ? " ..." : "";
  const highlightStart = prefix.length + matchStart - start - leadingTrim;
  const highlightEnd = highlightStart + safeMatchLength;

  return {
    excerpt: `${prefix}${trimmedWindow}${suffix}`,
    excerptHighlights:
      highlightStart >= prefix.length && highlightStart < prefix.length + trimmedWindow.length
        ? [
            {
              start: highlightStart,
              end: Math.min(prefix.length + trimmedWindow.length, highlightEnd),
            },
          ]
        : ([] as SearchHighlightRange[]),
  };
}

function mapFuseRanges(ranges: readonly Readonly<[number, number]>[] | undefined) {
  if (!ranges?.length) {
    return [] as SearchHighlightRange[];
  }

  return ranges.map(([start, end]) => ({
    start,
    end: end + 1,
  }));
}

function sortByRecent(entries: SearchIndexEntry[]) {
  return [...entries].sort((left, right) => {
    const timestampDiff =
      parseTimestamp(right.updatedAt ?? right.createdAt) -
      parseTimestamp(left.updatedAt ?? left.createdAt);
    if (timestampDiff !== 0) {
      return timestampDiff;
    }
    return left.title.localeCompare(right.title);
  });
}

export function buildVaultSearchIndex(tree: VaultNotebook[]): VaultSearchIndex {
  const entries = tree.flatMap((notebook) =>
    [
      ...notebook.pages.map((page) => ({
        path: page.path,
        title: page.title,
        bodyText: stripHtml(page.content),
        breadcrumb: `${notebook.name} / Root`,
        updatedAt: page.updatedAt,
        createdAt: page.createdAt,
      })),
      ...notebook.sections.flatMap((section) =>
        section.pages.map((page) => ({
        path: page.path,
        title: page.title,
        bodyText: stripHtml(page.content),
        breadcrumb: `${notebook.name} / ${section.name}`,
        updatedAt: page.updatedAt,
        createdAt: page.createdAt,
        }))
      ),
    ]
  );

  return {
    entries,
    fuse: new Fuse(entries, {
      includeMatches: true,
      includeScore: true,
      shouldSort: true,
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 1,
      keys: [
        { name: "title", weight: 0.45 },
        { name: "bodyText", weight: 0.55 },
      ],
    }),
  };
}

export function buildRecentSearchResults(index: VaultSearchIndex, limit = 8): SearchResult[] {
  return sortByRecent(index.entries)
    .slice(0, limit)
    .map((entry) => ({
      path: entry.path,
      title: entry.title,
      breadcrumb: entry.breadcrumb,
      excerpt: buildSnippet(entry.bodyText, null, 0).excerpt,
      excerptHighlights: [],
      updatedAt: entry.updatedAt,
      source: "recent",
    }));
}

export function searchVaultIndex(index: VaultSearchIndex, query: string, limit = 20): SearchResult[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  return index.fuse.search(normalizedQuery, { limit }).map(({ item, matches }) => {
    const titleMatch = matches?.find((match) => match.key === "title");
    const bodyMatch = matches?.find((match) => match.key === "bodyText");
    const bodyRange = bodyMatch?.indices?.[0];
    const snippet = buildSnippet(
      item.bodyText,
      bodyRange?.[0] ?? null,
      bodyRange ? bodyRange[1] - bodyRange[0] + 1 : normalizedQuery.length
    );

    return {
      path: item.path,
      title: item.title,
      breadcrumb: item.breadcrumb,
      excerpt: snippet.excerpt,
      excerptHighlights: snippet.excerptHighlights,
      titleHighlights: mapFuseRanges(titleMatch?.indices),
      updatedAt: item.updatedAt,
      source: "client",
    };
  });
}
