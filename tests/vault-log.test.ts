jest.mock("@/server/jupyter/runtime", () => ({
  stopSession: jest.fn().mockResolvedValue({ stopped: true }),
}));

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendLogRow,
  createPage,
  deleteLogRow,
  deletePage,
  movePage,
  readLogDocument,
  readLogFormDefinition,
  readVaultTree,
  renamePage,
  saveLogFormDefinition,
  saveLogSchema,
  updateLogRow,
} from "@/server/vault/pages";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-log-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Other"), { recursive: true });
    await run(vaultRoot);
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

function stat(target: string) {
  return fs.stat(target).then(
    (s) => s,
    () => null
  );
}

async function createLog(sectionPath = "Notebook/Section", title = "Workout") {
  return createPage({ sectionPath, title, noteType: "log" });
}

describe("vault-native log pages (SN-144)", () => {
  it("seeds .log.json and .form.json sidecars with a typed schema and no rows", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createLog();
      expect(page.metadata.note_type).toBe("log");

      const logSidecar = path.join(vaultRoot, page.path.replace(/\.html$/i, ".log.json"));
      const formSidecar = path.join(vaultRoot, page.path.replace(/\.html$/i, ".form.json"));
      expect((await stat(logSidecar))?.isFile()).toBe(true);
      expect((await stat(formSidecar))?.isFile()).toBe(true);

      const doc = await readLogDocument(page.path);
      expect(doc.version).toBe(1);
      expect(doc.schema.fields.map((f) => f.id)).toEqual(["entry", "amount", "notes"]);
      expect(doc.rows).toEqual([]);

      const form = await readLogFormDefinition(page.path);
      expect(form.schema.properties).toHaveProperty("entry");
      expect(form.uischema.type).toBe("VerticalLayout");
    });
  });

  it("reports the log note type in the vault tree", async () => {
    await withVaultFixture(async () => {
      const page = await createLog();
      const { tree } = await readVaultTree({ skipCache: true });
      const summary = tree
        .flatMap((n) => n.sections)
        .flatMap((s) => s.pages)
        .find((p) => p.path === page.path);
      expect(summary?.noteType).toBe("log");
    });
  });

  it("appends a row on submit and makes it visible to the table view", async () => {
    await withVaultFixture(async () => {
      const page = await createLog();
      const doc = await readLogDocument(page.path);
      const entryField = doc.schema.fields[0];
      const amountField = doc.schema.fields[1];

      // Form submit → append.
      const { row } = await appendLogRow(page.path, {
        [entryField.id]: "Squat",
        [amountField.id]: "100",
      });
      expect(row.values[entryField.id]).toBe("Squat");
      expect(row.values[amountField.id]).toBe(100); // coerced to number

      // Table view reads the same sidecar and sees the row.
      const reloaded = await readLogDocument(page.path);
      expect(reloaded.rows).toHaveLength(1);
      expect(reloaded.rows[0].id).toBe(row.id);
      expect(reloaded.rows[0].values[entryField.id]).toBe("Squat");
    });
  });

  it("accepts a client row id idempotently so a lost response can be retried", async () => {
    await withVaultFixture(async () => {
      const page = await createLog();
      const options = { rowId: "r_localretry123", createdAt: "2026-07-27T10:00:00.000Z" };
      const first = await appendLogRow(page.path, { entry: "Squat" }, options);
      const replay = await appendLogRow(page.path, { entry: "Changed by retry" }, options);

      expect(first.created).toBe(true);
      expect(replay.created).toBe(false);
      expect(replay.row).toEqual(first.row);
      expect((await readLogDocument(page.path)).rows).toEqual([first.row]);
    });
  });

  it("serializes concurrent appends per log while keeping row-id replay idempotent", async () => {
    await withVaultFixture(async () => {
      const page = await createLog();
      const firstOptions = { rowId: "r_concurrent001", createdAt: "2026-07-27T10:00:00.000Z" };
      const secondOptions = { rowId: "r_concurrent002", createdAt: "2026-07-27T10:00:01.000Z" };
      const [first, replay, second] = await Promise.all([
        appendLogRow(page.path, { entry: "Squat" }, firstOptions),
        appendLogRow(page.path, { entry: "Replay must not replace" }, firstOptions),
        appendLogRow(page.path, { entry: "Bench" }, secondOptions),
      ]);

      expect(first.created).toBe(true);
      expect(replay.created).toBe(false);
      expect(second.created).toBe(true);
      const rows = (await readLogDocument(page.path)).rows;
      expect(rows.map((row) => row.id)).toEqual(["r_concurrent001", "r_concurrent002"]);
      expect(rows.map((row) => row.values.entry)).toEqual(["Squat", "Bench"]);
    });
  });

  it("updates and deletes rows for inspection and correction", async () => {
    await withVaultFixture(async () => {
      const page = await createLog();
      const { schema } = await readLogDocument(page.path);
      const entry = schema.fields[0];

      const { row } = await appendLogRow(page.path, { [entry.id]: "Bench" });
      const updated = await updateLogRow(page.path, row.id, { [entry.id]: "Bench Press" });
      expect(updated.row.values[entry.id]).toBe("Bench Press");
      expect(updated.row.updatedAt).toBeTruthy();

      const afterDelete = await deleteLogRow(page.path, row.id);
      expect(afterDelete.rows).toHaveLength(0);
    });
  });

  it("preserves rows when the schema changes, reshaping to new fields", async () => {
    await withVaultFixture(async () => {
      const page = await createLog();
      const original = await readLogDocument(page.path);
      const entry = original.schema.fields[0];
      await appendLogRow(page.path, { [entry.id]: "Deadlift" });

      // Replace schema: keep the entry field, add a new "Reps" number field.
      const saved = await saveLogSchema(page.path, [
        { id: entry.id, name: "Exercise", type: "text", required: true },
        { name: "Reps", type: "number" },
      ]);
      expect(saved.schema.fields.map((f) => f.name)).toEqual(["Exercise", "Reps"]);

      const reloaded = await readLogDocument(page.path);
      expect(reloaded.rows).toHaveLength(1);
      // Existing value survives; the new field defaults to null.
      expect(reloaded.rows[0].values[entry.id]).toBe("Deadlift");
      const repsField = reloaded.schema.fields[1];
      expect(reloaded.rows[0].values[repsField.id]).toBeNull();
    });
  });

  it("saves a JSON Forms script from Source and projects table fields", async () => {
    await withVaultFixture(async () => {
      const page = await createLog();
      const { document, form } = await saveLogFormDefinition(page.path, {
        version: 1,
        schema: {
          type: "object",
          properties: {
            exercise: { type: "string", title: "Exercise" },
            reps: { type: "number", title: "Reps" },
          },
          required: ["exercise"],
        },
        uischema: {
          type: "HorizontalLayout",
          elements: [
            { type: "Control", scope: "#/properties/exercise" },
            { type: "Control", scope: "#/properties/reps" },
          ],
        },
      });
      expect(form.uischema.type).toBe("HorizontalLayout");
      expect(document.schema.fields.map((f) => f.id)).toEqual(["exercise", "reps"]);
      expect(document.schema.fields[0].required).toBe(true);

      const reloaded = await readLogFormDefinition(page.path);
      expect(reloaded.schema.properties).toHaveProperty("exercise");
    });
  });

  it("preserves rows while a multi-image form script replaces the fields and rejects base64 row values", async () => {
    await withVaultFixture(async () => {
      const page = await createLog();
      const original = await readLogDocument(page.path);
      await appendLogRow(page.path, { entry: "Squat" });
      const { document } = await saveLogFormDefinition(page.path, {
        version: 1,
        schema: {
          type: "object",
          properties: {
            entry: { type: "string", title: "Exercise" },
            poses: { type: "array", title: "Poses", items: { type: "string", format: "image" } },
          },
        },
        uischema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/entry" }, { type: "Control", scope: "#/properties/poses" }] },
      });
      expect(document.rows).toHaveLength(1);
      expect(document.rows[0].values.entry).toBe("Squat");
      expect(document.schema.fields.find((field) => field.id === "poses")?.type).toBe("image-sequence");

      const { row } = await appendLogRow(page.path, {
        entry: "Lunge",
        poses: ["/vault/Notebook/Section/workout.assets/pose.png", "data:image/png;base64,aGVsbG8="],
      });
      expect(row.values.poses).toEqual(["/vault/Notebook/Section/workout.assets/pose.png"]);
      expect(original.rows).toEqual([]);
    });
  });

  it("relocates .log.json and .form.json when the page is renamed", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createLog("Notebook/Section", "Before");
      const { schema } = await readLogDocument(page.path);
      await appendLogRow(page.path, { [schema.fields[0].id]: "kept" });

      const renamed = await renamePage(page.path, "After");
      for (const ext of [".log.json", ".form.json"] as const) {
        const oldSidecar = path.join(vaultRoot, page.path.replace(/\.html$/i, ext));
        const newSidecar = path.join(vaultRoot, renamed.path.replace(/\.html$/i, ext));
        expect(await stat(oldSidecar)).toBeNull();
        expect((await stat(newSidecar))?.isFile()).toBe(true);
      }
      const doc = await readLogDocument(renamed.path);
      expect(doc.rows).toHaveLength(1);
      expect(doc.rows[0].values[schema.fields[0].id]).toBe("kept");
    });
  });

  it("relocates both sidecars when the page is moved between sections", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createLog();
      const moved = await movePage(page.path, "Notebook/Other");
      for (const ext of [".log.json", ".form.json"] as const) {
        const oldSidecar = path.join(vaultRoot, page.path.replace(/\.html$/i, ext));
        const newSidecar = path.join(vaultRoot, moved.path.replace(/\.html$/i, ext));
        expect(await stat(oldSidecar)).toBeNull();
        expect((await stat(newSidecar))?.isFile()).toBe(true);
      }
    });
  });

  it("removes both sidecars when the page is deleted", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createLog();
      const logSidecar = path.join(vaultRoot, page.path.replace(/\.html$/i, ".log.json"));
      const formSidecar = path.join(vaultRoot, page.path.replace(/\.html$/i, ".form.json"));
      expect((await stat(logSidecar))?.isFile()).toBe(true);
      expect((await stat(formSidecar))?.isFile()).toBe(true);
      await deletePage(page.path);
      expect(await stat(logSidecar)).toBeNull();
      expect(await stat(formSidecar)).toBeNull();
    });
  });

  it("does not create log sidecars for a plain text page", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "Plain" });
      const logSidecar = path.join(vaultRoot, page.path.replace(/\.html$/i, ".log.json"));
      const formSidecar = path.join(vaultRoot, page.path.replace(/\.html$/i, ".form.json"));
      expect(await stat(logSidecar)).toBeNull();
      expect(await stat(formSidecar)).toBeNull();
    });
  });
});
