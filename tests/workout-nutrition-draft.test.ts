import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const source = fs.readFileSync(path.resolve("packages/workout-nutrition-app/app/source.html"), "utf8");
const domain = fs.readFileSync(path.resolve("packages/workout-nutrition-app/app/domain.js"), "utf8");
const document = source.replace("/*__WORKOUT_DOMAIN__*/", domain);
const form = JSON.parse(
  fs.readFileSync(path.resolve("tests/fixtures/sn-183-redacted-workout-log/Health/Strength/workout-log.form.json"), "utf8"),
);
const log = JSON.parse(
  fs.readFileSync(path.resolve("tests/fixtures/sn-183-redacted-workout-log/Health/Strength/workout-log.log.json"), "utf8"),
);

interface DraftRow {
  id: string;
  createdAt: string;
  values: Record<string, unknown>;
}

/** In-memory stand-in for the SN-182 host: entries/config are read-only fixtures; drafts is a real app-owned table. */
function makeHost(drafts: DraftRow[]) {
  const counters = { upsert: 0, delete: 0, accept: 0 };
  const accepted: unknown[] = [];
  const upsertDraft = async (table: string, upsertKey: string, values: Record<string, unknown>) => {
    if (table !== "drafts") throw new Error(`unexpected upsert on ${table}`);
    counters.upsert += 1;
    const rowId = `r_u_${upsertKey}`;
    const index = drafts.findIndex((row) => row.id === rowId);
    const row: DraftRow = index >= 0
      ? { ...drafts[index], values: JSON.parse(JSON.stringify(values)) }
      : { id: rowId, createdAt: new Date().toISOString(), values: JSON.parse(JSON.stringify(values)) };
    if (index >= 0) drafts[index] = row;
    else drafts.push(row);
    return { row, rowCount: drafts.length, pending: true };
  };
  const smartNotesApp = {
    counters,
    accepted,
    drafts,
    query: async (table: string, query: { where?: Record<string, unknown> } = {}) => {
      if (table === "entries") return { table: { id: "entries", schema: log.schema }, rows: log.rows };
      if (table === "config") return { table: { id: "config" }, rows: [{ values: { form_definition: form } }] };
      if (table === "drafts") {
        const where = query?.where || {};
        const rows = drafts
          .filter((row) => Object.entries(where).every(([key, value]) => Object.is(row.values[key], value)))
          .map((row) => ({ ...row, values: { ...row.values } }));
        return { table: { id: "drafts" }, rows };
      }
      return { table: { id: table }, rows: [] };
    },
    upsert: upsertDraft,
    delete: async (table: string, rowId: string) => {
      if (table !== "drafts") throw new Error(`unexpected delete on ${table}`);
      counters.delete += 1;
      const index = drafts.findIndex((row) => row.id === rowId);
      if (index !== -1) drafts.splice(index, 1);
      return { rowCount: drafts.length };
    },
    accept: async (_table: string, values: unknown, _mutationId: string, retire?: { tableId: string; upsertKey: string; values: Record<string, unknown> }) => {
      counters.accept += 1;
      accepted.push(values);
      if (retire) await upsertDraft(retire.tableId, retire.upsertKey, retire.values);
      return { pending: true };
    },
  };
  return smartNotesApp;
}

function mount(host: ReturnType<typeof makeHost>) {
  return new JSDOM(document, {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.defineProperty(window, "__SN_DRAFT_DEBOUNCE_MS", { value: 5, configurable: true });
      Object.defineProperty(window, "smartNotesApp", { value: host });
    },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForLoad(window: Window & typeof globalThis) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (window.document.querySelector("#workout-select")) return;
    await sleep(10);
  }
  throw new Error("app did not finish loading");
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`condition not met: ${label}`);
}

function selectWorkoutA(window: Window & typeof globalThis) {
  const select = window.document.querySelector("#workout-select") as HTMLSelectElement;
  select.value = "A";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

describe("SN-183 durable in-progress draft auto-save", () => {
  it("debounces a single durable draft on change and updates the same row", async () => {
    const host = makeHost([]);
    const dom = mount(host);
    try {
      const window = dom.window as unknown as Window & typeof globalThis;
      await waitForLoad(window);
      expect(host.drafts).toHaveLength(0);

      // One synchronous burst of edits must collapse into exactly one write (debounced).
      selectWorkoutA(window);
      const inputs = [...window.document.querySelectorAll("[data-set-field]")] as HTMLInputElement[];
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) {
        input.value = input.dataset.setField === "seconds" ? "45" : input.dataset.setField === "weight" ? "50" : "8";
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      }
      await waitFor(() => host.drafts.length === 1, "first draft persisted");
      expect(host.counters.upsert).toBe(1);
      expect(host.drafts).toHaveLength(1);
      const savedView = host.drafts[0].values.view as { workout?: string; exercises?: Array<{ sets: Array<{ weight?: number }> }> };
      expect(savedView.workout).toBe("A");
      expect(host.drafts[0].values.kind).toBe("workout");
      expect(typeof host.drafts[0].values.savedAt).toBe("string");

      // A later edit updates the same single row rather than creating another draft.
      const firstWeight = window.document.querySelector('[data-set="0"][data-set-field="weight"]') as HTMLInputElement;
      firstWeight.value = "60";
      firstWeight.dispatchEvent(new window.Event("input", { bubbles: true }));
      await waitFor(() => host.counters.upsert >= 2, "existing draft updated");
      expect(host.drafts).toHaveLength(1);
      const updatedView = host.drafts[0].values.view as { exercises: Array<{ sets: Array<{ weight?: number }> }> };
      expect(updatedView.exercises[0].sets[0].weight).toBe(60);
    } finally {
      dom.window.close();
    }
  });

  it("never surfaces an in-progress draft as a committed record", async () => {
    const host = makeHost([]);
    const dom = mount(host);
    try {
      const window = dom.window as unknown as Window & typeof globalThis;
      await waitForLoad(window);
      const committedBefore = log.rows.length;

      selectWorkoutA(window);
      const firstWeight = window.document.querySelector('[data-set="0"][data-set-field="weight"]') as HTMLInputElement;
      firstWeight.value = "50";
      firstWeight.dispatchEvent(new window.Event("input", { bubbles: true }));
      await waitFor(() => host.drafts.length === 1, "draft saved");

      // No Accept happened, so nothing enters the committed entries table.
      expect(host.counters.accept).toBe(0);
      expect(host.accepted).toHaveLength(0);
      const entries = await host.query("entries");
      expect(entries.rows).toHaveLength(committedBefore);
      expect(entries.rows.some((row: { id?: string }) => String(row.id || "").startsWith("r_u_"))).toBe(false);

      // History renders only committed rows; the live draft adds no history entry.
      (window.document.querySelector('[data-tab="history"]') as HTMLButtonElement).click();
      await sleep(10);
      expect(window.document.querySelectorAll("#history .history-row")).toHaveLength(committedBefore);
    } finally {
      dom.window.close();
    }
  });

  it("restores the latest unsent draft on reload so a mid-workout reload loses nothing", async () => {
    const drafts: DraftRow[] = [];
    const host1 = makeHost(drafts);
    const dom1 = mount(host1);
    let restoredWeight = "";
    try {
      const window = dom1.window as unknown as Window & typeof globalThis;
      await waitForLoad(window);
      selectWorkoutA(window);
      const firstWeight = window.document.querySelector('[data-set="0"][data-set-field="weight"]') as HTMLInputElement;
      firstWeight.value = "72";
      firstWeight.dispatchEvent(new window.Event("input", { bubbles: true }));
      const firstReps = window.document.querySelector('[data-set="0"][data-set-field="reps"]') as HTMLInputElement;
      firstReps.value = "9";
      firstReps.dispatchEvent(new window.Event("input", { bubbles: true }));
      await waitFor(() => drafts.length === 1, "draft saved before reload");
      restoredWeight = firstWeight.value;
    } finally {
      dom1.window.close();
    }
    expect(drafts).toHaveLength(1);

    // Simulate a sandbox reload: a fresh app instance sharing the same durable drafts table.
    const host2 = makeHost(drafts);
    const dom2 = mount(host2);
    try {
      const window = dom2.window as unknown as Window & typeof globalThis;
      await waitForLoad(window);
      await waitFor(
        () => (window.document.querySelector("#workout-select") as HTMLSelectElement | null)?.value === "A",
        "workout restored",
      );
      const firstWeight = window.document.querySelector('[data-set="0"][data-set-field="weight"]') as HTMLInputElement;
      expect(firstWeight.value).toBe("72");
      expect(restoredWeight).toBe("72");
      const firstReps = window.document.querySelector('[data-set="0"][data-set-field="reps"]') as HTMLInputElement;
      expect(firstReps.value).toBe("9");
      // Restoring an unchanged draft must not fork a second row or re-commit anything.
      await sleep(20);
      expect(drafts).toHaveLength(1);
      expect(host2.accepted).toHaveLength(0);
    } finally {
      dom2.window.close();
    }
  });

  it("retires the draft after a successful Accept so it cannot resurface", async () => {
    const host = makeHost([]);
    const dom = mount(host);
    try {
      const window = dom.window as unknown as Window & typeof globalThis;
      await waitForLoad(window);

      selectWorkoutA(window);
      (window.document.querySelector("#session-date") as HTMLInputElement).value = "2026-08-04";
      window.document.querySelector("#session-date")?.dispatchEvent(new window.Event("input", { bubbles: true }));
      const duration = window.document.querySelector("#duration") as HTMLInputElement;
      duration.value = "35";
      duration.dispatchEvent(new window.Event("input", { bubbles: true }));
      for (const input of [...window.document.querySelectorAll("[data-set-field]")] as HTMLInputElement[]) {
        input.value = input.dataset.setField === "seconds" ? "45" : input.dataset.setField === "weight" ? "50" : "8";
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      }
      await waitFor(() => host.drafts.length === 1, "draft saved before accept");

      (window.document.querySelector("#accept-workout") as HTMLButtonElement).click();
      await waitFor(() => host.counters.accept === 1, "entry accepted");
      await waitFor(() => host.drafts[0]?.values.kind === "retired", "draft retired after accept");
      expect((await host.query("drafts", { where: { kind: "workout" } })).rows).toHaveLength(0);
      expect(host.accepted).toHaveLength(1);
      const validation = window.document.querySelector("#validation")?.textContent || "";
      expect(validation).toBe("");

      // The reset form is not meaningful, so no stale draft is re-created.
      await sleep(20);
      expect(host.drafts).toHaveLength(1);
      expect(host.drafts[0].values.kind).toBe("retired");
    } finally {
      dom.window.close();
    }
  });

  it("declares the drafts table through the standard app manifest contract", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require("../packages/workout-nutrition-app/migration/migration.cjs");
    const legacyPage = "---\nnote_type: log\n---\n<p>legacy</p>";
    const appSource = migration.derive.appPageSource(legacyPage, "<main>App</main>");
    expect(appSource).toContain("note_type: app");
    // The generated manifest string is emitted by the migration; assert its declared shape.
    const manifestSource = fs.readFileSync(
      path.resolve("packages/workout-nutrition-app/migration/migration.cjs"),
      "utf8",
    );
    expect(manifestSource).toContain('id: "drafts"');
    expect(manifestSource).toContain('kind: "app"');
  });
});
