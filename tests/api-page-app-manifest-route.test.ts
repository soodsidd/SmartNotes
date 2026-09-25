import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET } from "@/app/api/page/app/manifest/route";
import { generateMetadata } from "@/app/app/page";
import { createPage, invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";

async function withVault(run: () => Promise<void>) {
  const previous = process.env.SMART_NOTES_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-app-manifest-"));
  process.env.SMART_NOTES_VAULT = root;
  invalidateVaultTreeCacheForTesting();
  try {
    await fs.mkdir(path.join(root, "Notebook", "Section"), { recursive: true });
    await run();
  } finally {
    if (previous) process.env.SMART_NOTES_VAULT = previous;
    else delete process.env.SMART_NOTES_VAULT;
    invalidateVaultTreeCacheForTesting();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function makePage(title: string, noteType: "app" | "log") {
  const page = await createPage({ sectionPath: "Notebook/Section", title, noteType });
  return page.path;
}

describe("Per-page App manifest (SN-187)", () => {
  it("pins start_url and id to the App page focused shell with a /app scope", async () => {
    await withVault(async () => {
      const pagePath = await makePage("Blank App", "app");
      const encoded = encodeURIComponent(pagePath);
      const response = await GET(
        new Request(`http://localhost/api/page/app/manifest?path=${encoded}`)
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/manifest+json");

      const manifest = JSON.parse(await response.text());
      expect(manifest.start_url).toBe(`/app?path=${encoded}&source=pwa`);
      expect(manifest.id).toBe(`/app?path=${encoded}`);
      expect(manifest.scope).toBe("/app");
      expect(manifest.display).toBe("standalone");
      expect(manifest.name).toBe("Blank App — App");
      expect(manifest.theme_color).toBe("#0b0d10");
      expect(manifest.icons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ src: "/icon-192.png", sizes: "192x192", type: "image/png" }),
          expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", type: "image/png" }),
        ])
      );
    });
  });

  it("rejects a non-App page with a 400 note_type gate", async () => {
    await withVault(async () => {
      const logPath = await makePage("A Log", "log");
      const response = await GET(
        new Request(`http://localhost/api/page/app/manifest?path=${encodeURIComponent(logPath)}`)
      );
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("NOT_AN_APP_PAGE");
    });
  });

  it("requires a path", async () => {
    await withVault(async () => {
      const response = await GET(new Request("http://localhost/api/page/app/manifest"));
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});

describe("Focused App route metadata gate (SN-187)", () => {
  it("links the per-page App manifest for an App page", async () => {
    await withVault(async () => {
      const pagePath = await makePage("Blank App", "app");
      const metadata = await generateMetadata({ searchParams: { path: pagePath } });
      expect(metadata.title).toBe("Blank App — App");
      expect(metadata.manifest).toBe(`/api/page/app/manifest?path=${encodeURIComponent(pagePath)}`);
    });
  });

  it("does not pin a manifest for a non-App page", async () => {
    await withVault(async () => {
      const logPath = await makePage("A Log", "log");
      const metadata = await generateMetadata({ searchParams: { path: logPath } });
      expect(metadata.manifest).toBeUndefined();
      expect(metadata.title).toBe("App — Smart Notes");
    });
  });
});
