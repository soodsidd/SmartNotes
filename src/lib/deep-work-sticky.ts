import {
  deepWorkPendingPath,
  type DeepWorkAccess,
  type DeepWorkDescriptor,
} from "@/lib/deep-work";

// ---------------------------------------------------------------------------
// Sticky Deep Work disk workspace (SN-262)
//
// "Open workspace…" points Deep Work at an absolute disk folder the owner
// picked. Before SN-262 that choice lived only in React state, so "Back to
// notes", navigating to a vault note, or a reload silently dropped the root and
// the shell fell back to whatever vault page was last active (typically a
// note-owned `.jupyter` page). This module owns the durable half of that
// choice.
//
// Two boundaries are deliberate:
//
//   1. Only *owner-opened disk* workspaces are sticky. Ascent Vector-linked
//      Deep Work arrives through URL params, is already durable in that URL,
//      carries AV identity (projectId/repoId/workItemId) plus a returnUrl, and
//      must never be resurrected from browser storage — a capability request
//      must originate from AV, not from localStorage.
//   2. A restored record is a *request*, never an authorization. It re-enters
//      the ordinary /api/jupyter/workspace/session validation path, so a
//      deleted, moved, symlinked, or now-default-branch root resolves exactly
//      as a fresh open would, and an invalid one clears the sticky entry.
// ---------------------------------------------------------------------------

export const STICKY_DEEP_WORK_STORAGE_KEY = "smart-notes-last-deep-work-workspace";
export const STICKY_DEEP_WORK_VERSION = 1;

export interface StickyDeepWorkRecord {
  version: number;
  rootPath: string;
  projectName: string;
  branch?: string;
  worktreeLabel?: string;
  /** Access the owner resolved on the successful open, including an explicit unlock. */
  requestedAccess: DeepWorkAccess;
  /** Preserved so a default-branch unlock does not have to be re-confirmed on restore. */
  defaultBranchEditConfirmed?: boolean;
  savedAt: number;
}

export type StickyDeepWorkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MAX_ROOT_PATH = 2048;
const MAX_NAME = 200;
const MAX_BRANCH = 300;
const ABSOLUTE_ROOT_PATTERN = /^(?:[A-Za-z]:[\\/]|\/)/;

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || hasControlChars(trimmed)) return null;
  return trimmed;
}

function absoluteRootPath(value: unknown): string | null {
  const text = cleanText(value, MAX_ROOT_PATH);
  if (!text) return null;
  return ABSOLUTE_ROOT_PATTERN.test(text) ? text : null;
}

function accessMode(value: unknown): DeepWorkAccess | null {
  return value === "editable" || value === "read-only" ? value : null;
}

/**
 * Sticky persistence applies to owner-opened disk roots only. An AV-linked
 * descriptor (identity or returnUrl present) is durable in its own URL and is
 * never written to or restored from storage.
 */
export function isStickyDeepWorkCandidate(
  descriptor: DeepWorkDescriptor | null | undefined
): descriptor is DeepWorkDescriptor {
  if (!descriptor || descriptor.ownerOpen !== true) return false;
  if (descriptor.returnUrl || descriptor.projectId || descriptor.repoId || descriptor.workItemId) {
    return false;
  }
  return Boolean(
    absoluteRootPath(descriptor.rootPath) &&
      cleanText(descriptor.projectName, MAX_NAME) &&
      accessMode(descriptor.requestedAccess)
  );
}

/** Serializable form of a successfully opened disk workspace, or null when it is not sticky-eligible. */
export function stickyDeepWorkRecord(
  descriptor: DeepWorkDescriptor | null | undefined,
  now: number = Date.now()
): StickyDeepWorkRecord | null {
  if (!isStickyDeepWorkCandidate(descriptor)) return null;
  const rootPath = absoluteRootPath(descriptor.rootPath);
  const projectName = cleanText(descriptor.projectName, MAX_NAME);
  const requestedAccess = accessMode(descriptor.requestedAccess);
  if (!rootPath || !projectName || !requestedAccess) return null;
  const branch = cleanText(descriptor.branch, MAX_BRANCH);
  const worktreeLabel = cleanText(descriptor.worktreeLabel, MAX_BRANCH);
  return {
    version: STICKY_DEEP_WORK_VERSION,
    rootPath,
    projectName,
    ...(branch ? { branch } : {}),
    ...(worktreeLabel ? { worktreeLabel } : {}),
    requestedAccess,
    ...(descriptor.defaultBranchEditConfirmed === true ? { defaultBranchEditConfirmed: true } : {}),
    savedAt: Number.isFinite(now) ? now : 0,
  };
}

/**
 * Rebuild a descriptor from a stored record. Anything malformed, versioned
 * differently, non-absolute, or carrying AV identity/returnUrl yields null so
 * the caller drops the entry instead of restoring an unusable workspace.
 */
export function parseStickyDeepWorkRecord(raw: unknown): DeepWorkDescriptor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== STICKY_DEEP_WORK_VERSION) return null;
  // Storage never confers AV identity or a return target.
  if (record.projectId || record.repoId || record.workItemId || record.returnUrl) return null;
  const rootPath = absoluteRootPath(record.rootPath);
  const requestedAccess = accessMode(record.requestedAccess);
  const projectName = cleanText(record.projectName, MAX_NAME);
  if (!rootPath || !requestedAccess || !projectName) return null;
  const branch = cleanText(record.branch, MAX_BRANCH);
  const worktreeLabel = cleanText(record.worktreeLabel, MAX_BRANCH);
  return {
    rootPath,
    projectName,
    ...(branch ? { branch } : {}),
    ...(worktreeLabel ? { worktreeLabel } : {}),
    requestedAccess,
    ownerOpen: true,
    ...(record.defaultBranchEditConfirmed === true ? { defaultBranchEditConfirmed: true } : {}),
  };
}

/** Read the sticky root, dropping the entry when it is unreadable or invalid. */
export function readStickyDeepWork(
  storage: StickyDeepWorkStorage | null | undefined
): DeepWorkDescriptor | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(STICKY_DEEP_WORK_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearStickyDeepWork(storage);
    return null;
  }
  const descriptor = parseStickyDeepWorkRecord(parsed);
  if (!descriptor) {
    clearStickyDeepWork(storage);
    return null;
  }
  return descriptor;
}

/**
 * Persist a successfully opened disk workspace. Passing null clears the entry.
 * A non-sticky (AV-linked) descriptor is ignored rather than clearing, so
 * launching AV Deep Work does not erase the remembered disk root.
 */
export function writeStickyDeepWork(
  storage: StickyDeepWorkStorage | null | undefined,
  descriptor: DeepWorkDescriptor | null,
  now: number = Date.now()
): StickyDeepWorkRecord | null {
  if (!storage) return null;
  if (descriptor === null) {
    clearStickyDeepWork(storage);
    return null;
  }
  const record = stickyDeepWorkRecord(descriptor, now);
  if (!record) return null;
  try {
    storage.setItem(STICKY_DEEP_WORK_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Sticky restore is a convenience; a full or blocked quota must never break open.
  }
  return record;
}

export function clearStickyDeepWork(storage: StickyDeepWorkStorage | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(STICKY_DEEP_WORK_STORAGE_KEY);
  } catch {
    // Best effort.
  }
}

/**
 * Which Deep Work root (if any) the shell should mount with. A URL-linked
 * descriptor always wins: an explicit AV launch must never be replaced by the
 * previously remembered disk root.
 */
export function restorableStickyDeepWork(options: {
  linkedWorkspace?: DeepWorkDescriptor | null;
  sticky?: DeepWorkDescriptor | null;
}): DeepWorkDescriptor | null {
  if (options.linkedWorkspace) return null;
  return isStickyDeepWorkCandidate(options.sticky) ? options.sticky : null;
}

/**
 * A Deep Work root owns the Jupyter surface only while its own pending draft is
 * the active page. Without this gate a lingering opened workspace hijacks an
 * explicitly selected vault `.jupyter` note: the shell would launch the disk
 * workspace session in place of the note-owned one.
 */
export function activeDeepWorkWorkspace(
  workspace: DeepWorkDescriptor | null | undefined,
  activeDraftPath: string | null | undefined
): DeepWorkDescriptor | null {
  if (!workspace || !activeDraftPath) return null;
  return deepWorkPendingPath(workspace) === activeDraftPath ? workspace : null;
}

/**
 * Selecting a real vault page leaves an opened Deep Work workspace for this
 * browser session. The workspace remains sticky in storage and may be restored
 * by a later reload or entered again through an explicit open.
 */
export function shouldLeaveDeepWorkForVaultSelection(
  workspace: DeepWorkDescriptor | null | undefined,
  selectedVaultPagePath: string | null | undefined
): boolean {
  return Boolean(workspace && selectedVaultPagePath);
}
