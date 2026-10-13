/**
 * SN-302 follow-up: remember the referring page's editor scroll when opening a
 * paper so "Back to topic" can restore the exact viewport.
 */

export type PaperReturnScroll = {
  path: string;
  scrollTop: number;
};

export function capturePaperReturnScroll(
  path: string | null | undefined,
  scrollTop: number | null | undefined
): PaperReturnScroll | null {
  if (!path || typeof scrollTop !== "number" || !Number.isFinite(scrollTop)) return null;
  return { path, scrollTop: Math.max(0, scrollTop) };
}

export function resolvePaperReturnScroll(
  pending: PaperReturnScroll | null | undefined,
  activePath: string | null | undefined
): number | null {
  if (!pending || !activePath || pending.path !== activePath) return null;
  return pending.scrollTop;
}
