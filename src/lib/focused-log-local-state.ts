import type { LogDocument, LogRow, LogValue } from "@/lib/log-contract";
import { makeLogId, normalizeLogDocument } from "@/lib/log-contract";
import type { LogFormDefinition } from "@/lib/log-form-contract";
import { defaultLogFormDefinition, normalizeLogFormDefinition } from "@/lib/log-form-contract";

const STORAGE_PREFIX = "smart-notes.focused-log.v1:";
const MAX_ACTIVITY_EVENTS = 40;
const MAX_SYNC_TOMBSTONES = 80;

export type FocusedLogActivityKind =
  | "draft-saved"
  | "accepted"
  | "syncing"
  | "synced"
  | "retrying"
  | "sync-failed";

export interface FocusedLogActivityEvent {
  id: string;
  kind: FocusedLogActivityKind;
  message: string;
  at: string;
  rowId?: string;
}

export interface FocusedLogDraft {
  values: Record<string, unknown>;
  updatedAt: string;
}

export interface FocusedLogOutboxEntry {
  row: LogRow;
  attempts: number;
  lastAttemptAt?: string;
}

export interface FocusedLogSnapshot {
  document: LogDocument;
  form: LogFormDefinition;
  savedAt: string;
}

export interface FocusedLogLocalState {
  version: 1;
  pagePath: string;
  draft: FocusedLogDraft | null;
  draftClearedAt?: string;
  outbox: FocusedLogOutboxEntry[];
  syncedRows?: Array<{ rowId: string; at: string }>;
  snapshot: FocusedLogSnapshot | null;
  activity: FocusedLogActivityEvent[];
}

export interface FocusedLogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FocusedLogStateReadResult =
  | { status: "ready"; state: FocusedLogLocalState }
  | { status: "missing"; state: FocusedLogLocalState }
  | { status: "unreadable"; state: null };

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function timestampAfter(floor: string | undefined, now?: Date): string {
  const candidate = now ?? new Date();
  if (!floor || candidate.getTime() > Date.parse(floor)) return candidate.toISOString();
  return new Date(Date.parse(floor) + 1).toISOString();
}

export function focusedLogStorageKey(pagePath: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(pagePath)}`;
}

export function emptyFocusedLogState(pagePath: string): FocusedLogLocalState {
  return {
    version: 1,
    pagePath,
    draft: null,
    outbox: [],
    snapshot: null,
    activity: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRow(value: unknown): LogRow | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.createdAt !== "string" || !isRecord(value.values)) {
    return null;
  }
  return {
    id: value.id,
    createdAt: value.createdAt,
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
    values: value.values as Record<string, LogValue>,
  };
}

function isStructurallyValidSnapshot(value: unknown): value is {
  document: LogDocument;
  form: LogFormDefinition;
  savedAt: string;
} {
  if (!isRecord(value) || typeof value.savedAt !== "string") return false;
  const document = value.document;
  const form = value.form;
  return isRecord(document)
    && document.version === 1
    && isRecord(document.schema)
    && Array.isArray(document.schema.fields)
    && Array.isArray(document.rows)
    && isRecord(form)
    && form.version === 1
    && isRecord(form.schema)
    && isRecord(form.uischema)
    && typeof form.uischema.type === "string";
}

function normalizeState(value: unknown, pagePath: string): FocusedLogLocalState {
  if (!isRecord(value) || value.version !== 1 || value.pagePath !== pagePath) {
    return emptyFocusedLogState(pagePath);
  }
  const draft = isRecord(value.draft) && isRecord(value.draft.values) && typeof value.draft.updatedAt === "string"
    ? { values: value.draft.values, updatedAt: value.draft.updatedAt }
    : null;
  const outbox = Array.isArray(value.outbox)
    ? value.outbox.flatMap((candidate) => {
        if (!isRecord(candidate)) return [];
        const row = normalizeRow(candidate.row);
        if (!row) return [];
        return [{
          row,
          attempts: typeof candidate.attempts === "number" && candidate.attempts >= 0 ? candidate.attempts : 0,
          ...(typeof candidate.lastAttemptAt === "string" ? { lastAttemptAt: candidate.lastAttemptAt } : {}),
        }];
      })
    : [];
  const snapshot = isStructurallyValidSnapshot(value.snapshot)
      ? {
          document: normalizeLogDocument(value.snapshot.document),
          form: (() => {
            try {
              return normalizeLogFormDefinition(value.snapshot.form);
            } catch {
              return defaultLogFormDefinition();
            }
          })(),
          savedAt: value.snapshot.savedAt,
        }
      : null;
  const activity = Array.isArray(value.activity)
    ? value.activity.flatMap((candidate) => {
        if (!isRecord(candidate)
          || typeof candidate.id !== "string"
          || typeof candidate.kind !== "string"
          || typeof candidate.message !== "string"
          || typeof candidate.at !== "string") return [];
        return [{
          id: candidate.id,
          kind: candidate.kind as FocusedLogActivityKind,
          message: candidate.message,
          at: candidate.at,
          ...(typeof candidate.rowId === "string" ? { rowId: candidate.rowId } : {}),
        }];
      }).slice(-MAX_ACTIVITY_EVENTS)
    : [];
  const syncedRows = Array.isArray(value.syncedRows)
    ? value.syncedRows.flatMap((candidate) =>
        isRecord(candidate) && typeof candidate.rowId === "string" && typeof candidate.at === "string"
          ? [{ rowId: candidate.rowId, at: candidate.at }]
          : []
      ).slice(-MAX_SYNC_TOMBSTONES)
    : [];
  return {
    version: 1,
    pagePath,
    draft,
    ...(typeof value.draftClearedAt === "string" ? { draftClearedAt: value.draftClearedAt } : {}),
    outbox,
    syncedRows,
    snapshot,
    activity,
  };
}

export function readFocusedLogState(storage: FocusedLogStorage, pagePath: string): FocusedLogLocalState {
  return readFocusedLogStateResult(storage, pagePath).state ?? emptyFocusedLogState(pagePath);
}

/**
 * Distinguishes a genuinely missing record from unknown existing data. Callers
 * that intend to write must not replace an unreadable record with empty state.
 */
export function readFocusedLogStateResult(
  storage: FocusedLogStorage,
  pagePath: string
): FocusedLogStateReadResult {
  try {
    const raw = storage.getItem(focusedLogStorageKey(pagePath));
    if (raw === null) return { status: "missing", state: emptyFocusedLogState(pagePath) };
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || parsed.pagePath !== pagePath) {
      return { status: "unreadable", state: null };
    }
    return { status: "ready", state: normalizeState(parsed, pagePath) };
  } catch {
    return { status: "unreadable", state: null };
  }
}

export function mergeFocusedLogStates(
  first: FocusedLogLocalState,
  second: FocusedLogLocalState
): FocusedLogLocalState {
  const latestDraftClear = [first.draftClearedAt, second.draftClearedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const newestDraft = [first.draft, second.draft]
    .filter((value): value is FocusedLogDraft => Boolean(value))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1) ?? null;
  const draft = newestDraft && (!latestDraftClear || newestDraft.updatedAt > latestDraftClear)
    ? newestDraft
    : null;

  const tombstones = new Map<string, string>();
  for (const item of [...(first.syncedRows ?? []), ...(second.syncedRows ?? [])]) {
    if ((tombstones.get(item.rowId) ?? "") < item.at) tombstones.set(item.rowId, item.at);
  }
  const outbox = new Map<string, FocusedLogOutboxEntry>();
  for (const entry of [...first.outbox, ...second.outbox]) {
    const existing = outbox.get(entry.row.id);
    if (!existing || existing.attempts <= entry.attempts) outbox.set(entry.row.id, entry);
  }
  for (const rowId of tombstones.keys()) {
    // Row ids are globally unique. A sync tombstone always dominates the same
    // id even if a device clock moved backward between accept and confirmation.
    outbox.delete(rowId);
  }

  const activity = new Map<string, FocusedLogActivityEvent>();
  for (const event of [...first.activity, ...second.activity]) activity.set(event.id, event);
  const snapshots = [first.snapshot, second.snapshot]
    .filter((value): value is FocusedLogSnapshot => Boolean(value))
    .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  return {
    version: 1,
    pagePath: first.pagePath,
    draft,
    ...(latestDraftClear ? { draftClearedAt: latestDraftClear } : {}),
    outbox: [...outbox.values()].sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt)),
    syncedRows: [...tombstones.entries()]
      .map(([rowId, at]) => ({ rowId, at }))
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-MAX_SYNC_TOMBSTONES),
    snapshot: snapshots.at(-1) ?? null,
    activity: [...activity.values()]
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-MAX_ACTIVITY_EVENTS),
  };
}

export function writeFocusedLogState(
  storage: FocusedLogStorage,
  state: FocusedLogLocalState
): FocusedLogLocalState {
  const existing = readFocusedLogStateResult(storage, state.pagePath);
  if (existing.status === "unreadable") {
    throw new Error("Focused log storage is unreadable");
  }
  const merged = existing.status === "ready"
    ? mergeFocusedLogStates(existing.state, state)
    : state;
  storage.setItem(focusedLogStorageKey(state.pagePath), JSON.stringify(merged));
  return merged;
}

export function appendFocusedLogActivity(
  state: FocusedLogLocalState,
  kind: FocusedLogActivityKind,
  message: string,
  options: { now?: Date; rowId?: string } = {}
): FocusedLogLocalState {
  const event: FocusedLogActivityEvent = {
    id: `${nowIso(options.now)}-${makeLogId("r")}`,
    kind,
    message,
    at: nowIso(options.now),
    ...(options.rowId ? { rowId: options.rowId } : {}),
  };
  return { ...state, activity: [...state.activity, event].slice(-MAX_ACTIVITY_EVENTS) };
}

export function saveFocusedLogDraft(
  state: FocusedLogLocalState,
  values: Record<string, unknown>,
  now?: Date
): FocusedLogLocalState {
  const updatedAt = timestampAfter(
    [state.draftClearedAt, state.draft?.updatedAt].filter((value): value is string => Boolean(value)).sort().at(-1),
    now
  );
  return appendFocusedLogActivity(
    { ...state, draft: { values, updatedAt } },
    "draft-saved",
    "Draft saved on this device",
    { now }
  );
}

export function clearFocusedLogDraft(state: FocusedLogLocalState, now?: Date): FocusedLogLocalState {
  return { ...state, draft: null, draftClearedAt: nowIso(now) };
}

export function acceptFocusedLogEntry(
  state: FocusedLogLocalState,
  values: Record<string, LogValue>,
  now?: Date
): { state: FocusedLogLocalState; row: LogRow } {
  const row: LogRow = { id: makeLogId("r"), createdAt: nowIso(now), values };
  const next = appendFocusedLogActivity(
    {
      ...state,
      draft: null,
      draftClearedAt: nowIso(now),
      outbox: [...state.outbox, { row, attempts: 0 }],
    },
    "accepted",
    "Entry accepted locally",
    { now, rowId: row.id }
  );
  return { state: next, row };
}

export function saveFocusedLogSnapshot(
  state: FocusedLogLocalState,
  document: LogDocument,
  form: LogFormDefinition,
  now?: Date
): FocusedLogLocalState {
  return {
    ...state,
    snapshot: { document: mergeFocusedLogDocument(document, state.outbox), form, savedAt: nowIso(now) },
  };
}

export function mergeFocusedLogDocument(
  serverDocument: LogDocument,
  outbox: FocusedLogOutboxEntry[]
): LogDocument {
  const rowsById = new Map(serverDocument.rows.map((row) => [row.id, row]));
  for (const entry of outbox) {
    if (!rowsById.has(entry.row.id)) rowsById.set(entry.row.id, entry.row);
  }
  return { ...serverDocument, rows: [...rowsById.values()] };
}

export interface FlushFocusedLogOutboxOptions {
  post: (row: LogRow) => Promise<void>;
  persist: (state: FocusedLogLocalState) => void;
  /** Reads entries accepted while a network request was in flight. */
  getLatest?: () => FocusedLogLocalState;
  now?: () => Date;
}

export async function flushFocusedLogOutbox(
  initialState: FocusedLogLocalState,
  options: FlushFocusedLogOutboxOptions
): Promise<FocusedLogLocalState> {
  let state = initialState;
  while (state.outbox.length > 0) {
    const current = state.outbox[0];
    const attemptAt = options.now?.() ?? new Date();
    const attempts = current.attempts + 1;
    state = appendFocusedLogActivity(
      {
        ...state,
        outbox: [
          { ...current, attempts, lastAttemptAt: attemptAt.toISOString() },
          ...state.outbox.slice(1),
        ],
      },
      attempts === 1 ? "syncing" : "retrying",
      attempts === 1 ? "Syncing entry to vault" : "Retrying vault sync",
      { now: attemptAt, rowId: current.row.id }
    );
    try {
      options.persist(state);
    } catch {
      // The row was durably accepted before flush began. Activity bookkeeping
      // must never prevent its idempotent network attempt.
    }
    try {
      await options.post(current.row);
      const latest = options.getLatest?.() ?? state;
      const completed = appendFocusedLogActivity(
        {
          ...latest,
          outbox: latest.outbox.filter((entry) => entry.row.id !== current.row.id),
          syncedRows: [
            ...(latest.syncedRows ?? []).filter((item) => item.rowId !== current.row.id),
            { rowId: current.row.id, at: nowIso(options.now?.()) },
          ].slice(-MAX_SYNC_TOMBSTONES),
        },
        "synced",
        "Entry synced to vault",
        { now: options.now?.(), rowId: current.row.id }
      );
      try {
        options.persist(completed);
        state = completed;
      } catch {
        // Do not claim the row is cleared when its tombstone/removal could not
        // be persisted. A later retry is safe because POST is idempotent.
        const pendingLatest = options.getLatest?.() ?? state;
        const pendingEntry = pendingLatest.outbox.find((entry) => entry.row.id === current.row.id)
          ?? state.outbox.find((entry) => entry.row.id === current.row.id)
          ?? current;
        state = appendFocusedLogActivity(
          {
            ...pendingLatest,
            outbox: pendingLatest.outbox.some((entry) => entry.row.id === current.row.id)
              ? pendingLatest.outbox
              : [pendingEntry, ...pendingLatest.outbox],
          },
          "sync-failed",
          "Synced, but local confirmation failed — will retry",
          { now: options.now?.(), rowId: current.row.id }
        );
        try {
          options.persist(state);
        } catch {
          // Storage is still unavailable; the original accepted row remains.
        }
        break;
      }
    } catch {
      const latest = options.getLatest?.() ?? state;
      state = appendFocusedLogActivity(
        latest,
        "sync-failed",
        "Sync failed — will retry",
        { now: options.now?.(), rowId: current.row.id }
      );
      try {
        options.persist(state);
      } catch {
        // The original accepted row remains durable even if failure activity does not fit.
      }
      break;
    }
  }
  return state;
}
