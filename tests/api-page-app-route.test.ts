import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, PATCH } from "@/app/api/page/app/route";
import { GET as DATA_GET, POST as DATA_POST } from "@/app/api/page/app/data/route";
import { POST as RPC_POST } from "@/app/api/page/app/rpc/route";
import { resetAppSessionsForTesting, saveAppManifest } from "@/server/vault/app-runtime";
import { createPage, invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";

async function withVault(run: () => Promise<void>) {
  const previous = process.env.SMART_NOTES_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-app-api-"));
  process.env.SMART_NOTES_VAULT = root;
  resetAppSessionsForTesting();
  invalidateVaultTreeCacheForTesting();
  try {
    await fs.mkdir(path.join(root, "Notebook", "Section"), { recursive: true });
    await run();
  } finally {
    if (previous) process.env.SMART_NOTES_VAULT = previous;
    else delete process.env.SMART_NOTES_VAULT;
    resetAppSessionsForTesting();
    invalidateVaultTreeCacheForTesting();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function appFixture() {
  const page = await createPage({ sectionPath: "Notebook/Section", title: "API App", noteType: "app" });
  await saveAppManifest(page.path, {
    version: 1, enabled: true,
    tables: [{ id: "items", name: "Items", kind: "app", schema: { fields: [{ id: "name", name: "Name", type: "text", required: true }] } }],
  });
  return page.path;
}

describe("App API host/session boundary", () => {
  it("bootstraps the owner host, performs scoped RPC, and persists Disable", async () => {
    await withVault(async () => {
      const pagePath = await appFixture();
      const bootstrapResponse = await GET(new Request(`http://localhost/api/page/app?path=${encodeURIComponent(pagePath)}`));
      expect(bootstrapResponse.status).toBe(200);
      const bootstrap = await bootstrapResponse.json() as { sessionToken: string; tables: unknown[] };
      expect(bootstrap.sessionToken).toHaveLength(43);
      expect((bootstrap as { revision?: string }).revision).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bootstrapResponse.headers.get("ETag")).toMatch(/^"sha256:[a-f0-9]{64}"$/);
      expect(JSON.stringify(bootstrap)).not.toContain("resolvedDiskPath");

      const add = await RPC_POST(new Request("http://localhost/api/page/app/rpc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pagePath, sessionToken: bootstrap.sessionToken, tableId: "items", operation: "add", values: { name: "Stored" } }),
      }));
      expect(add.status).toBe(200);
      const query = await RPC_POST(new Request("http://localhost/api/page/app/rpc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pagePath, sessionToken: bootstrap.sessionToken, tableId: "items", operation: "query" }),
      }));
      expect(((await query.json()) as { data: { rows: unknown[] } }).data.rows).toHaveLength(1);

      const disabled = await PATCH(new Request("http://localhost/api/page/app", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: pagePath, enabled: false }),
      }));
      expect(((await disabled.json()) as { manifest: { enabled: boolean } }).manifest.enabled).toBe(false);
      const disabledBootstrap = await (await GET(new Request(`http://localhost/api/page/app?path=${encodeURIComponent(pagePath)}`))).json() as { sessionToken: string };
      const ownerRepair = await DATA_POST(new Request("http://localhost/api/page/app/data", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pagePath, sessionToken: disabledBootstrap.sessionToken, tableId: "items", operation: "add", values: { name: "Owner repair" } }),
      }));
      expect(ownerRepair.status).toBe(200);
      const snapshot = await DATA_GET(new Request(`http://localhost/api/page/app/data?path=${encodeURIComponent(pagePath)}`));
      expect(snapshot.headers.get("ETag")).toMatch(/^"sha256:[a-f0-9]{64}"$/);
      expect(((await snapshot.json()) as { tables: Array<{ rows: unknown[] }> }).tables[0].rows).toHaveLength(2);
      const frameDenied = await RPC_POST(new Request("http://localhost/api/page/app/rpc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pagePath, sessionToken: disabledBootstrap.sessionToken, tableId: "items", operation: "query" }),
      }));
      expect(frameDenied.status).toBe(423);
    });
  });

  it("returns clear failures for an invalid token and unattached table", async () => {
    await withVault(async () => {
      const pagePath = await appFixture();
      const invalid = await RPC_POST(new Request("http://localhost/api/page/app/rpc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pagePath, sessionToken: "bad", tableId: "items", operation: "query" }),
      }));
      expect(invalid.status).toBe(401);
      expect((await invalid.json()).code).toBe("APP_RPC_UNAUTHORIZED");

      const bootstrap = await (await GET(new Request(`http://localhost/api/page/app?path=${encodeURIComponent(pagePath)}`))).json() as { sessionToken: string };
      const denied = await RPC_POST(new Request("http://localhost/api/page/app/rpc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pagePath, sessionToken: bootstrap.sessionToken, tableId: "private", operation: "query" }),
      }));
      expect(denied.status).toBe(403);
      expect((await denied.json()).code).toBe("APP_TABLE_NOT_ATTACHED");
    });
  });
});
