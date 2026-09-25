/**
 * PDF outline / bookmark tree helpers for the immersive reader (SN-142).
 *
 * EmbedPDF's `@embedpdf/plugin-bookmark` exposes the document's built-in
 * outline (bookmarks) as a nested {@link PdfBookmarkObject} tree. The reader
 * renders that tree as chapter/subchapter navigation. These helpers are the
 * pure, framework-free core of that feature: resolving a bookmark's jump target
 * to a page and normalizing the raw plugin tree into a shape the UI can render
 * without repeatedly re-deriving targets.
 *
 * A bookmark's jump target is a {@link PdfLinkTarget}. Only in-document jumps
 * are navigable here — a `destination` target, or an `action` target whose
 * action is a `Goto` / `RemoteGoto`. Bookmarks with no target (heading-only
 * grouping nodes) or with unsupported actions (external URIs, launch actions —
 * out of scope for SN-142; in-PDF hyperlinks are SN-192) resolve to `null` and
 * render as non-navigable group labels.
 */

import { PdfActionType, type PdfBookmarkObject } from "@embedpdf/models";

/** A normalized outline node ready for rendering. */
export interface OutlineEntry {
  /** Bookmark label. Falls back to "Untitled" when the PDF omits a title. */
  title: string;
  /**
   * Zero-based target page for an in-document jump, or `null` when the entry
   * has no navigable destination (a heading-only grouping node).
   */
  pageIndex: number | null;
  /** Child entries (sub-chapters), already normalized. */
  children: OutlineEntry[];
}

/**
 * Resolve a bookmark's zero-based target page, or `null` when the bookmark has
 * no in-document jump target. Handles both `destination` targets and `action`
 * targets that are document jumps (`Goto` / `RemoteGoto`). All other targets
 * (external URI, launch, unsupported) resolve to `null`.
 */
export function bookmarkTargetPageIndex(
  bookmark: PdfBookmarkObject
): number | null {
  const target = bookmark.target;
  if (!target) return null;

  if (target.type === "destination") {
    return normalizePageIndex(target.destination?.pageIndex);
  }

  if (target.type === "action") {
    const action = target.action;
    if (
      action &&
      (action.type === PdfActionType.Goto ||
        action.type === PdfActionType.RemoteGoto)
    ) {
      return normalizePageIndex(action.destination?.pageIndex);
    }
  }

  return null;
}

function normalizePageIndex(pageIndex: unknown): number | null {
  if (typeof pageIndex !== "number" || !Number.isFinite(pageIndex)) return null;
  if (pageIndex < 0) return null;
  return Math.floor(pageIndex);
}

/**
 * Normalize the raw plugin bookmark tree into an {@link OutlineEntry} tree.
 *
 * Each node is flattened to `{ title, pageIndex, children }`. A node is dropped
 * entirely only when it carries neither a navigable page target nor any
 * (recursively non-empty) children — i.e. it would render as dead chrome. This
 * lets heading-only grouping nodes survive as long as they lead somewhere, and
 * keeps the reader's "no outline → no nav affordance" contract precise: an
 * empty or targetless tree yields an empty array so the caller renders nothing.
 */
export function buildPdfOutline(
  bookmarks: readonly PdfBookmarkObject[] | null | undefined
): OutlineEntry[] {
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) return [];

  const entries: OutlineEntry[] = [];
  for (const bookmark of bookmarks) {
    if (!bookmark) continue;
    const children = buildPdfOutline(bookmark.children);
    const pageIndex = bookmarkTargetPageIndex(bookmark);
    // Drop nodes that neither jump anywhere nor contain anything navigable.
    if (pageIndex === null && children.length === 0) continue;
    entries.push({
      title: typeof bookmark.title === "string" && bookmark.title.trim()
        ? bookmark.title
        : "Untitled",
      pageIndex,
      children,
    });
  }
  return entries;
}
