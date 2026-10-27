import { normalizeJupyterWorkspacePath } from "@/lib/jupyter-focus";
import { sameDeepWorkRootPath, type DeepWorkRefreshDecision, type DeepWorkSourceUpdatedEvent } from "@/lib/deep-work-refresh";

// ---------------------------------------------------------------------------
// SN-400: Follow Companion
//
// When the owner leaves Follow on, a Companion write or cell run anywhere in
// the live Deep Work root brings that file (and the touched cell) into view
// inside the running Lab frame. These pure decisions say *whether* and *where*
// to follow; the frame bridge decides whether it is safe to switch away from
// the owner's current document (it alone knows about unsaved cell edits).
// Following never remounts the Jupyter view or touches session identity.
// ---------------------------------------------------------------------------

export const DEEP_WORK_FOLLOW_STORAGE_KEY = "smart-notes:deep-work-follow-companion";

export interface DeepWorkFollowTarget {
  path: string;
  cellId: string | null;
  cellIndex: number | null;
}

export interface DeepWorkFollowRequest extends DeepWorkFollowTarget {
  nonce: number;
  /** Owner clicked "Open" on a blocked follow: switch even with unsaved edits here (Lab keeps them in their tab). */
  force?: boolean;
}

interface FollowContext {
  followEnabled: boolean;
  deepWorkActive: boolean;
  sessionRootPath: string | null;
  activeWorkspacePath: string | null;
}

export function readDeepWorkFollowPreference(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return storage?.getItem(DEEP_WORK_FOLLOW_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeDeepWorkFollowPreference(storage: Pick<Storage, "setItem"> | null | undefined, enabled: boolean): void {
  try {
    storage?.setItem(DEEP_WORK_FOLLOW_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Private mode / quota: the toggle still works for this session.
  }
}

function cellLocator(cellId: unknown, cellIndex: unknown): Pick<DeepWorkFollowTarget, "cellId" | "cellIndex"> {
  return {
    cellId: typeof cellId === "string" && cellId.trim() && cellId.length <= 200 ? cellId.trim() : null,
    cellIndex: typeof cellIndex === "number" && Number.isInteger(cellIndex) && cellIndex >= 0 && cellIndex <= 100_000 ? cellIndex : null,
  };
}

function followable(context: FollowContext, rootPath: unknown, path: unknown): string | null {
  if (!context.followEnabled || !context.deepWorkActive || !context.sessionRootPath) return null;
  if (!sameDeepWorkRootPath(rootPath, context.sessionRootPath)) return null;
  return normalizeJupyterWorkspacePath(path);
}

/**
 * A Companion write (`workspace_source_updated`). Another file is always
 * followed; the focused file only when its in-place reload went ahead and the
 * write names a cell to reveal. Saved run outputs are handled by the run path.
 */
export function deepWorkFollowFromSourceEvent(
  context: FollowContext & { refreshDecision: DeepWorkRefreshDecision },
  event: DeepWorkSourceUpdatedEvent & { cellId?: unknown; cellIndex?: unknown }
): DeepWorkFollowTarget | null {
  const path = followable(context, event?.rootPath, event?.path);
  if (!path || event.cellRunId !== undefined) return null;
  const locator = cellLocator(event.cellId, event.cellIndex);
  if (path !== normalizeJupyterWorkspacePath(context.activeWorkspacePath)) return { path, ...locator };
  if (context.refreshDecision.kind !== "reload-document") return null;
  return locator.cellId || locator.cellIndex !== null ? { path, ...locator } : null;
}

/**
 * A Companion cell run (`workspace_cell_run_updated`). Followed once per run,
 * on its first update, so later progress never fights the owner's scrolling.
 */
export function deepWorkFollowFromRunEvent(
  context: FollowContext & { followedRunIds: Set<string> },
  event: { rootPath?: unknown; path?: unknown; run?: { runId?: unknown; cell?: { cellId?: unknown; index?: unknown } } }
): DeepWorkFollowTarget | null {
  const runId = typeof event?.run?.runId === "string" ? event.run.runId : null;
  if (!runId || context.followedRunIds.has(runId)) return null;
  const path = followable(context, event?.rootPath, event?.path);
  if (!path) return null;
  context.followedRunIds.add(runId);
  if (context.followedRunIds.size > 200) context.followedRunIds.delete(context.followedRunIds.values().next().value as string);
  return { path, ...cellLocator(event.run?.cell?.cellId, event.run?.cell?.index) };
}
