/**
 * SN-373 — per-thread companion working/ready indicators for the page sidebar.
 *
 * SN-211 lights ONE global companion icon. With SN-322 parallel turns the owner
 * also needs to see WHICH pages / sections still have in-flight or unread
 * companion work. This module is the pure state machine behind those sidebar
 * dots. It does not own a turn lifecycle: the shell feeds it the same signals
 * that already drive SN-132 reattach and the SN-211 icon (send accepted,
 * reattach, `chat_event` done/error, terminal reconcile, cancel, send failure).
 *
 * Per thread address (`storePath::scopeKey`):
 *   working  — a live turn is running for that thread
 *   ready    — a turn reached terminal SUCCESS and the owner has not viewed it
 *   (absent) — nothing to show (never started, failed/cancelled, or acknowledged)
 *
 * Projection to sidebar rows: a shared notebook-section thread (scopeKey
 * "section", storeKind "section") shows on the SECTION row; every other thread
 * (whole page, parent context, page tree root, legacy unsectioned heading
 * thread) shows on the PAGE row of its storePath.
 */

import { describeTerminalTurnStatus } from "@/lib/ai-sidebar";

export type CompanionThreadIndicatorStatus = "working" | "ready";

export interface CompanionThreadIndicatorEntry {
  status: CompanionThreadIndicatorStatus;
  /** Turn that owns this indicator (latest send on the thread wins). */
  turnId: string;
  storePath: string;
  scopeKey: string;
}

export interface CompanionThreadIndicatorState {
  /** Keyed by thread address `storePath::scopeKey`. */
  threads: Record<string, CompanionThreadIndicatorEntry>;
  /**
   * Turn ids that already reached a terminal state. A later duplicate signal for
   * the same turn (e.g. reconcile after the live `done` was observed) must not
   * re-light a ready dot the owner already acknowledged. Bounded FIFO.
   */
  settledTurnIds: string[];
}

export interface CompanionThreadRef {
  storePath: string;
  scopeKey: string;
}

export interface CompanionSidebarIndicators {
  /** Normalized page path → status. */
  pages: Record<string, CompanionThreadIndicatorStatus>;
  /** Normalized notebook-section path → status. */
  sections: Record<string, CompanionThreadIndicatorStatus>;
}

export const COMPANION_INDICATOR_SETTLED_LIMIT = 200;

export const EMPTY_COMPANION_THREAD_INDICATORS: CompanionThreadIndicatorState = {
  threads: {},
  settledTurnIds: [],
};

export const EMPTY_COMPANION_SIDEBAR_INDICATORS: CompanionSidebarIndicators = {
  pages: {},
  sections: {},
};

export function normalizeCompanionIndicatorPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function companionIndicatorThreadKey(thread: CompanionThreadRef): string {
  return `${normalizeCompanionIndicatorPath(thread.storePath)}::${thread.scopeKey}`;
}

function findThreadKeyByTurn(state: CompanionThreadIndicatorState, turnId: string): string | null {
  for (const [key, entry] of Object.entries(state.threads)) {
    if (entry.turnId === turnId) return key;
  }
  return null;
}

function withSettled(state: CompanionThreadIndicatorState, turnId: string): string[] {
  if (state.settledTurnIds.includes(turnId)) return state.settledTurnIds;
  const next = [...state.settledTurnIds, turnId];
  return next.length > COMPANION_INDICATOR_SETTLED_LIMIT
    ? next.slice(next.length - COMPANION_INDICATOR_SETTLED_LIMIT)
    : next;
}

function withoutThread(
  threads: Record<string, CompanionThreadIndicatorEntry>,
  key: string
): Record<string, CompanionThreadIndicatorEntry> {
  const next = { ...threads };
  delete next[key];
  return next;
}

/**
 * A turn is live on a thread (fresh send or reattach). Replaces any prior
 * ready/working indicator for THAT thread only — a new turn there supersedes the
 * unread answer, like SN-211's "a fresh turn supersedes any prior ready badge".
 */
export function markCompanionThreadWorking(
  state: CompanionThreadIndicatorState,
  input: CompanionThreadRef & { turnId: string }
): CompanionThreadIndicatorState {
  if (!input.turnId || !input.storePath) return state;
  if (state.settledTurnIds.includes(input.turnId)) return state;
  const key = companionIndicatorThreadKey(input);
  const current = state.threads[key];
  if (current && current.status === "working" && current.turnId === input.turnId) return state;
  return {
    ...state,
    threads: {
      ...state.threads,
      [key]: {
        status: "working",
        turnId: input.turnId,
        storePath: normalizeCompanionIndicatorPath(input.storePath),
        scopeKey: input.scopeKey,
      },
    },
  };
}

/**
 * A turn reached a terminal state. SUCCESS → ready unless the owner is viewing
 * that thread right now (`viewed`); failure/cancel/interrupted → cleared (never
 * green, matching SN-211). `fallbackThread` lets the reconcile path light a turn
 * this tab never saw start (e.g. after a reload); live events for unknown turns
 * from other tabs/apps are ignored.
 */
export function resolveCompanionThreadTerminal(
  state: CompanionThreadIndicatorState,
  input: {
    turnId: string;
    status: string | null | undefined;
    isViewed: (threadKey: string) => boolean;
    fallbackThread?: CompanionThreadRef | null;
  }
): CompanionThreadIndicatorState {
  if (!input.turnId || state.settledTurnIds.includes(input.turnId)) return state;
  let key = findThreadKeyByTurn(state, input.turnId);
  let thread: CompanionThreadRef | null = key ? state.threads[key] : null;
  if (!key && input.fallbackThread?.storePath) {
    thread = input.fallbackThread;
    key = companionIndicatorThreadKey(thread);
    // A newer turn already owns this thread; this stale terminal must not clobber it.
    if (state.threads[key] && state.threads[key].turnId !== input.turnId) {
      return { ...state, settledTurnIds: withSettled(state, input.turnId) };
    }
  }
  if (!key || !thread) return state;
  const settledTurnIds = withSettled(state, input.turnId);
  const success = !describeTerminalTurnStatus(input.status).isFailure;
  if (success && !input.isViewed(key)) {
    return {
      threads: {
        ...state.threads,
        [key]: {
          status: "ready",
          turnId: input.turnId,
          storePath: normalizeCompanionIndicatorPath(thread.storePath),
          scopeKey: thread.scopeKey,
        },
      },
      settledTurnIds,
    };
  }
  return { threads: withoutThread(state.threads, key), settledTurnIds };
}

/** Turn never launched or was explicitly stopped — drop its indicator, never green. */
export function clearCompanionThreadTurn(
  state: CompanionThreadIndicatorState,
  turnId: string | null | undefined
): CompanionThreadIndicatorState {
  if (!turnId) return state;
  const key = findThreadKeyByTurn(state, turnId);
  const settledTurnIds = withSettled(state, turnId);
  if (!key) {
    return settledTurnIds === state.settledTurnIds ? state : { ...state, settledTurnIds };
  }
  return { threads: withoutThread(state.threads, key), settledTurnIds };
}

/**
 * Owner viewed this thread (companion open on it) — clear its READY dot only.
 * A still-working turn keeps pulsing; other threads are untouched.
 */
export function acknowledgeCompanionThread(
  state: CompanionThreadIndicatorState,
  thread: CompanionThreadRef | null | undefined
): CompanionThreadIndicatorState {
  if (!thread?.storePath) return state;
  const key = companionIndicatorThreadKey(thread);
  if (state.threads[key]?.status !== "ready") return state;
  return { ...state, threads: withoutThread(state.threads, key) };
}

/** Where a thread's dot renders: shared notebook-section threads on the section row. */
export function companionIndicatorRowTarget(entry: CompanionThreadRef): {
  kind: "page" | "section";
  path: string;
} {
  return {
    kind: entry.scopeKey === "section" ? "section" : "page",
    path: normalizeCompanionIndicatorPath(entry.storePath),
  };
}

/**
 * Project thread state onto sidebar rows. Several threads can land on one row
 * (e.g. whole-page + page-tree on the same root page); ready wins over working
 * there, matching SN-211's resolveCompanionIconState precedence.
 */
export function resolveCompanionSidebarIndicators(
  state: CompanionThreadIndicatorState
): CompanionSidebarIndicators {
  const entries = Object.values(state.threads);
  if (entries.length === 0) return EMPTY_COMPANION_SIDEBAR_INDICATORS;
  const pages: Record<string, CompanionThreadIndicatorStatus> = {};
  const sections: Record<string, CompanionThreadIndicatorStatus> = {};
  for (const entry of entries) {
    const target = companionIndicatorRowTarget(entry);
    const bucket = target.kind === "section" ? sections : pages;
    if (bucket[target.path] !== "ready") bucket[target.path] = entry.status;
  }
  return { pages, sections };
}

export function lookupCompanionSidebarIndicator(
  indicators: CompanionSidebarIndicators | null | undefined,
  kind: "page" | "section",
  path: string
): CompanionThreadIndicatorStatus | null {
  if (!indicators) return null;
  const bucket = kind === "section" ? indicators.sections : indicators.pages;
  return bucket[normalizeCompanionIndicatorPath(path)] ?? null;
}
