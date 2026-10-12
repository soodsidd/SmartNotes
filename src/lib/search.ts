import Fuse from "fuse.js";
import { stripHtml } from "@/lib/html-utils";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

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

const FUSE_OPTIONS = {
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
};

function buildSearchEntry(page: VaultPage, breadcrumb: string): SearchIndexEntry {
  return {
    path: page.path,
    title: page.title,
    bodyText: stripHtml(page.content),
    breadcrumb,
    updatedAt: page.updatedAt,
    createdAt: page.createdAt,
  };
}

function forEachTreePage(
  tree: VaultNotebook[],
  visit: (page: VaultPage, breadcrumb: string) => void
) {
  for (const notebook of tree) {
    const rootBreadcrumb = `${notebook.name} / Root`;
    for (const page of notebook.pages) {
      visit(page, rootBreadcrumb);
    }
    for (const section of notebook.sections) {
      const sectionBreadcrumb = `${notebook.name} / ${section.name}`;
      for (const page of section.pages) {
        visit(page, sectionBreadcrumb);
      }
    }
  }
}

interface IndexedPageRecord {
  page: VaultPage;
  breadcrumb: string;
  entry: SearchIndexEntry;
}

export interface VaultSearchSyncStats {
  added: number;
  updated: number;
  removed: number;
}

/**
 * SN-288: incremental whole-vault search index.
 *
 * `sync(tree)` walks the tree comparing page object identity (tree patches keep
 * unchanged page objects), so only pages that actually changed are re-stripped
 * and re-added to Fuse. Unchanged pages cost one reference comparison. Callers
 * should sync lazily (search open / idle), never on the keystroke path.
 */
export class VaultSearchIndexer {
  private records = new Map<string, IndexedPageRecord>();
  private fuse = new Fuse<SearchIndexEntry>([], FUSE_OPTIONS);
  private snapshot: VaultSearchIndex = { entries: [], fuse: this.fuse };
  private lastTree: VaultNotebook[] | null = null;

  sync(tree: VaultNotebook[]): VaultSearchSyncStats {
    const stats: VaultSearchSyncStats = { added: 0, updated: 0, removed: 0 };
    if (tree === this.lastTree) {
      return stats;
    }
    this.lastTree = tree;

    const seen = new Set<string>();
    const staleEntries = new Set<SearchIndexEntry>();
    const freshEntries: SearchIndexEntry[] = [];

    forEachTreePage(tree, (page, breadcrumb) => {
      if (seen.has(page.path)) {
        return;
      }
      seen.add(page.path);
      const existing = this.records.get(page.path);
      if (existing && existing.page === page && existing.breadcrumb === breadcrumb) {
        return;
      }
      if (
        existing &&
        existing.breadcrumb === breadcrumb &&
        existing.page.content === page.content &&
        existing.page.title === page.title &&
        existing.page.updatedAt === page.updatedAt &&
        existing.page.createdAt === page.createdAt
      ) {
        existing.page = page;
        return;
      }
      const entry = buildSearchEntry(page, breadcrumb);
      if (existing) {
        staleEntries.add(existing.entry);
        stats.updated += 1;
      } else {
        stats.added += 1;
      }
      this.records.set(page.path, { page, breadcrumb, entry });
      freshEntries.push(entry);
    });

    for (const [path, record] of this.records) {
      if (!seen.has(path)) {
        staleEntries.add(record.entry);
        this.records.delete(path);
        stats.removed += 1;
      }
    }

    if (staleEntries.size > 0) {
      this.fuse.remove((doc) => staleEntries.has(doc));
    }
    for (const entry of freshEntries) {
      this.fuse.add(entry);
    }
    if (staleEntries.size > 0 || freshEntries.length > 0) {
      this.snapshot = {
        entries: Array.from(this.records.values(), (record) => record.entry),
        fuse: this.fuse,
      };
    }
    return stats;
  }

  /** Stable until the next sync that changes content; safe as a memo dependency. */
  getIndex(): VaultSearchIndex {
    return this.snapshot;
  }
}

export const EMPTY_VAULT_SEARCH_INDEX: VaultSearchIndex = {
  entries: [],
  fuse: new Fuse<SearchIndexEntry>([], FUSE_OPTIONS),
};

export function buildVaultSearchIndex(tree: VaultNotebook[]): VaultSearchIndex {
  const indexer = new VaultSearchIndexer();
  indexer.sync(tree);
  return indexer.getIndex();
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
