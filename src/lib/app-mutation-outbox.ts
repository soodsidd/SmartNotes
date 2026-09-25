import { appUpsertRowId, type AppTableSnapshot } from "@/lib/app-contract";
import type { LogValue } from "@/lib/log-contract";
import type { LogRow } from "@/lib/log-contract";

const STORAGE_KEY = "smart-notes.app-mutation-outbox.v1";
const MUTATION_ID = /^m_[A-Za-z0-9_-]{8,100}$/;
const TABLE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const UPSERT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_ITEMS = 100;

interface PendingAppMutationBase {
  mutationId: string;
  pagePath: string;
  tableId: string;
  values: Record<string, LogValue>;
  acceptedAt: string;
}

export interface PendingAppAcceptMutation extends PendingAppMutationBase {
  operation: "add";
}

export interface PendingAppUpsertMutation extends PendingAppMutationBase {
  operation: "upsert";
  upsertKey: string;
}

export type PendingAppMutation = PendingAppAcceptMutation | PendingAppUpsertMutation;

interface StoredOutboxV1 { version: 1; items: PendingAppAcceptMutation[] }
interface StoredOutboxV2 { version: 2; items: PendingAppMutation[] }

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function validBase(item: Partial<PendingAppMutationBase>): boolean {
  return typeof item.mutationId === "string" && MUTATION_ID.test(item.mutationId)
    && typeof item.pagePath === "string" && item.pagePath.endsWith(".html")
    && typeof item.tableId === "string" && TABLE_ID.test(item.tableId)
    && isJsonObject(item.values)
    && validTimestamp(item.acceptedAt);
}

function validV1Item(value: unknown): value is PendingAppAcceptMutation {
  if (!isJsonObject(value)) return false;
  const item = value as unknown as Partial<PendingAppAcceptMutation>;
  return validBase(item) && item.operation === "add" && !Object.prototype.hasOwnProperty.call(item, "upsertKey");
}

function validV2Item(value: unknown): value is PendingAppMutation {
  if (!isJsonObject(value)) return false;
  const item = value as unknown as Partial<PendingAppMutation>;
  if (!validBase(item)) return false;
  if (item.operation === "add") return !Object.prototype.hasOwnProperty.call(item, "upsertKey");
  return item.operation === "upsert" && typeof item.upsertKey === "string" && UPSERT_KEY.test(item.upsertKey);
}

export function readAppMutationOutbox(storage: Pick<Storage, "getItem">): PendingAppMutation[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  let parsed: Partial<StoredOutboxV1 | StoredOutboxV2> | null;
  try { parsed = JSON.parse(raw) as Partial<StoredOutboxV1 | StoredOutboxV2> | null; }
  catch { throw new Error("Durable App mutation queue is unreadable; export it from Develop → Data before continuing."); }
  const valid = parsed?.version === 1
    ? Array.isArray(parsed.items) && parsed.items.every(validV1Item)
    : parsed?.version === 2 && Array.isArray(parsed.items) && parsed.items.every(validV2Item);
  if (!valid || !parsed?.items || parsed.items.length > MAX_ITEMS) {
    throw new Error("Durable App mutation queue is invalid; export it from Develop → Data before continuing.");
  }
  return parsed.items as PendingAppMutation[];
}

function write(storage: Pick<Storage, "setItem">, items: PendingAppMutation[]): void {
  if (items.length > MAX_ITEMS) {
    throw new Error("Durable App mutation queue is full. Sync or correct entries in Develop → Data.");
  }
  // Never trim from either edge: every queued acceptance is owner data. A quota
  // or capacity failure must leave the previously persisted queue untouched.
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, items } satisfies StoredOutboxV2));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function existingMutation(items: PendingAppMutation[], mutationId: string): PendingAppMutation | undefined {
  return items.find((item) => item.mutationId === mutationId);
}

function nextAcceptedAt(items: PendingAppMutation[]): string {
  const latest = items.reduce((maximum, item) => Math.max(maximum, Date.parse(item.acceptedAt)), 0);
  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

function assertEnvelope(input: { mutationId: string; pagePath: string; tableId: string }): void {
  if (!MUTATION_ID.test(input.mutationId) || !TABLE_ID.test(input.tableId) || !input.pagePath.endsWith(".html")) {
    throw new Error("Invalid durable App mutation envelope.");
  }
}

export function acceptAppMutation(
  storage: Pick<Storage, "getItem" | "setItem">,
  input: Omit<PendingAppAcceptMutation, "operation" | "acceptedAt">
): PendingAppAcceptMutation {
  assertEnvelope(input);
  const items = readAppMutationOutbox(storage);
  const existing = existingMutation(items, input.mutationId);
  if (existing) {
    const same = existing.operation === "add" && existing.pagePath === input.pagePath && existing.tableId === input.tableId
      && sameJson(existing.values, input.values);
    if (!same) throw new Error("Mutation id is already bound to a different pending App change.");
    return existing as PendingAppAcceptMutation;
  }
  if (items.length >= MAX_ITEMS) throw new Error("Durable App mutation queue is full. Sync or correct entries in Develop → Data.");
  const item: PendingAppAcceptMutation = { ...input, operation: "add", acceptedAt: nextAcceptedAt(items) };
  write(storage, [...items, item]);
  return item;
}

export function upsertAppMutation(
  storage: Pick<Storage, "getItem" | "setItem">,
  input: Omit<PendingAppUpsertMutation, "operation" | "acceptedAt">
): PendingAppUpsertMutation {
  assertEnvelope(input);
  if (!UPSERT_KEY.test(input.upsertKey)) throw new Error("Invalid durable App upsert key.");
  const items = readAppMutationOutbox(storage);
  const existing = existingMutation(items, input.mutationId);
  if (existing) {
    const same = existing.operation === "upsert" && existing.pagePath === input.pagePath && existing.tableId === input.tableId
      && existing.upsertKey === input.upsertKey && sameJson(existing.values, input.values);
    if (!same) throw new Error("Mutation id is already bound to a different pending App change.");
    return existing as PendingAppUpsertMutation;
  }
  const item: PendingAppUpsertMutation = { ...input, operation: "upsert", acceptedAt: nextAcceptedAt(items) };
  const last = items.at(-1);
  if (last?.operation === "upsert" && last.pagePath === input.pagePath && last.tableId === input.tableId && last.upsertKey === input.upsertKey) {
    // Only adjacent writes compact. An accepted entry between two draft states
    // is an ordering barrier and must remain before the later draft/retirement.
    write(storage, [...items.slice(0, -1), item]);
    return item;
  }
  if (items.length >= MAX_ITEMS) throw new Error("Durable App mutation queue is full. Sync or correct entries in Develop → Data.");
  write(storage, [...items, item]);
  return item;
}

/**
 * Atomically queue an accepted record followed by a keyed draft state. This is
 * the Workout boundary: either both records reach localStorage, or neither is
 * claimed as accepted. A trailing save for the same draft is replaced because
 * the accepted entry itself remains the recovery copy of that submitted data.
 */
export function acceptAppMutationWithUpsert(
  storage: Pick<Storage, "getItem" | "setItem">,
  acceptInput: Omit<PendingAppAcceptMutation, "operation" | "acceptedAt">,
  upsertInput: Omit<PendingAppUpsertMutation, "operation" | "acceptedAt">
): { accepted: PendingAppAcceptMutation; upserted: PendingAppUpsertMutation } {
  assertEnvelope(acceptInput);
  assertEnvelope(upsertInput);
  if (!UPSERT_KEY.test(upsertInput.upsertKey)) throw new Error("Invalid durable App upsert key.");
  if (acceptInput.mutationId === upsertInput.mutationId) throw new Error("Each durable App change requires its own mutation id.");
  const items = readAppMutationOutbox(storage);
  const existingAccept = existingMutation(items, acceptInput.mutationId);
  const existingUpsert = existingMutation(items, upsertInput.mutationId);
  if (existingAccept && existingUpsert) {
    const sameAccept = existingAccept.operation === "add" && existingAccept.pagePath === acceptInput.pagePath
      && existingAccept.tableId === acceptInput.tableId && sameJson(existingAccept.values, acceptInput.values);
    const sameUpsert = existingUpsert.operation === "upsert" && existingUpsert.pagePath === upsertInput.pagePath
      && existingUpsert.tableId === upsertInput.tableId && existingUpsert.upsertKey === upsertInput.upsertKey
      && sameJson(existingUpsert.values, upsertInput.values);
    if (sameAccept && sameUpsert) return { accepted: existingAccept, upserted: existingUpsert };
  }
  if (existingAccept || existingUpsert) {
    throw new Error("Mutation id is already bound to a different pending App change.");
  }
  let base = items;
  const last = items.at(-1);
  if (last?.operation === "upsert" && last.pagePath === upsertInput.pagePath
      && last.tableId === upsertInput.tableId && last.upsertKey === upsertInput.upsertKey) {
    base = items.slice(0, -1);
  }
  const accepted: PendingAppAcceptMutation = {
    ...acceptInput,
    operation: "add",
    acceptedAt: nextAcceptedAt(base),
  };
  const upserted: PendingAppUpsertMutation = {
    ...upsertInput,
    operation: "upsert",
    acceptedAt: nextAcceptedAt([...base, accepted]),
  };
  write(storage, [...base, accepted, upserted]);
  return { accepted, upserted };
}

export function removeAcceptedAppMutation(
  storage: Pick<Storage, "getItem" | "setItem">,
  pagePath: string,
  mutationId: string
): void {
  write(storage, readAppMutationOutbox(storage).filter((item) => item.pagePath !== pagePath || item.mutationId !== mutationId));
}

export async function flushAppMutationOutbox(
  storage: Pick<Storage, "getItem" | "setItem">,
  pagePath: string,
  send: (item: PendingAppMutation) => Promise<unknown>
): Promise<{ synced: number; pending: number; lastError?: unknown }> {
  let synced = 0;
  let lastError: unknown;
  for (const item of readAppMutationOutbox(storage).filter((candidate) => candidate.pagePath === pagePath)) {
    try {
      await send(item);
      removeAcceptedAppMutation(storage, pagePath, item.mutationId);
      synced += 1;
    } catch (error) {
      // Preserve mutation order and retry after reconnect, visibility return,
      // or session renewal. A failed removal is also safe: replay is idempotent.
      lastError = error;
      break;
    }
  }
  const pending = readAppMutationOutbox(storage).filter((item) => item.pagePath === pagePath).length;
  return { synced, pending, ...(lastError === undefined ? {} : { lastError }) };
}

function acceptedRowId(mutationId: string): string {
  return `r_pending_${mutationId.slice(2, 65)}`;
}

/**
 * Overlay pending local changes onto any live or device-package table snapshot.
 * The input remains untouched so stale async responses cannot mutate cached state.
 */
export function mergeAppSnapshotWithOutbox<T extends { tables: AppTableSnapshot[] }>(
  snapshot: T,
  items: PendingAppMutation[],
  pagePath: string
): T {
  const pending = items.filter((item) => item.pagePath === pagePath);
  if (pending.length === 0) return snapshot;
  const tables = snapshot.tables.map((table) => {
    const relevant = pending.filter((item) => item.tableId === table.id);
    if (relevant.length === 0) return table;
    let rows = table.rows.map((row) => ({ ...row, values: { ...row.values } }));
    for (const item of relevant) {
      if (item.operation === "add") {
        const alreadyPresent = rows.some((row) => row.createdAt === item.acceptedAt && sameJson(row.values, item.values));
        if (!alreadyPresent) rows.push({ id: acceptedRowId(item.mutationId), createdAt: item.acceptedAt, values: item.values });
        continue;
      }
      const rowId = appUpsertRowId(item.upsertKey);
      const index = rows.findIndex((row) => row.id === rowId);
      const prior = index >= 0 ? rows[index] : undefined;
      const row = {
        id: rowId,
        createdAt: prior?.createdAt ?? item.acceptedAt,
        updatedAt: item.acceptedAt,
        values: item.values,
      };
      if (index >= 0) rows[index] = row;
      else rows.push(row);
    }
    return { ...table, rows };
  });
  return { ...snapshot, tables };
}

/** Overlay pending rows before reapplying a validated App query. */
export function mergeAppQueryRowsWithOutbox(
  table: AppTableSnapshot,
  rows: LogRow[],
  items: PendingAppMutation[],
  pagePath: string,
  rawQuery: unknown
): LogRow[] {
  const merged = mergeAppSnapshotWithOutbox({ tables: [{ ...table, rows }] }, items, pagePath).tables[0].rows;
  const query = rawQuery && typeof rawQuery === "object" && !Array.isArray(rawQuery)
    ? rawQuery as { where?: Record<string, unknown>; limit?: number }
    : {};
  const where = query.where ?? {};
  const limit = Number.isInteger(query.limit) ? Number(query.limit) : 200;
  return merged
    .filter((row) => Object.entries(where).every(([key, expected]) => Object.is(row.values[key], expected)))
    .slice(0, limit);
}

export const APP_MUTATION_OUTBOX_STORAGE_KEY = STORAGE_KEY;
export const APP_MUTATION_OUTBOX_MAX_ITEMS = MAX_ITEMS;
