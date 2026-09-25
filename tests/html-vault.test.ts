import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { POST } from "@/app/api/assets/route";
import { migrateMarkdownPagesToHtml } from "@/server/vault/migration";
import { createPage, readPage, savePage } from "@/server/vault/pages";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import { uploadPageAsset } from "@/server/vault/assets";
import { listPageVersions, restorePageVersion, snapshotPageContent } from "@/server/vault/versions";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-html-vault-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await run(vaultRoot);
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

describe("HTML vault storage (SN-8)", () => {
  it("persists HTML bodies through save and reload", async () => {
    await withVaultFixture(async () => {
      const created = await createPage({
        sectionPath: "Notebook/Section",
        title: "Html Note",
      });
      const html = "<h1>Html Note</h1><p>Hello <strong>world</strong></p>";
      const saved = await savePage({ path: created.path, title: "Html Note", body: html });
      expect(saved.body).toBe(html);
      const reloaded = await readPage(created.path);
      expect(reloaded.body).toBe(html);
    });
  });

  it("migrates legacy .md pages to .html and removes the .md file", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "legacy.md"),
        "---\ntitle: Legacy\ncreated: 2026-06-01T00:00:00Z\nupdated: 2026-06-01T00:00:00Z\n---\n# Legacy\n\nBody text.",
        "utf8"
      );

      const result = await migrateMarkdownPagesToHtml(vaultRoot);
      expect(result.converted).toEqual(["Notebook/Section/legacy.html"]);
      await expect(fs.stat(path.join(vaultRoot, "Notebook", "Section", "legacy.md"))).rejects.toThrow();
      const page = await readPage("Notebook/Section/legacy.html");
      expect(page.body).toContain("Body text");
    });
  });

  it("uploads assets to page .assets/ and serves vault URLs", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const created = await createPage({
        sectionPath: "Notebook/Section",
        title: "Asset Page",
      });
      const buffer = Buffer.from("fake-image-bytes");
      const asset = await uploadPageAsset(created.path, "photo.png", buffer);
      expect(asset.url.startsWith("/vault/")).toBe(true);
      expect(asset.isImage).toBe(true);
      const stored = path.join(
        vaultRoot,
        "Notebook",
        "Section",
        "asset-page.assets",
        "photo.png"
      );
      await expect(fs.readFile(stored)).resolves.toEqual(buffer);

      const response = await POST(
        new Request(`http://localhost/api/assets?path=${encodeURIComponent(created.path)}`, {
          method: "POST",
          body: (() => {
            const form = new FormData();
            form.append("file", new File([buffer], "upload.png", { type: "image/png" }));
            return form;
          })(),
        })
      );
      expect(response.status).toBe(201);
      const json = (await response.json()) as { asset: { url: string } };
      expect(json.asset.url).toContain("/vault/");
    });
  });

  it("round-trips rich HTML content", async () => {
    await withVaultFixture(async () => {
      const created = await createPage({
        sectionPath: "Notebook/Section",
        title: "Rich",
      });
      const html = [
        "<p>Highlighted <mark>important</mark> text</p>",
        '<p><span style="color: #dc2626">Red words</span></p>',
        "<hr>",
        '<img src="/vault/Notebook/Section/rich.assets/chart.png" alt="chart" />',
        '<span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf"><span class="file-attachment-icon" aria-hidden="true">PDF</span><a href="/vault/Notebook/Section/rich.assets/spec.pdf" target="_blank" rel="noopener noreferrer" class="file-attachment-name">spec.pdf</a></span>',
      ].join("\n");
      await savePage({ path: created.path, title: "Rich", body: html });
      const reloaded = await readPage(created.path);
      expect(reloaded.body).toContain("<mark>important</mark>");
      expect(reloaded.body).toContain('color: #dc2626');
      expect(reloaded.body).toContain("<hr");
      expect(reloaded.body).toContain("file-attachment-chip");
      expect(reloaded.body).toContain('data-file-type="pdf"');
    });
  });

  it("addresses comments against HTML bodies and reports orphans", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "commented.html"),
        `---
title: Commented
created: 2026-06-01T00:00:00Z
updated: 2026-06-01T00:00:00Z
comments:
  - id: cmt_1
    quote: anchor phrase
    text: fix this
    createdAt: 2026-06-01T00:00:00Z
    resolvedAt: null
---
<p>Before anchor phrase after.</p>
`,
        "utf8"
      );

      const addressed = await executeVaultCommand({
        group: "comment",
        action: "address",
        args: {
          path: "Notebook/Section/commented.html",
          id: "cmt_1",
          replacement: "revised phrase",
        },
      });
      const page = (addressed.data as { page: { body: string } }).page;
      expect(page.body).toContain("revised phrase");
      expect(page.body).not.toContain("anchor phrase");

      await savePage({
        path: "Notebook/Section/commented.html",
        title: "Commented",
        body: "<p>Body with no anchor.</p>",
      });
      const listed = await executeVaultCommand({
        group: "comment",
        action: "list",
        args: { path: "Notebook/Section/commented.html" },
      });
      expect((listed.data as { orphanedIds: string[] }).orphanedIds).toContain("cmt_1");
    });
  });

  it("snapshots and restores HTML page versions", async () => {
    await withVaultFixture(async () => {
      const created = await createPage({
        sectionPath: "Notebook/Section",
        title: "Versioned",
      });
      const v1 = "<p>Version one</p>";
      const v2 = "<p>Version two</p>";
      await savePage({ path: created.path, title: "Versioned", body: v1 });
      const firstSnapshot = await snapshotPageContent(created.path);
      expect(firstSnapshot.created).toBe(true);
      await savePage({ path: created.path, title: "Versioned", body: v2 });
      await snapshotPageContent(created.path);
      await restorePageVersion(created.path, firstSnapshot.entry!.id, "text");
      const restored = await readPage(created.path);
      expect(restored.body).toBe(v1);
    });
  });
});
