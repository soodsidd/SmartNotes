import { jupyterLabWorkspaceName } from "@/lib/jupyter-page-workspace";

/**
 * SN-348: JupyterLab frames stay mounted (hidden) after the owner navigates
 * away, so returning to a Jupyter page is instant. The browser owns the live
 * iframe state; this module only decides which frames stay mounted.
 */
export const JUPYTER_FRAME_CACHE_LIMIT = 3;

export interface JupyterFrameEntry<T> {
  /** SN-347 page↔session identity (page path + bound root). */
  identity: string;
  pagePath: string;
  title: string;
  workspace: T;
  /** Bumped by Reload/Refresh; part of the React key so it remounts. */
  generation: number;
}

export function jupyterFrameIdentity(pagePath: string, rootPath?: string): string {
  return jupyterLabWorkspaceName(pagePath, rootPath);
}

/**
 * Mark a frame most-recently-used (entries are oldest first). A page re-bound
 * to a different root replaces its old frame rather than keeping both, and the
 * least-recently-used frames past `limit` are released.
 */
export function touchJupyterFrame<T>(
  entries: JupyterFrameEntry<T>[],
  frame: Omit<JupyterFrameEntry<T>, "generation">,
  limit = JUPYTER_FRAME_CACHE_LIMIT
): JupyterFrameEntry<T>[] {
  const previous = entries.find((entry) => entry.identity === frame.identity);
  const last = entries[entries.length - 1];
  if (
    last === previous && last && entries.length <= limit &&
    last.pagePath === frame.pagePath && last.title === frame.title && last.workspace === frame.workspace
  ) return entries;
  const retained = entries.filter((entry) => entry.identity !== frame.identity && entry.pagePath !== frame.pagePath);
  return [...retained, { ...frame, generation: previous?.generation ?? 0 }].slice(-Math.max(1, limit));
}

/** Explicit Reload/Refresh: remount just this frame. */
export function reloadJupyterFrame<T>(entries: JupyterFrameEntry<T>[], identity: string): JupyterFrameEntry<T>[] {
  return entries.map((entry) => entry.identity === identity
    ? { ...entry, generation: entry.generation + 1 }
    : entry);
}

/**
 * Release frames whose page was deleted or moved. The caller passes every live
 * vault page path plus the synthetic pending path of the currently armed Deep
 * Work workspace, so leaving an opened workspace (SN-266) releases its frame too.
 */
export function pruneJupyterFrames<T>(entries: JupyterFrameEntry<T>[], validPagePaths: Set<string>): JupyterFrameEntry<T>[] {
  const next = entries.filter((entry) => validPagePaths.has(entry.pagePath));
  return next.length === entries.length ? entries : next;
}

/**
 * SN-347/SN-348: drop synthetic Deep Work pending frames immediately when the
 * owner selects a vault page. Waiting for the next cache effect can leave a
 * launching/dead orphan frame as the visible surface during the handoff.
 */
export function dropDeepWorkPendingJupyterFrames<T>(entries: JupyterFrameEntry<T>[]): JupyterFrameEntry<T>[] {
  const next = entries.filter((entry) => !entry.pagePath.startsWith("deep-work-"));
  return next.length === entries.length ? entries : next;
}
