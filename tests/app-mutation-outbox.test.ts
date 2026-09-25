import {
  APP_MUTATION_OUTBOX_MAX_ITEMS,
  APP_MUTATION_OUTBOX_STORAGE_KEY,
  acceptAppMutation,
  acceptAppMutationWithUpsert,
  flushAppMutationOutbox,
  mergeAppQueryRowsWithOutbox,
  mergeAppSnapshotWithOutbox,
  readAppMutationOutbox,
  upsertAppMutation,
} from "@/lib/app-mutation-outbox";
import type { AppTableSnapshot } from "@/lib/app-contract";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    raw: values,
  };
}

function snapshot(rows: AppTableSnapshot["rows"] = []) {
  return {
    marker: "unchanged",
    tables: [{
      id: "entries",
      name: "Entries",
      kind: "app" as const,
      version: 1 as const,
      schema: { fields: [{ id: "value", name: "Value", type: "number" as const }] },
      rows,
    }, {
      id: "drafts",
      name: "Drafts",
      kind: "app" as const,
      version: 1 as const,
      schema: { fields: [{ id: "kind", name: "Kind", type: "text" as const }, { id: "view", name: "View", type: "text" as const }] },
      rows: [],
    }],
  };
}

describe("generic host-owned App mutation outbox", () => {
  it("persists acceptance before transport and replays mixed writes in order after reload", async () => {
    const storage = memoryStorage();
    const first = acceptAppMutation(storage, { mutationId: "m_entry0001", pagePath: "Notebook/App.html", tableId: "entries", values: { nested: { sets: [1, 2] } } });
    upsertAppMutation(storage, { mutationId: "m_draft0001", pagePath: "Notebook/App.html", tableId: "drafts", upsertKey: "workout", values: { kind: "workout", view: { weight: 50 } } });
    expect(JSON.parse(storage.raw.get(APP_MUTATION_OUTBOX_STORAGE_KEY)!)).toEqual(expect.objectContaining({ version: 2 }));
    expect(readAppMutationOutbox(storage)).toHaveLength(2);
    expect(acceptAppMutation(storage, { mutationId: "m_entry0001", pagePath: "Notebook/App.html", tableId: "entries", values: { nested: { sets: [1, 2] } } })).toEqual(first);
    const sent: string[] = [];
    const offline = await flushAppMutationOutbox(storage, "Notebook/App.html", async () => { throw new Error("offline"); });
    expect(offline).toEqual(expect.objectContaining({ synced: 0, pending: 2, lastError: expect.any(Error) }));
    const online = await flushAppMutationOutbox(storage, "Notebook/App.html", async (item) => { sent.push(`${item.operation}:${item.mutationId}`); });
    expect(online).toEqual({ synced: 2, pending: 0 });
    expect(sent).toEqual(["add:m_entry0001", "upsert:m_draft0001"]);
  });

  it("reads v1 accept-only queues and upgrades them without losing accepted entries", () => {
    const storage = memoryStorage();
    storage.setItem(APP_MUTATION_OUTBOX_STORAGE_KEY, JSON.stringify({ version: 1, items: [{
      mutationId: "m_entry0001", pagePath: "Notebook/App.html", tableId: "entries", operation: "add",
      values: { value: 1 }, acceptedAt: "2026-09-14T10:00:00.000Z",
    }] }));
    expect(readAppMutationOutbox(storage)).toHaveLength(1);
    upsertAppMutation(storage, { mutationId: "m_draft0001", pagePath: "Notebook/App.html", tableId: "drafts", upsertKey: "workout", values: { kind: "workout" } });
    const persisted = JSON.parse(storage.raw.get(APP_MUTATION_OUTBOX_STORAGE_KEY)!);
    expect(persisted.version).toBe(2);
    expect(persisted.items.map((item: { mutationId: string }) => item.mutationId)).toEqual(["m_entry0001", "m_draft0001"]);
  });

  it("compacts only adjacent draft states and keeps accept/retirement ordering atomic", () => {
    const storage = memoryStorage();
    upsertAppMutation(storage, { mutationId: "m_draft0001", pagePath: "Notebook/App.html", tableId: "drafts", upsertKey: "workout", values: { kind: "workout", view: { weight: 40 } } });
    upsertAppMutation(storage, { mutationId: "m_draft0002", pagePath: "Notebook/App.html", tableId: "drafts", upsertKey: "workout", values: { kind: "workout", view: { weight: 50 } } });
    expect(readAppMutationOutbox(storage).map((item) => item.mutationId)).toEqual(["m_draft0002"]);

    acceptAppMutationWithUpsert(storage,
      { mutationId: "m_entry0001", pagePath: "Notebook/App.html", tableId: "entries", values: { value: 50 } },
      { mutationId: "m_retire001", pagePath: "Notebook/App.html", tableId: "drafts", upsertKey: "workout", values: { kind: "retired", view: {} } },
    );
    const items = readAppMutationOutbox(storage);
    expect(items.map((item) => item.mutationId)).toEqual(["m_entry0001", "m_retire001"]);
    expect(Date.parse(items[1].acceptedAt)).toBeGreaterThan(Date.parse(items[0].acceptedAt));
  });

  it("merges late live snapshots without clobbering pending accepts or the newest draft", () => {
    const storage = memoryStorage();
    acceptAppMutation(storage, { mutationId: "m_entry0001", pagePath: "Notebook/App.html", tableId: "entries", values: { value: 2 } });
    upsertAppMutation(storage, { mutationId: "m_draft0001", pagePath: "Notebook/App.html", tableId: "drafts", upsertKey: "workout", values: { kind: "workout", view: { weight: 60 } } });
    const live = snapshot([{ id: "r_server01", createdAt: "2026-09-14T09:00:00.000Z", values: { value: 1 } }]);
    const merged = mergeAppSnapshotWithOutbox(live, readAppMutationOutbox(storage), "Notebook/App.html");
    expect(merged.marker).toBe("unchanged");
    expect(merged.tables[0].rows.map((row) => row.values.value)).toEqual([1, 2]);
    expect(merged.tables[1].rows).toEqual([expect.objectContaining({ id: "r_u_workout", values: { kind: "workout", view: { weight: 60 } } })]);
    expect(live.tables[0].rows).toHaveLength(1);

    const acceptedAt = readAppMutationOutbox(storage)[0].acceptedAt;
    const alreadyLive = snapshot([{ id: "r_server02", createdAt: acceptedAt, values: { value: 2 } }]);
    expect(mergeAppSnapshotWithOutbox(alreadyLive, readAppMutationOutbox(storage), "Notebook/App.html").tables[0].rows).toHaveLength(1);
  });

  it("reapplies query filters after pending draft state wins", () => {
    const storage = memoryStorage();
    upsertAppMutation(storage, { mutationId: "m_retire001", pagePath: "Notebook/App.html", tableId: "drafts", upsertKey: "workout", values: { kind: "retired", view: {} } });
    const table = snapshot().tables[1];
    const staleRows = [{ id: "r_u_workout", createdAt: "2026-09-14T09:00:00.000Z", values: { kind: "workout", view: { weight: 50 } } }];
    expect(mergeAppQueryRowsWithOutbox(table, staleRows, readAppMutationOutbox(storage), "Notebook/App.html", { where: { kind: "workout" }, limit: 50 })).toEqual([]);
  });

  it("fails closed for corrupt state, id conflicts, capacity, and storage quota", () => {
    const corrupt = memoryStorage();
    corrupt.setItem(APP_MUTATION_OUTBOX_STORAGE_KEY, "not-json");
    expect(() => readAppMutationOutbox(corrupt)).toThrow(/unreadable/);
    expect(() => acceptAppMutation(corrupt, { mutationId: "m_entry0001", pagePath: "Notebook/App.html", tableId: "entries", values: {} })).toThrow(/unreadable/);
    expect(corrupt.raw.get(APP_MUTATION_OUTBOX_STORAGE_KEY)).toBe("not-json");

    const full = memoryStorage();
    const items = Array.from({ length: APP_MUTATION_OUTBOX_MAX_ITEMS }, (_, index) => ({
      mutationId: `m_entry${String(index).padStart(4, "0")}`,
      pagePath: "Notebook/App.html", tableId: "entries", operation: "add", values: { value: index },
      acceptedAt: new Date(Date.UTC(2026, 8, 14, 10, 0, 0, index)).toISOString(),
    }));
    full.setItem(APP_MUTATION_OUTBOX_STORAGE_KEY, JSON.stringify({ version: 2, items }));
    const before = full.raw.get(APP_MUTATION_OUTBOX_STORAGE_KEY);
    expect(() => acceptAppMutation(full, { mutationId: "m_overflow1", pagePath: "Notebook/App.html", tableId: "entries", values: {} })).toThrow(/full/);
    expect(full.raw.get(APP_MUTATION_OUTBOX_STORAGE_KEY)).toBe(before);

    const conflict = memoryStorage();
    acceptAppMutation(conflict, { mutationId: "m_entry0001", pagePath: "Notebook/App.html", tableId: "entries", values: { value: 1 } });
    expect(() => upsertAppMutation(conflict, { mutationId: "m_entry0001", pagePath: "Notebook/App.html", tableId: "drafts", upsertKey: "workout", values: { kind: "workout" } })).toThrow(/different pending/);
    const quota = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => acceptAppMutation(quota, { mutationId: "m_entry0002", pagePath: "Notebook/App.html", tableId: "entries", values: {} })).toThrow("quota");
  });
});
