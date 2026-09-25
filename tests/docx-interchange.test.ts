import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  createPage,
  exportPageAsDocx,
  importPageFromDocx,
  readPage,
  readVaultTree,
  savePage,
} from "@/server/vault/pages";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-docx-"));
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

describe("DOCX interchange", () => {
  it("exports and imports headings, lists, tables, links, and images", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const source = await createPage({
        sectionPath: "Notebook/Section",
        title: "DOCX Round Trip",
      });
      const assetDir = path.join(vaultRoot, "Notebook", "Section", "docx-round-trip.assets");
      await fs.mkdir(assetDir, { recursive: true });
      const png = Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300010000000500010d0a2db40000000049454e44ae426082",
        "hex"
      );
      await fs.writeFile(path.join(assetDir, "photo.png"), png);

      await savePage({
        path: source.path,
        title: "DOCX Round Trip",
        body:
          '<h2>Overview</h2><p><strong>Bold</strong> and <em>italic</em> with <a href="https://example.com">link</a>.</p>' +
          "<ul><li><p>Bullet one</p></li></ul><ol><li><p>Step one</p></li></ol>" +
          "<table><tbody><tr><th>Column</th><td>Value</td></tr></tbody></table>" +
          '<p><img src="/vault/Notebook/Section/docx-round-trip.assets/photo.png" alt="Photo" /></p>',
      });

      const buffer = await exportPageAsDocx({ path: source.path });
      const zip = new AdmZip(buffer);
      expect(zip.getEntry("word/document.xml")).toBeTruthy();
      // docx library uses content-hash filenames for media; find by content instead of path
      const pngEntry = zip.getEntries().find((e) => e.entryName.startsWith("word/media/") && e.entryName.endsWith(".png"));
      expect(pngEntry).toBeTruthy();
      expect(pngEntry?.getData()).toEqual(png);

      const imported = await importPageFromDocx({
        sectionPath: "Notebook/Section",
        fileName: "round-trip.docx",
        buffer,
        sourceUrl: "https://docs.google.com/document/source",
        publishedUrl: "https://docs.google.com/document/published",
      });

      const reloaded = await readPage(imported.path);
      expect(reloaded.title).toBe("DOCX Round Trip");
      expect(reloaded.metadata.sourceUrl).toBe("https://docs.google.com/document/source");
      expect(reloaded.metadata.publishedUrl).toBe("https://docs.google.com/document/published");
      expect(reloaded.body).toContain("<h1>DOCX Round Trip</h1>");
      expect(reloaded.body).toContain("<h2>Overview</h2>");
      expect(reloaded.body).toContain("<strong>Bold</strong>");
      expect(reloaded.body).toContain("<em>italic</em>");
      expect(reloaded.body).toContain('<a href="https://example.com">link</a>');
      expect(reloaded.body).toContain("<ul>");
      expect(reloaded.body).toContain("<ol>");
      expect(reloaded.body).toContain("<table>");
      // mammoth wraps cell content in <p>; just verify both cells are present
      expect(reloaded.body).toContain("<td>");
      expect(reloaded.body).toMatch(/Value/);
      // mammoth names images image-N.ext (with hyphen)
      expect(reloaded.body).toContain('<img src="/vault/Notebook/Section/docx-round-trip-2.assets/image-1.png"');
      await expect(
        fs.readFile(path.join(vaultRoot, "Notebook", "Section", "docx-round-trip-2.assets", "image-1.png"))
      ).resolves.toEqual(png);
    });
  });

  it("rejects invalid DOCX input without creating a page", async () => {
    await withVaultFixture(async () => {
      await expect(
        importPageFromDocx({
          sectionPath: "Notebook/Section",
          fileName: "broken.docx",
          buffer: Buffer.from("not a docx"),
        })
      ).rejects.toThrow("not a readable DOCX");

      const tree = await readVaultTree({ skipCache: true });
      const fixtureNotebook = tree.tree.find((notebook) => notebook.path === "Notebook");
      const fixtureSection = fixtureNotebook?.sections.find((section) => section.path === "Notebook/Section");
      expect(fixtureSection?.pages).toEqual([]);
    });
  });
});
