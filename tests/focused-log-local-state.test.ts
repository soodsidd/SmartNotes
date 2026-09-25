import {
  acceptFocusedLogEntry,
  clearFocusedLogDraft,
  emptyFocusedLogState,
  flushFocusedLogOutbox,
  focusedLogStorageKey,
  mergeFocusedLogDocument,
  mergeFocusedLogStates,
  readFocusedLogState,
  readFocusedLogStateResult,
  saveFocusedLogDraft,
  saveFocusedLogSnapshot,
  writeFocusedLogState,
  type FocusedLogStorage,
} from "@/lib/focused-log-local-state";
import { defaultLogDocument } from "@/lib/log-contract";
import { defaultLogFormDefinition } from "@/lib/log-form-contract";

function memoryStorage(): FocusedLogStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("focused log local state (SN-149)", () => {
  const pagePath = "Notebook/Workout.html";

  it("persists and restores a draft without creating an outbox row", () => {
    const storage = memoryStorage();
    const saved = saveFocusedLogDraft(
      emptyFocusedLogState(pagePath),
      { entry: "Squat", amount: 100 },
      new Date("2026-07-27T10:00:00.000Z")
    );
    writeFocusedLogState(storage, saved);

    const restored = readFocusedLogState(storage, pagePath);
    expect(restored.draft?.values).toEqual({ entry: "Squat", amount: 100 });
    expect(restored.outbox).toEqual([]);
    expect(restored.activity.at(-1)?.kind).toBe("draft-saved");
    expect(storage.values.has(focusedLogStorageKey(pagePath))).toBe(true);
  });

  it("accepts a row locally, clears its draft, and merges it over a stale server reload", () => {
    const withDraft = saveFocusedLogDraft(emptyFocusedLogState(pagePath), { entry: "Bench" });
    const accepted = acceptFocusedLogEntry(
      withDraft,
      { entry: "Bench", amount: 80, notes: null },
      new Date("2026-07-27T10:01:00.000Z")
    );
    const merged = mergeFocusedLogDocument(defaultLogDocument(), accepted.state.outbox);

    expect(accepted.state.draft).toBeNull();
    expect(accepted.state.outbox).toHaveLength(1);
    expect(merged.rows).toEqual([accepted.row]);
    expect(accepted.state.activity.at(-1)?.kind).toBe("accepted");
  });

  it("keeps a draft and pending row when caching a remote snapshot", () => {
    const drafted = saveFocusedLogDraft(emptyFocusedLogState(pagePath), { entry: "In progress" });
    const accepted = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "Pending" });
    const combined = { ...accepted.state, draft: drafted.draft };
    const snapshot = saveFocusedLogSnapshot(
      combined,
      defaultLogDocument(),
      defaultLogFormDefinition(),
      new Date("2026-07-27T10:02:00.000Z")
    );

    expect(snapshot.draft?.values.entry).toBe("In progress");
    expect(snapshot.outbox).toHaveLength(1);
    expect(snapshot.snapshot?.document.rows[0].id).toBe(accepted.row.id);
  });

  it("flushes sequentially and drops each row only after its idempotent post succeeds", async () => {
    const first = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "One" });
    const second = acceptFocusedLogEntry(first.state, { entry: "Two" });
    const calls: string[] = [];
    const persisted: number[] = [];
    const flushed = await flushFocusedLogOutbox(second.state, {
      post: async (row) => void calls.push(row.id),
      persist: (state) => void persisted.push(state.outbox.length),
    });

    expect(calls).toEqual([first.row.id, second.row.id]);
    expect(flushed.outbox).toEqual([]);
    expect(flushed.activity.filter((event) => event.kind === "syncing")).toHaveLength(2);
    expect(flushed.activity.filter((event) => event.kind === "synced")).toHaveLength(2);
    expect(persisted).toEqual([2, 1, 1, 0]);
  });

  it("still posts when syncing activity persistence fails, then clears on a smaller completion write", async () => {
    const accepted = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "Quota-safe" });
    let persistCalls = 0;
    const post = jest.fn().mockResolvedValue(undefined);
    const flushed = await flushFocusedLogOutbox(accepted.state, {
      post,
      persist: () => {
        persistCalls += 1;
        if (persistCalls === 1) throw new Error("quota");
      },
    });

    expect(post).toHaveBeenCalledWith(accepted.row);
    expect(persistCalls).toBe(2);
    expect(flushed.outbox).toEqual([]);
  });

  it("returns the row pending when post succeeds but local confirmation cannot persist", async () => {
    const accepted = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "Retry confirmation" });
    const flushed = await flushFocusedLogOutbox(accepted.state, {
      post: async () => undefined,
      persist: () => { throw new Error("quota"); },
    });

    expect(flushed.outbox.map((entry) => entry.row.id)).toEqual([accepted.row.id]);
    expect(flushed.activity.at(-1)?.message).toContain("local confirmation failed");
  });

  it("retains the failed row and retries it before later rows", async () => {
    const first = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "One" });
    const second = acceptFocusedLogEntry(first.state, { entry: "Two" });
    const failed = await flushFocusedLogOutbox(second.state, {
      post: async () => { throw new Error("offline"); },
      persist: () => undefined,
    });
    expect(failed.outbox.map((entry) => entry.row.id)).toEqual([first.row.id, second.row.id]);
    expect(failed.outbox[0].attempts).toBe(1);
    expect(failed.activity.at(-1)?.kind).toBe("sync-failed");

    const calls: string[] = [];
    const retried = await flushFocusedLogOutbox(failed, {
      post: async (row) => void calls.push(row.id),
      persist: () => undefined,
    });
    expect(calls).toEqual([first.row.id, second.row.id]);
    expect(retried.outbox).toEqual([]);
    expect(retried.activity.some((event) => event.kind === "retrying")).toBe(true);
  });

  it("preserves a row accepted while an earlier network flush is in flight", async () => {
    const first = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "One" });
    let latest = first.state;
    let releasePost: (() => void) | undefined;
    const postWaiting = new Promise<void>((resolve) => { releasePost = resolve; });
    const flushing = flushFocusedLogOutbox(first.state, {
      post: async () => postWaiting,
      persist: (state) => { latest = state; },
      getLatest: () => latest,
    });

    await Promise.resolve();
    const second = acceptFocusedLogEntry(latest, { entry: "Two" });
    latest = second.state;
    releasePost?.();
    const flushed = await flushing;

    expect(flushed.outbox).toEqual([]);
    expect(flushed.activity.filter((event) => event.kind === "synced")).toHaveLength(2);
  });

  it("falls back safely when stored JSON is corrupt or storage reads fail", () => {
    const storage = memoryStorage();
    storage.values.set(focusedLogStorageKey(pagePath), "{broken");
    expect(readFocusedLogState(storage, pagePath)).toEqual(emptyFocusedLogState(pagePath));
    expect(readFocusedLogState({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined }, pagePath))
      .toEqual(emptyFocusedLogState(pagePath));
  });

  it("reports corrupt or unreadable existing data separately from a writable missing key", () => {
    const storage = memoryStorage();
    expect(readFocusedLogStateResult(storage, pagePath).status).toBe("missing");
    storage.values.set(focusedLogStorageKey(pagePath), "{broken");
    expect(readFocusedLogStateResult(storage, pagePath)).toEqual({ status: "unreadable", state: null });
    expect(readFocusedLogStateResult({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => undefined,
    }, pagePath)).toEqual({ status: "unreadable", state: null });
  });

  it("merge-before-write unions stale writers and honors sync and draft-clear tombstones", () => {
    const storage = memoryStorage();
    const staleA = emptyFocusedLogState(pagePath);
    const staleB = emptyFocusedLogState(pagePath);
    const accepted = acceptFocusedLogEntry(staleA, { entry: "From tab A" }, new Date("2026-07-27T10:00:00Z"));
    const afterA = writeFocusedLogState(storage, accepted.state);
    const drafted = saveFocusedLogDraft(staleB, { entry: "Draft from tab B" }, new Date("2026-07-27T10:00:01Z"));
    const afterB = writeFocusedLogState(storage, drafted);

    expect(afterB.outbox.map((entry) => entry.row.id)).toEqual([accepted.row.id]);
    expect(afterB.draft?.values.entry).toBe("Draft from tab B");

    const synced = writeFocusedLogState(storage, {
      ...afterA,
      outbox: [],
      syncedRows: [{ rowId: accepted.row.id, at: "2026-07-27T10:00:02.000Z" }],
    });
    expect(synced.outbox).toEqual([]);
    expect(writeFocusedLogState(storage, accepted.state).outbox).toEqual([]);

    const cleared = writeFocusedLogState(
      storage,
      clearFocusedLogDraft(afterB, new Date("2026-07-27T10:00:03Z"))
    );
    expect(cleared.draft).toBeNull();
    expect(writeFocusedLogState(storage, drafted).draft).toBeNull();
  });

  it("does not resurrect a synced row when its tombstone clock is earlier than acceptance", () => {
    const accepted = acceptFocusedLogEntry(
      emptyFocusedLogState(pagePath),
      { entry: "Clock rollback" },
      new Date("2026-07-27T12:00:00.000Z")
    );
    const withRolledBackTombstone = {
      ...emptyFocusedLogState(pagePath),
      syncedRows: [{ rowId: accepted.row.id, at: "2026-07-27T11:00:00.000Z" }],
    };
    expect(mergeFocusedLogStates(accepted.state, withRolledBackTombstone).outbox).toEqual([]);
  });

  it("rejects a structurally partial snapshot while preserving the valid draft and outbox record", () => {
    const storage = memoryStorage();
    const accepted = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "Pending" });
    storage.values.set(focusedLogStorageKey(pagePath), JSON.stringify({
      ...saveFocusedLogDraft(accepted.state, { entry: "Draft" }),
      snapshot: {
        savedAt: "2026-07-27T10:00:00.000Z",
        document: { rows: "not-an-array" },
        form: { schema: null, uischema: "bad" },
      },
    }));
    const result = readFocusedLogStateResult(storage, pagePath);
    expect(result.status).toBe("ready");
    expect(result.state?.snapshot).toBeNull();
    expect(result.state?.draft?.values.entry).toBe("Draft");
    expect(result.state?.outbox.map((entry) => entry.row.id)).toEqual([accepted.row.id]);
  });

  it("merges external activity and outbox state without duplicating entries", () => {
    const first = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "A" });
    const second = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "B" });
    const merged = mergeFocusedLogStates(first.state, second.state);
    expect(merged.outbox.map((entry) => entry.row.id)).toEqual([first.row.id, second.row.id]);
    expect(mergeFocusedLogStates(merged, first.state).outbox).toHaveLength(2);
  });
});
