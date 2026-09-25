import { normalizeJupyterWorkspacePath } from "@/lib/jupyter-focus";

// ---------------------------------------------------------------------------
// Deep Work refresh boundary (SN-270)
//
// A Companion (or any external) edit to a file inside the owner-selected Deep
// Work root must refresh what the owner is looking at *without* disturbing the
// session identity around it. The persisted root, the sticky localStorage
// record, the capability-bound Companion context, the active file, and the
// rooted Jupyter server are session identity; the rendered document is the only
// disposable part.
//
// Before SN-270 the shell had exactly one Jupyter refresh mechanism: bump
// `jupyterReloadNonce`, which is part of the `JupyterNotebookView` React `key`.
// That remounts the view, so the launch effect re-runs and the workspace
// session, its capability, the focus state, and the embedded Lab frame are all
// destroyed. Using it for a Deep Work surface throws away the root to show a
// changed cell.
//
// This module owns the two decisions that keep those apart, as pure functions
// so both can be proven without React, a socket, or a live Jupyter server:
//
//   1. `deepWorkSourceRefreshDecision` - what an external write to the root
//      should do. It can only ever ask for an *in-place* document reload; a
//      remount is not in its vocabulary.
//   2. `stickyRootRevalidationDisposition` - whether a failed root
//      revalidation is definitive enough to forget the remembered root.
// ---------------------------------------------------------------------------

/** Wire shape of the `workspace_source_updated` socket event. */
export interface DeepWorkSourceUpdatedEvent {
  /** Server-resolved real root the write landed under. */
  rootPath?: unknown;
  /** Root-relative POSIX path of the written file. */
  path?: unknown;
  /** Content revision after the write. */
  revision?: unknown;
}

export type DeepWorkRefreshIgnoreReason =
  | "no-deep-work"
  | "session-not-ready"
  | "other-workspace"
  | "unsafe-path"
  | "not-active-file";

export type DeepWorkRefreshDecision =
  /** Nothing to do. `reason` is diagnostic only and never shown to the owner. */
  | { kind: "ignore"; reason: DeepWorkRefreshIgnoreReason }
  /** Reload just this document inside the running Lab frame. No remount. */
  | { kind: "reload-document"; path: string }
  /** The owner has unsaved work in this document; never revert it silently. */
  | { kind: "blocked-dirty"; path: string };

function normalizeRoot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  const unified = trimmed.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (!unified) return null;
  // Windows paths are case-insensitive; a UNIX root is compared verbatim.
  return /^[a-z]:(\/|$)/i.test(unified) ? unified.toLowerCase() : unified;
}

/**
 * Compare two absolute roots. The event carries the server-resolved `realRoot`
 * and the client compares it against the same value echoed back by the live
 * session, so this is normally an exact match; normalization only absorbs
 * separator and trailing-slash drift, plus Windows drive-letter case.
 */
function sameRoot(a: unknown, b: unknown): boolean {
  const left = normalizeRoot(a);
  const right = normalizeRoot(b);
  return left !== null && right !== null && left === right;
}

/**
 * What an external write inside the Deep Work root should do to the embedded
 * Jupyter surface.
 *
 * Deliberate boundaries:
 *
 *   - A live workspace session root is required. Matching on the descriptor
 *     alone would let a write land on a surface whose session has not resolved
 *     (or has moved), and the reload would be dispatched into the wrong frame.
 *   - Only the *focused* document reloads. Refreshing an unfocused file would
 *     be invisible at best, and at worst would pull focus away from the file
 *     the owner is working in.
 *   - A dirty document is never reloaded. The owner's unsaved cells outrank a
 *     Companion write; the caller surfaces a notice and leaves the choice with
 *     JupyterLab's own conflict handling.
 */
export function deepWorkSourceRefreshDecision(input: {
  /** True only while the Deep Work draft actually owns the Jupyter surface. */
  deepWorkActive: boolean;
  /** Server-resolved root reported by the live workspace session. */
  sessionRootPath: unknown;
  /** Lab-relative path of the focused document, when one has focus. */
  activeWorkspacePath: unknown;
  /** Live Jupyter document dirty state; null when unknown. */
  activeDocumentDirty: boolean | null | undefined;
  event: DeepWorkSourceUpdatedEvent | null | undefined;
}): DeepWorkRefreshDecision {
  if (!input.deepWorkActive) return { kind: "ignore", reason: "no-deep-work" };
  const sessionRoot = normalizeRoot(input.sessionRootPath);
  if (!sessionRoot) return { kind: "ignore", reason: "session-not-ready" };
  if (!input.event || !sameRoot(input.event.rootPath, sessionRoot)) {
    return { kind: "ignore", reason: "other-workspace" };
  }
  const eventPath = normalizeJupyterWorkspacePath(input.event.path);
  if (!eventPath) return { kind: "ignore", reason: "unsafe-path" };
  const activePath = normalizeJupyterWorkspacePath(input.activeWorkspacePath);
  if (!activePath || activePath !== eventPath) {
    return { kind: "ignore", reason: "not-active-file" };
  }
  if (input.activeDocumentDirty === true) {
    return { kind: "blocked-dirty", path: eventPath };
  }
  return { kind: "reload-document", path: eventPath };
}

/**
 * A Deep Work-owned Jupyter surface must never be refreshed by bumping the
 * remount nonce: the nonce is part of the view's React key, so it destroys the
 * workspace session, its Companion capability, the focus state, and the rooted
 * Lab frame. Note-owned `.jupyter` pages have no such identity to lose and keep
 * the original remount behaviour.
 */
export function canRemountJupyterSurface(deepWorkActive: boolean): boolean {
  return !deepWorkActive;
}

export type StickyRootDisposition = "keep" | "clear";

/**
 * Error codes that mean the remembered root is definitively unusable. Anything
 * else - a dropped connection, a 5xx, an aborted fetch, a proxy hiccup - is
 * transient and must leave the sticky record alone.
 */
const DEFINITIVE_ROOT_FAILURE_CODES = new Set([
  "WORKSPACE_ROOT_MISSING",
  "WORKSPACE_ROOT_DENIED",
  "WORKSPACE_SYMLINK_ESCAPE",
  "WORKSPACE_PATH_ESCAPE",
  "WORKSPACE_PATH_BLOCKED",
  "INVALID_PATH",
]);

/**
 * Whether a failed sticky-root revalidation should forget the root.
 *
 * Before SN-270 the revalidation effect cleared sticky state from a bare
 * `catch {}`, so a laptop waking up on a flaky network, a restarting dev
 * server, or a single 500 silently evicted the owner from Deep Work and dropped
 * them back on the last vault page. Sticky state is cleared only when the
 * server reached a decision that this root is missing or invalid.
 */
export function stickyRootRevalidationDisposition(error: unknown): StickyRootDisposition {
  if (!error || typeof error !== "object") return "keep";
  const candidate = error as { code?: unknown; status?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : null;
  if (code && DEFINITIVE_ROOT_FAILURE_CODES.has(code)) return "clear";
  // A 404/403 carrying a server error code still means the server reached a
  // decision about this root; 5xx, 408, 429, and transport errors did not.
  const status = typeof candidate.status === "number" ? candidate.status : null;
  if (code && (status === 404 || status === 403)) return "clear";
  return "keep";
}
