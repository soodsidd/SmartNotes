/** Returns the chain-anchor path for a music page.
 *  Top-level pages (parentId === null) are their own anchor; continuations carry the anchor in parentId.
 *  This prevents unrelated top-level music pages from grouping together (SN-417 reviewer fix). */
export function musicChainAnchor(page: { path: string; parentId: string | null }): string {
  return page.parentId ?? page.path;
}

/** Filters containerPages to those belonging to the same chain as activePage. */
export function filterMusicChain<T extends { path: string; title: string; noteType?: string; parentId: string | null }>(
  containerPages: T[],
  activePage: { path: string; parentId: string | null }
): Array<{ path: string; title: string }> {
  const anchor = musicChainAnchor(activePage);
  return containerPages
    .filter((p) => p.noteType === "music" && musicChainAnchor(p) === anchor)
    .map((p) => ({ path: p.path, title: p.title }));
}
