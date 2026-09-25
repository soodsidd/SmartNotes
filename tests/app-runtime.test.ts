import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeVaultTool } from "@/server/vault/agent-tools";
import {
  bootstrapAppRuntime, executeAppRpc, executeOwnerAppDataMutation, queryAppTableForCompanion, readAppDataSnapshot,
  readAppManifest, resetAppSessionsForTesting, saveAppManifest, setAppEnabled,
} from "@/server/vault/app-runtime";
import { createPage, deletePage, invalidateVaultTreeCacheForTesting, movePage, readLogDocument, renamePage, savePage } from "@/server/vault/pages";

const SECTION = "Notebook/Section";

async function withVaultFixture(run: (root: string) => Promise<void>) {
  const previous = process.env.SMART_NOTES_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-app-"));
  process.env.SMART_NOTES_VAULT = root;
  resetAppSessionsForTesting();
  invalidateVaultTreeCacheForTesting();
  try {
    await fs.mkdir(path.join(root, "Notebook", "Section"), { recursive: true });
    await fs.mkdir(path.join(root, "Notebook", "Other"), { recursive: true });
    await run(root);
  } finally {
    if (previous) process.env.SMART_NOTES_VAULT = previous;
    else delete process.env.SMART_NOTES_VAULT;
    resetAppSessionsForTesting();
    invalidateVaultTreeCacheForTesting();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function seedApp() {
  const page = await createPage({ sectionPath: SECTION, title: "Runtime App", noteType: "app" });
  await savePage({ path: page.path, title: page.title, body: "<main>Runtime</main>" });
  await saveAppManifest(page.path, {
    version: 1, enabled: true, tables: [{ id: "items", name: "Items", kind: "app", schema: { fields: [
      { id: "name", name: "Name", type: "text", required: true },
      { id: "done", name: "Done", type: "boolean" },
    ] } }],
  });
  return page.path;
}

describe("App runtime scoped JSON RPC (SN-182)", () => {
  it("preserves safe legacy camelCase field ids while keeping table ids canonical", async () => {
    await withVaultFixture(async () => {
      const appPath = await seedApp();
      const schema = { fields: [
        { id: "sessionDate", name: "Session date", type: "date" as const, required: true },
        { id: "workoutA", name: "Workout A", type: "text" as const },
      ] };
      await saveAppManifest(appPath, {
        version: 1,
        enabled: true,
        tables: [{ id: "legacy_entries", name: "Legacy entries", kind: "app", schema }],
      });

      const boot = await bootstrapAppRuntime(appPath);
      expect(boot.tables[0].schema).toEqual(schema);
      await executeAppRpc({
        path: appPath,
        sessionToken: boot.sessionToken,
        tableId: "legacy_entries",
        operation: "add",
        values: { sessionDate: "2026-01-05", workoutA: { alpha: { set1Reps: 8 } } },
      });
      const snapshot = await readAppDataSnapshot(appPath);
      expect(snapshot.tables[0].schema).toEqual(schema);
      expect(snapshot.tables[0].rows[0].values).toEqual({ sessionDate: "2026-01-05", workoutA: { alpha: { set1Reps: 8 } } });
      await expect(saveAppManifest(appPath, {
        version: 1,
        enabled: true,
        tables: [{ id: "NotCanonical", name: "Bad table", kind: "app", schema }],
      })).rejects.toThrow(/lowercase letters/);
    });
  });

  it("shares process-local sessions across independently loaded route bundles", async () => {
    await withVaultFixture(async () => {
      const appPath = await seedApp();
      const firstRuntime = await import("@/server/vault/app-runtime");
      const boot = await firstRuntime.bootstrapAppRuntime(appPath);
      jest.resetModules();
      const independentlyLoadedRuntime = await import("@/server/vault/app-runtime");
      await expect(independentlyLoadedRuntime.executeAppRpc({
        path: appPath,
        sessionToken: boot.sessionToken,
        tableId: "items",
        operation: "query",
      })).resolves.toEqual(expect.objectContaining({ rows: [] }));
    });
  });

  it("gives companions bounded declared-table queries without frame sessions or unrelated table reads", async () => {
    await withVaultFixture(async (root) => {
      const appPath = await seedApp();
      const boot = await bootstrapAppRuntime(appPath);
      await executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "add", values: { name: "Visible", done: true } });
      await saveAppManifest(appPath, { version: 1, enabled: true, tables: [
        { id: "items", name: "Items", kind: "app", schema: { fields: [{ id: "name", name: "Name", type: "text", required: true }, { id: "done", name: "Done", type: "boolean" }] } },
        { id: "unrelated", name: "Unrelated", kind: "app", schema: { fields: [{ id: "value", name: "Value", type: "text" }] } },
      ] });
      await fs.writeFile(path.join(root, "Notebook", "Section", "runtime-app.app-data.unrelated.json"), "not valid JSON", "utf8");
      await setAppEnabled(appPath, false);
      const result = await queryAppTableForCompanion(appPath, "items", { where: { done: true }, limit: 1 }) as { rows: Array<{ values: Record<string, unknown> }> };
      expect(result.rows.map((row) => row.values.name)).toEqual(["Visible"]);
      expect(result).not.toHaveProperty("sessionToken");
      expect(JSON.stringify(result)).not.toMatch(/[A-Z]:\\|resolvedDiskPath|absolutePath/);
      await expect(queryAppTableForCompanion(appPath, "Bad Id", {})).rejects.toMatchObject({ code: "INVALID_APP_TABLE", status: 400 });
      await expect(queryAppTableForCompanion(appPath, "missing", {})).rejects.toMatchObject({ code: "APP_TABLE_NOT_ATTACHED" });
      await expect(queryAppTableForCompanion(appPath, "items", { limit: 201 })).rejects.toMatchObject({ code: "INVALID_APP_QUERY" });
      await expect(queryAppTableForCompanion(appPath, "items", { where: { unknown: true } })).rejects.toMatchObject({ code: "INVALID_APP_QUERY" });
      const tool = await executeVaultTool("app_query", { path: appPath, tableId: "items", query: { limit: 1 } });
      expect(tool.ok).toBe(true);
    });
  });

  it("authenticates a session, scopes tables, validates rows, and persists CRUD", async () => {
    await withVaultFixture(async () => {
      const appPath = await seedApp();
      await expect(saveAppManifest(appPath, {
        version: 1, enabled: true, tables: [{ id: "bad", name: "Bad", kind: "app", schema: { fields: [
          { id: "value", name: "Value", type: "not-a-real-type" },
        ] } }],
      })).rejects.toThrow(/Unsupported field type/);
      await expect(saveAppManifest(appPath, {
        version: 1, enabled: true, tables: [{ id: "bad", name: "Bad", kind: "app", schema: { fields: [
          { id: "Not Canonical", name: "Value", type: "text", extra: true },
        ] } }],
      })).rejects.toThrow(/unknown keys/);
      await expect(saveAppManifest(appPath, {
        version: 1, enabled: true, tables: [{ id: "bad", name: "Bad", kind: "app", schema: { fields: [
          { id: "not_canonical", name: "Value", type: "select", options: ["", "one"] },
        ] } }],
      })).rejects.toThrow(/non-empty string/);
      const boot = await bootstrapAppRuntime(appPath);
      expect(boot.page).toEqual(expect.objectContaining({ path: appPath, body: "<main>Runtime</main>" }));
      expect(JSON.stringify(boot)).not.toMatch(/[A-Z]:\\|resolvedDiskPath|absolutePath/);

      await expect(executeAppRpc({ path: appPath, sessionToken: "wrong", tableId: "items", operation: "query" })).rejects.toMatchObject({ code: "APP_RPC_UNAUTHORIZED" });
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "other", operation: "query" })).rejects.toMatchObject({ code: "APP_TABLE_NOT_ATTACHED" });
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "run" })).rejects.toMatchObject({ code: "INVALID_APP_OPERATION" });
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "add", values: { done: false } })).rejects.toMatchObject({ code: "INVALID_APP_ROW" });
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "add", values: { name: "One", unknown: true } })).rejects.toMatchObject({ code: "INVALID_APP_ROW" });
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "query", query: { orderBy: "name" } })).rejects.toMatchObject({ code: "INVALID_APP_QUERY" });
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "query", query: { where: { missing: true } } })).rejects.toMatchObject({ code: "INVALID_APP_QUERY" });

      const added = await executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "add", values: { name: "One", done: false } }) as { row: { id: string } };
      expect(added).not.toHaveProperty("rows");
      await executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "update", rowId: added.row.id, values: { name: "One", done: true } });
      const queried = await executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "query", query: { where: { done: true } } }) as { rows: Array<{ values: Record<string, unknown> }> };
      expect(queried.rows.map((row) => row.values)).toEqual([{ name: "One", done: true }]);
      await executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "delete", rowId: added.row.id });
      expect((await bootstrapAppRuntime(appPath)).tables[0].rows).toEqual([]);
    });
  });

  it("rejects prototype keys, oversized payloads, mismatched and expired sessions", async () => {
    await withVaultFixture(async () => {
      const first = await seedApp();
      const second = (await createPage({ sectionPath: SECTION, title: "Second App", noteType: "app" })).path;
      const boot = await bootstrapAppRuntime(first);
      const polluted = JSON.parse('{"name":"x","__proto__":{"admin":true}}');
      await expect(executeAppRpc({ path: first, sessionToken: boot.sessionToken, tableId: "items", operation: "add", values: polluted })).rejects.toMatchObject({ code: "INVALID_APP_VALUE" });
      await expect(executeAppRpc({ path: first, sessionToken: boot.sessionToken, tableId: "items", operation: "add", values: { name: "x".repeat(300_000), done: false } })).rejects.toMatchObject({ code: "INVALID_APP_VALUE" });
      await expect(executeAppRpc({ path: second, sessionToken: boot.sessionToken, tableId: "items", operation: "query" })).rejects.toMatchObject({ code: "APP_RPC_UNAUTHORIZED" });

      const fresh = await bootstrapAppRuntime(first);
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(now + 31 * 60 * 1000);
      await expect(executeAppRpc({ path: first, sessionToken: fresh.sessionToken, tableId: "items", operation: "query" })).rejects.toMatchObject({ code: "APP_RPC_UNAUTHORIZED" });
      jest.restoreAllMocks();
    });
  });

  it("refreshes data without issuing sessions and replaces the prior frame token on bootstrap", async () => {
    await withVaultFixture(async () => {
      const appPath = await seedApp();
      const first = await bootstrapAppRuntime(appPath);
      await readAppDataSnapshot(appPath);
      await readAppDataSnapshot(appPath);
      await expect(executeAppRpc({ path: appPath, sessionToken: first.sessionToken, tableId: "items", operation: "query" })).resolves.toBeDefined();
      const second = await bootstrapAppRuntime(appPath, first.sessionToken);
      await expect(executeAppRpc({ path: appPath, sessionToken: first.sessionToken, tableId: "items", operation: "query" })).rejects.toMatchObject({ code: "APP_RPC_UNAUTHORIZED" });
      await expect(executeAppRpc({ path: appPath, sessionToken: second.sessionToken, tableId: "items", operation: "query" })).resolves.toBeDefined();
    });
  });

  it("serializes concurrent durable writes without dropping rows", async () => {
    await withVaultFixture(async () => {
      const appPath = await seedApp();
      const boot = await bootstrapAppRuntime(appPath);
      await Promise.all(Array.from({ length: 20 }, (_, index) => executeAppRpc({
        path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "add",
        values: { name: `Item ${index}`, done: false },
      })));
      const reloaded = await bootstrapAppRuntime(appPath);
      expect(reloaded.tables[0].rows).toHaveLength(20);
      expect(new Set(reloaded.tables[0].rows.map((row) => row.values.name)).size).toBe(20);
    });
  });

  it("idempotently persists host-accepted app-owned adds by client mutation id", async () => {
    await withVaultFixture(async () => {
      const appPath = await seedApp();
      const boot = await bootstrapAppRuntime(appPath);
      const input = { path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "add" as const, values: { name: "Accepted", done: false }, clientMutationId: "m_entry0001", acceptedAt: "2026-08-04T12:34:56.000Z" };
      const first = await executeAppRpc(input) as { row: { id: string }; replayed?: boolean };
      const replay = await executeAppRpc(input) as { row: { id: string }; replayed?: boolean };
      expect(replay.row.id).toBe(first.row.id);
      expect(replay.replayed).toBe(true);
      expect((await readAppDataSnapshot(appPath)).tables[0].rows[0].createdAt).toBe(input.acceptedAt);
      expect((await readAppDataSnapshot(appPath)).tables[0].rows).toHaveLength(1);
      await expect(executeAppRpc({ ...input, values: { name: "Different", done: false } })).rejects.toMatchObject({ code: "APP_MUTATION_CONFLICT", status: 409 });
      await expect(executeAppRpc({ ...input, clientMutationId: "bad" })).rejects.toMatchObject({ code: "INVALID_APP_MUTATION" });
    });
  });

  it("idempotently upserts a stable draft row and never lets an older replay clobber newer local state", async () => {
    await withVaultFixture(async () => {
      const appPath = await seedApp();
      await saveAppManifest(appPath, { version: 1, enabled: true, tables: [{
        id: "drafts", name: "Drafts", kind: "app", schema: { fields: [
          { id: "kind", name: "Kind", type: "text", required: true },
          { id: "view", name: "View", type: "text", required: true },
        ] },
      }] });
      const boot = await bootstrapAppRuntime(appPath);
      const first = {
        path: appPath, sessionToken: boot.sessionToken, tableId: "drafts", operation: "upsert" as const,
        upsertKey: "workout", values: { kind: "workout", view: { weight: 50 } },
        clientMutationId: "m_draft0001", acceptedAt: "2026-09-14T10:00:00.000Z",
      };
      const newest = {
        ...first, values: { kind: "workout", view: { weight: 60 } },
        clientMutationId: "m_draft0002", acceptedAt: "2026-09-14T10:00:01.000Z",
      };
      const inserted = await executeAppRpc(first) as { row: { id: string }; replayed?: boolean };
      expect(inserted.row.id).toBe("r_u_workout");
      await expect(executeAppRpc(first)).resolves.toEqual(expect.objectContaining({ replayed: true }));
      await executeAppRpc(newest);
      await expect(executeAppRpc(first)).rejects.toMatchObject({ code: "APP_MUTATION_CONFLICT", status: 409 });
      const rows = (await readAppDataSnapshot(appPath)).tables[0].rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(expect.objectContaining({
        id: "r_u_workout", updatedAt: newest.acceptedAt, values: newest.values,
      }));
      await expect(executeAppRpc({ ...newest, values: { kind: "retired", view: {} } }))
        .rejects.toMatchObject({ code: "APP_MUTATION_CONFLICT", status: 409 });
      await expect(executeAppRpc({ ...newest, upsertKey: "bad key" }))
        .rejects.toMatchObject({ code: "INVALID_APP_MUTATION" });
    });
  });

  it("caps query rows/bytes and returns a clear oversized-response failure", async () => {
    await withVaultFixture(async () => {
      const appPath = await seedApp();
      const boot = await bootstrapAppRuntime(appPath);
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "query", query: { limit: 201 } })).rejects.toMatchObject({ code: "INVALID_APP_QUERY" });
      await Promise.all(Array.from({ length: 5 }, (_, index) => executeAppRpc({
        path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "add",
        values: { name: `${index}-${"x".repeat(230_000)}`, done: false },
      })));
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "query" })).rejects.toMatchObject({ code: "APP_QUERY_TOO_LARGE" });
    });
  });

  it("attaches only real Log pages and mutates the existing Log row store without copying", async () => {
    await withVaultFixture(async (root) => {
      const appPath = await seedApp();
      const plain = await createPage({ sectionPath: SECTION, title: "Plain" });
      await expect(saveAppManifest(appPath, { version: 1, enabled: true, tables: [{ id: "entries", name: "Entries", kind: "log", pagePath: plain.path }] })).rejects.toMatchObject({ code: "INVALID_APP_ATTACHMENT" });
      const log = await createPage({ sectionPath: SECTION, title: "Shared Log", noteType: "log" });
      await saveAppManifest(appPath, { version: 1, enabled: true, tables: [{ id: "entries", name: "Entries", kind: "log", pagePath: log.path }] });
      const boot = await bootstrapAppRuntime(appPath);
      await executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "entries", operation: "add", values: { entry: "Shared row" } });
      expect((await readLogDocument(log.path)).rows).toHaveLength(1);
      const files = await fs.readdir(path.join(root, "Notebook", "Section"));
      expect(files).not.toContain("runtime-app.app-data.entries.json");
    });
  });

  it("persists Disable independently and moves/deletes every dynamic App sidecar with the page", async () => {
    await withVaultFixture(async (root) => {
      let appPath = await seedApp();
      const boot = await bootstrapAppRuntime(appPath);
      await executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "add", values: { name: "Persist", done: false } });
      expect((await setAppEnabled(appPath, false)).enabled).toBe(false);
      expect((await readAppManifest(appPath)).enabled).toBe(false);
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "query" })).rejects.toMatchObject({ code: "APP_RPC_UNAUTHORIZED" });
      const disabledSession = await bootstrapAppRuntime(appPath);
      await expect(executeAppRpc({ path: appPath, sessionToken: disabledSession.sessionToken, tableId: "items", operation: "query" })).rejects.toMatchObject({ code: "APP_DISABLED" });
      await expect(executeOwnerAppDataMutation({ path: appPath, sessionToken: "wrong", tableId: "items", operation: "add", values: { name: "Owner repair", done: false } })).rejects.toMatchObject({ code: "APP_RPC_UNAUTHORIZED" });
      await expect(executeOwnerAppDataMutation({ path: appPath, sessionToken: disabledSession.sessionToken, tableId: "items", operation: "add", values: { name: "Owner repair", done: false } })).resolves.toBeDefined();
      expect((await readAppDataSnapshot(appPath)).tables[0].rows.map((row) => row.values.name)).toContain("Owner repair");

      appPath = (await renamePage(appPath, "Renamed App")).path;
      let files = await fs.readdir(path.join(root, "Notebook", "Section"));
      expect(files).toEqual(expect.arrayContaining(["renamed-app.app.json", "renamed-app.app-data.items.json"]));
      expect(files.some((name) => name.startsWith("runtime-app.app"))).toBe(false);

      appPath = (await movePage(appPath, "Notebook/Other")).path;
      files = await fs.readdir(path.join(root, "Notebook", "Other"));
      expect(files).toEqual(expect.arrayContaining(["renamed-app.app.json", "renamed-app.app-data.items.json"]));
      await deletePage(appPath);
      files = await fs.readdir(path.join(root, "Notebook", "Other"));
      expect(files.some((name) => name.startsWith("renamed-app"))).toBe(false);
    });
  });
});

describe("maintained App template companion tools", () => {
  it("lists the versioned catalog and creates a persistent Action Checklist from an ordinary note", async () => {
    await withVaultFixture(async () => {
      const catalog = await executeVaultTool("app_template_list", {});
      expect(catalog.ok).toBe(true);
      if (!catalog.ok) return;
      const names = ((catalog.result.data as { templates: Array<{ name: string }> }).templates).map((template) => template.name);
      expect(names).toEqual(["Blank App", "Action Checklist", "Design Page", "Custom Log App"]);

      const note = await createPage({ sectionPath: SECTION, title: "Plan" });
      await savePage({ path: note.path, title: note.title, body: "<p>First action</p><p>- Second action</p>" });
      const created = await executeVaultTool("app_create_from_template", { sectionPath: SECTION, templateId: "action-checklist", title: "Plan App", sourcePath: note.path });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const appPath = ((created.result.data as { page: { path: string } }).page.path);
      let boot = await bootstrapAppRuntime(appPath);
      const items = boot.tables.find((table) => table.id === "items")!;
      const settings = boot.tables.find((table) => table.id === "settings")!;
      expect(items.rows.map((row) => row.values.text)).toEqual(["First action", "Second action"]);
      expect(settings.rows[0].values.value).toBe("visible");
      const first = items.rows[0];
      await executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "items", operation: "update", rowId: first.id, values: { ...first.values, checked: true, hidden: true } });
      await executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "settings", operation: "update", rowId: settings.rows[0].id, values: { value: "done" } });
      await expect(executeAppRpc({ path: appPath, sessionToken: boot.sessionToken, tableId: "settings", operation: "update", rowId: settings.rows[0].id, values: { value: "unsupported" } })).rejects.toMatchObject({ code: "INVALID_APP_ROW" });
      const update = await executeVaultTool("app_update", { path: appPath, source: "<main>Customized</main>" });
      expect(update.ok).toBe(true);
      boot = await bootstrapAppRuntime(appPath);
      expect(boot.tables.find((table) => table.id === "items")!.rows[0].values).toEqual(expect.objectContaining({ checked: true, hidden: true }));
      expect(boot.tables.find((table) => table.id === "settings")!.rows[0].values.value).toBe("done");
    });
  });

  it("creates Design Page explicitly as note_type=design with no migration", async () => {
    await withVaultFixture(async () => {
      const created = await executeVaultTool("app_create_from_template", { sectionPath: SECTION, templateId: "design-page" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect((created.result.data as { page: { metadata: Record<string, unknown> } }).page.metadata.note_type).toBe("design");
    });
  });
});
