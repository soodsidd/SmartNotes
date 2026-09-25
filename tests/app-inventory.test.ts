import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeVaultTool } from "@/server/vault/agent-tools";
import {
  APP_INVENTORY_DEFAULT_SOURCE_CHARS,
  APP_INVENTORY_MAX_LIMIT,
} from "@/server/vault/app-inventory";
import { invalidateVaultTreeCacheForTesting, createPage, savePage } from "@/server/vault/pages";
import { resetAppSessionsForTesting, saveAppManifest } from "@/server/vault/app-runtime";

const SECTION = "Notebook/Section";

async function withVaultFixture(run: (root: string) => Promise<void>) {
  const previous = process.env.SMART_NOTES_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-app-inv-"));
  process.env.SMART_NOTES_VAULT = root;
  resetAppSessionsForTesting();
  invalidateVaultTreeCacheForTesting();
  try {
    await fs.mkdir(path.join(root, "Notebook", "Section"), { recursive: true });
    await run(root);
  } finally {
    if (previous) process.env.SMART_NOTES_VAULT = previous;
    else delete process.env.SMART_NOTES_VAULT;
    resetAppSessionsForTesting();
    invalidateVaultTreeCacheForTesting();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function seedNamedApp(title: string, body: string, template?: { id: string; version: number }) {
  const page = await createPage({ sectionPath: SECTION, title, noteType: "app" });
  await savePage({ path: page.path, title: page.title, body });
  await saveAppManifest(page.path, {
    version: 1,
    enabled: true,
    ...(template ? { template } : {}),
    tables: [
      {
        id: "items",
        name: "Items",
        kind: "app",
        schema: { fields: [{ id: "name", name: "Name", type: "text", required: true }] },
      },
    ],
  });
  return page.path;
}

describe("companion App vault inventory (SN-200)", () => {
  it("returns an empty bounded inventory when the vault has no App pages", async () => {
    await withVaultFixture(async () => {
      await createPage({ sectionPath: SECTION, title: "Ordinary note" });
      const listed = await executeVaultTool("app_inventory_list", {});
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      const data = listed.result.data as {
        apps: unknown[];
        total: number;
        limit: number;
        truncated: boolean;
        hint: string;
      };
      expect(data.apps).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.limit).toBeLessThanOrEqual(APP_INVENTORY_MAX_LIMIT);
      expect(data.truncated).toBe(false);
      expect(data.hint).toMatch(/No App pages/);
    });
  });

  it("lists multi-app summaries with template lineage and never injects full source by default", async () => {
    await withVaultFixture(async () => {
      const longBody = `<main><h1>Tracker</h1><p>${"x".repeat(400)}</p><script>${"y".repeat(200)}</script></main>`;
      const first = await seedNamedApp("Alpha App", longBody, { id: "blank-app", version: 1 });
      const second = await seedNamedApp("Beta App", "<main>Beta</main>");

      const listed = await executeVaultTool("app_inventory_list", { limit: 10 });
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      const data = listed.result.data as {
        apps: Array<{
          path: string;
          title: string;
          template?: { id: string; version: number };
          sourceSummary: string;
          sourceChars: number;
          attachments: Array<{ id: string; kind: string }>;
          source?: string;
        }>;
        total: number;
        truncated: boolean;
      };
      expect(data.total).toBe(2);
      expect(data.apps.map((app) => app.title).sort()).toEqual(["Alpha App", "Beta App"]);
      const alpha = data.apps.find((app) => app.path === first)!;
      const beta = data.apps.find((app) => app.path === second)!;
      expect(alpha.template).toEqual({ id: "blank-app", version: 1 });
      expect(beta.template).toBeUndefined();
      expect(alpha.attachments).toEqual([expect.objectContaining({ id: "items", kind: "app" })]);
      expect(alpha.sourceSummary.length).toBeLessThanOrEqual(181);
      expect(alpha.sourceChars).toBeGreaterThan(alpha.sourceSummary.length);
      expect(JSON.stringify(data.apps)).not.toContain("yyyy");
      expect(data.apps.every((app) => app.source === undefined)).toBe(true);

      const fetched = await executeVaultTool("app_inventory_get", { path: first, maxSourceChars: 512 });
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      const detail = fetched.result.data as {
        path: string;
        title: string;
        template?: { id: string; version: number };
        source: string;
        sourceTruncated: boolean;
        sourceChars: number;
        attachments: Array<{ id: string; fieldIds?: string[] }>;
        manifest: { tables: unknown[] };
        rows?: unknown;
      };
      expect(detail.path).toBe(first);
      expect(detail.title).toBe("Alpha App");
      expect(detail.template).toEqual({ id: "blank-app", version: 1 });
      expect(detail.sourceTruncated).toBe(true);
      expect(detail.source.length).toBeLessThan(detail.sourceChars);
      expect(detail.source).toContain("truncated");
      expect(detail.attachments[0].fieldIds).toEqual(["name"]);
      expect(detail.manifest.tables).toHaveLength(1);
      expect(detail.rows).toBeUndefined();
      expect(detail.sourceChars).toBeGreaterThan(APP_INVENTORY_DEFAULT_SOURCE_CHARS / 20);
    });
  });

  it("rejects inventory_get for non-App pages", async () => {
    await withVaultFixture(async () => {
      const note = await createPage({ sectionPath: SECTION, title: "Text" });
      const result = await executeVaultTool("app_inventory_get", { path: note.path });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("INVALID_APP");
    });
  });
});
