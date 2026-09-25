import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/page/log/route";
import { GET as MANIFEST_GET } from "@/app/api/page/log/manifest/route";
import { createPage } from "@/server/vault/pages";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-log-route-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await run(vaultRoot);
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    delete (global as Record<string, unknown>)["_smartNotesIo"];
  }
}

async function seedLog() {
  const page = await createPage({ sectionPath: "Notebook/Section", title: "Workout Log", noteType: "log" });
  return page.path;
}

describe("log API route (SN-144)", () => {
  it("reads form + rows, appends via POST, and exposes the row to a GET", async () => {
    await withVaultFixture(async () => {
      const logPath = await seedLog();

      const getResponse = await GET(new Request(`http://localhost/api/page/log?path=${encodeURIComponent(logPath)}`));
      expect(getResponse.status).toBe(200);
      const initial = (await getResponse.json()) as {
        schema: { fields: { id: string }[] };
        rows: unknown[];
        form: { schema: { properties?: Record<string, unknown> }; uischema: { type: string } };
      };
      expect(initial.rows).toEqual([]);
      expect(initial.form.uischema.type).toBe("VerticalLayout");
      expect(initial.form.schema.properties).toHaveProperty("entry");
      const fieldId = initial.schema.fields[0].id;

      const postResponse = await POST(
        new Request("http://localhost/api/page/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: logPath, values: { [fieldId]: "Squat" } }),
        })
      );
      expect(postResponse.status).toBe(201);
      const appended = (await postResponse.json()) as { row: { id: string }; form: unknown };
      expect(appended.row.id).toBeTruthy();
      expect(appended.form).toBeTruthy();

      const afterGet = await GET(new Request(`http://localhost/api/page/log?path=${encodeURIComponent(logPath)}`));
      const reloaded = (await afterGet.json()) as { rows: { id: string; values: Record<string, unknown> }[] };
      expect(reloaded.rows).toHaveLength(1);
      expect(reloaded.rows[0].values[fieldId]).toBe("Squat");
    });
  });

  it("replays a focused-shell row id without appending a duplicate", async () => {
    await withVaultFixture(async () => {
      const logPath = await seedLog();
      const requestBody = {
        path: logPath,
        rowId: "r_localretry123",
        createdAt: "2026-07-27T10:00:00.000Z",
        values: { entry: "Squat" },
      };
      const first = await POST(new Request("http://localhost/api/page/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }));
      const replay = await POST(new Request("http://localhost/api/page/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestBody, values: { entry: "Changed by retry" } }),
      }));

      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect((await first.json()).created).toBe(true);
      expect((await replay.json()).created).toBe(false);
      const reloaded = await GET(new Request(`http://localhost/api/page/log?path=${encodeURIComponent(logPath)}`));
      expect(((await reloaded.json()) as { rows: unknown[] }).rows).toHaveLength(1);
    });
  });

  it("updates a row via PATCH and deletes via DELETE", async () => {
    await withVaultFixture(async () => {
      const logPath = await seedLog();
      const initial = (await (await GET(
        new Request(`http://localhost/api/page/log?path=${encodeURIComponent(logPath)}`)
      )).json()) as { schema: { fields: { id: string }[] } };
      const fieldId = initial.schema.fields[0].id;

      const appended = (await (await POST(
        new Request("http://localhost/api/page/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: logPath, values: { [fieldId]: "Bench" } }),
        })
      )).json()) as { row: { id: string } };

      const patched = await PATCH(
        new Request("http://localhost/api/page/log", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: logPath, rowId: appended.row.id, values: { [fieldId]: "Bench Press" } }),
        })
      );
      const patchedBody = (await patched.json()) as { row: { values: Record<string, unknown> } };
      expect(patchedBody.row.values[fieldId]).toBe("Bench Press");

      const deleted = await DELETE(
        new Request(`http://localhost/api/page/log?path=${encodeURIComponent(logPath)}&rowId=${appended.row.id}`, {
          method: "DELETE",
        })
      );
      const deletedBody = (await deleted.json()) as { rows: unknown[] };
      expect(deletedBody.rows).toEqual([]);
    });
  });

  it("replaces the form script via PUT and projects table fields", async () => {
    await withVaultFixture(async () => {
      const logPath = await seedLog();
      await POST(
        new Request("http://localhost/api/page/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: logPath, values: { entry: "kept" } }),
        })
      );

      const put = await PUT(
        new Request("http://localhost/api/page/log", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: logPath,
            form: {
              version: 1,
              schema: {
                type: "object",
                properties: {
                  entry: { type: "string", title: "Exercise" },
                  reps: { type: "number", title: "Reps" },
                },
              },
              uischema: {
                type: "VerticalLayout",
                elements: [
                  { type: "Control", scope: "#/properties/entry" },
                  { type: "Control", scope: "#/properties/reps" },
                ],
              },
            },
          }),
        })
      );
      const body = (await put.json()) as {
        schema: { fields: { id: string; name: string }[] };
        rows: { values: Record<string, unknown> }[];
        form: { uischema: { type: string } };
      };
      expect(body.schema.fields.map((f) => f.id)).toEqual(["entry", "reps"]);
      expect(body.schema.fields.map((f) => f.name)).toEqual(["Exercise", "Reps"]);
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].values.entry).toBe("kept");
      expect(body.form.uischema.type).toBe("VerticalLayout");
    });
  });

  it("replaces the schema via PUT fields and preserves rows", async () => {
    await withVaultFixture(async () => {
      const logPath = await seedLog();
      const initial = (await (await GET(
        new Request(`http://localhost/api/page/log?path=${encodeURIComponent(logPath)}`)
      )).json()) as { schema: { fields: { id: string }[] } };
      const fieldId = initial.schema.fields[0].id;
      await POST(
        new Request("http://localhost/api/page/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: logPath, values: { [fieldId]: "kept" } }),
        })
      );

      const put = await PUT(
        new Request("http://localhost/api/page/log", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: logPath,
            fields: [
              { id: fieldId, name: "Exercise", type: "text" },
              { name: "Reps", type: "number" },
            ],
          }),
        })
      );
      const body = (await put.json()) as {
        schema: { fields: { name: string }[] };
        rows: { values: Record<string, unknown> }[];
        form: { schema: { properties?: Record<string, unknown> } };
      };
      expect(body.schema.fields.map((f) => f.name)).toEqual(["Exercise", "Reps"]);
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].values[fieldId]).toBe("kept");
      expect(body.form.schema.properties).toHaveProperty(fieldId);
    });
  });

  it("serves a per-page installable manifest pinned to the log's focused shell", async () => {
    await withVaultFixture(async () => {
      const logPath = await seedLog();
      const response = await MANIFEST_GET(
        new Request(`http://localhost/api/page/log/manifest?path=${encodeURIComponent(logPath)}`)
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("manifest");
      const manifest = (await response.json()) as {
        id: string;
        start_url: string;
        scope: string;
        display: string;
        name: string;
        icons: unknown[];
      };
      const encoded = encodeURIComponent(logPath);
      // start_url pins to THIS page's focused log — not the vault root.
      expect(manifest.start_url).toBe(`/log?path=${encoded}&source=pwa`);
      expect(manifest.id).toBe(`/log?path=${encoded}`);
      expect(manifest.scope).toBe("/log");
      expect(manifest.display).toBe("standalone");
      expect(manifest.name).toContain("Workout Log");
      expect(manifest.icons.length).toBeGreaterThan(0);
    });
  });

  it("rejects a manifest request for a non-log page", async () => {
    await withVaultFixture(async () => {
      const textPage = await createPage({ sectionPath: "Notebook/Section", title: "Plain" });
      const response = await MANIFEST_GET(
        new Request(`http://localhost/api/page/log/manifest?path=${encodeURIComponent(textPage.path)}`)
      );
      expect(response.status).toBe(400);
    });
  });
});
