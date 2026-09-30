import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { serializeFrontmatterDocument } from "@/server/vault/frontmatter";
import {
  exportPagePackage,
  importPagePackage,
  PAGE_PACKAGE_FORMAT,
  PAGE_PACKAGE_LIMITS,
  PAGE_PACKAGE_VERSION,
  validatePagePackage,
} from "@/server/vault/page-package";
import { invalidateVaultTreeCacheForTesting, readPage } from "@/server/vault/pages";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-page-package-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  invalidateVaultTreeCacheForTesting();
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Source"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Imported"), { recursive: true });
    await run(vaultRoot);
  } finally {
    invalidateVaultTreeCacheForTesting();
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

function packageBuffer(manifest: Record<string, unknown>, files: Record<string, Buffer | string> = {}) {
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest)));
  for (const [entry, content] of Object.entries(files)) {
    zip.addFile(entry, Buffer.isBuffer(content) ? content : Buffer.from(content));
  }
  return zip.toBuffer();
}

function packageBufferWithRawEntryName(
  packageManifest: Record<string, unknown>,
  placeholderName: string,
  rawEntryName: string
) {
  expect(Buffer.byteLength(placeholderName)).toBe(Buffer.byteLength(rawEntryName));
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(packageManifest)));
  zip.addFile(placeholderName, Buffer.alloc(0));
  const buffer = zip.toBuffer();
  const placeholder = Buffer.from(placeholderName);
  const replacement = Buffer.from(rawEntryName);
  for (let index = 0; index <= buffer.length - placeholder.length; index += 1) {
    if (buffer.subarray(index, index + placeholder.length).equals(placeholder)) {
      replacement.copy(buffer, index);
      index += placeholder.length - 1;
    }
  }
  return buffer;
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    format: PAGE_PACKAGE_FORMAT,
    version: PAGE_PACKAGE_VERSION,
    page: {
      title: "Portable page",
      noteType: "text",
      metadata: { title: "Portable page", tags: ["portable"] },
      bodyHtml: "<p>Portable body</p>",
    },
    assets: [],
    ...overrides,
  };
}

describe("native text page packages", () => {
  it("round-trips saved HTML, referenced assets, metadata, and text-page ink into a collision-safe new page", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const sourcePath = path.join(vaultRoot, "Notebook", "Source", "research.html");
      const assetDirectory = path.join(vaultRoot, "Notebook", "Source", "research.assets");
      const annotations = { scene: { document: { id: "ink-scene" } }, drawableBottom: 812 };
      const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      await fs.mkdir(assetDirectory);
      await fs.writeFile(path.join(assetDirectory, "figure one.png"), image);
      await fs.writeFile(
        sourcePath,
        serializeFrontmatterDocument(
          {
            title: "Research memo",
            created: "2026-09-01T10:00:00.000Z",
            updated: "2026-09-02T10:00:00.000Z",
            tags: ["optics", "review"],
            comments: [{ id: "out-of-scope", text: "Do not export" }],
            parent_id: "Notebook/Source/parent.html",
          },
          '<h1>Research memo</h1><p><strong>Formatted</strong></p><img src="/vault/Notebook/Source/research.assets/figure%20one.png" alt="Figure">'
        )
      );
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Source", "research.annotations.json"),
        JSON.stringify(annotations)
      );
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Imported", "research-memo.html"),
        serializeFrontmatterDocument({ title: "Existing" }, "<p>Keep me</p>")
      );

      const exported = await exportPagePackage("Notebook/Source/research.html");
      const validated = validatePagePackage(exported.buffer);
      expect(validated.manifest.page.metadata).toMatchObject({
        title: "Research memo",
        tags: ["optics", "review"],
      });
      expect(validated.manifest.page.metadata).not.toHaveProperty("comments");
      expect(validated.manifest.page.metadata).not.toHaveProperty("parent_id");

      const imported = await importPagePackage({
        sectionPath: "Notebook/Imported",
        buffer: exported.buffer,
      });
      expect(imported.path).toBe("Notebook/Imported/research-memo-2.html");
      expect(imported.body).toContain("<strong>Formatted</strong>");
      expect(imported.body).toContain(
        '/vault/Notebook/Imported/research-memo-2.assets/figure%20one.png'
      );
      expect(imported.metadata.tags).toEqual(["optics", "review"]);
      expect(imported.metadata).not.toHaveProperty("comments");
      expect(imported.metadata).not.toHaveProperty("parent_id");
      await expect(
        fs.readFile(path.join(vaultRoot, "Notebook", "Imported", "research-memo-2.assets", "figure one.png"))
      ).resolves.toEqual(image);
      await expect(
        fs.readFile(path.join(vaultRoot, "Notebook", "Imported", "research-memo-2.annotations.json"), "utf8")
      ).resolves.toBe(JSON.stringify(annotations));
      await expect(
        fs.readFile(path.join(vaultRoot, "Notebook", "Imported", "research-memo.html"), "utf8")
      ).resolves.toContain("Keep me");
    });
  });

  it("skips every recognized orphan page-owned namespace even when the package has no ink or Companion data", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const targetSection = path.join(vaultRoot, "Notebook", "Imported");
      const orphanCases = [
        { stem: "orphan-assets", relativePath: "orphan-assets.assets", directory: true },
        { stem: "orphan-ink", relativePath: "orphan-ink.ink.json" },
        { stem: "orphan-annotations", relativePath: "orphan-annotations.annotations.json" },
        { stem: "orphan-companion", relativePath: "orphan-companion.companion.json" },
        { stem: "orphan-ref", relativePath: "orphan-ref.ref.json" },
        { stem: "orphan-log", relativePath: "orphan-log.log.json" },
        { stem: "orphan-form", relativePath: "orphan-form.form.json" },
        { stem: "orphan-design", relativePath: "orphan-design.design-link.json" },
        { stem: "orphan-app", relativePath: "orphan-app.app.json" },
        { stem: "orphan-app-data", relativePath: "orphan-app-data.app-data.entries.json" },
        { stem: "orphan-spreadsheet", relativePath: "orphan-spreadsheet.spreadsheet.json" },
        { stem: "orphan-jupyter", relativePath: "orphan-jupyter.jupyter", directory: true },
        { stem: "orphan-versions", relativePath: ".versions/orphan-versions", directory: true },
        { stem: "orphan-ink-versions", relativePath: ".versions/orphan-ink-versions.ink", directory: true },
        {
          stem: "orphan-annotation-versions",
          relativePath: ".versions/orphan-annotation-versions.annotations",
          directory: true,
        },
        {
          stem: "orphan-spreadsheet-versions",
          relativePath: ".versions/orphan-spreadsheet-versions.spreadsheet",
          directory: true,
        },
      ] as const;

      for (const orphan of orphanCases) {
        const orphanPath = path.join(targetSection, ...orphan.relativePath.split("/"));
        if (orphan.directory) {
          await fs.mkdir(orphanPath, { recursive: true });
          await fs.writeFile(path.join(orphanPath, "keep.txt"), "orphan must remain");
        } else {
          await fs.writeFile(orphanPath, "orphan must remain");
        }

        const imported = await importPagePackage({
          sectionPath: "Notebook/Imported",
          buffer: packageBuffer(manifest({
            page: {
              title: orphan.stem,
              noteType: "text",
              metadata: { title: orphan.stem },
              bodyHtml: "<p>Imported without sibling data</p>",
            },
          })),
        });

        expect(imported.path).toBe(`Notebook/Imported/${orphan.stem}-2.html`);
        if (orphan.directory) {
          await expect(fs.readFile(path.join(orphanPath, "keep.txt"), "utf8"))
            .resolves.toBe("orphan must remain");
        } else {
          await expect(fs.readFile(orphanPath, "utf8")).resolves.toBe("orphan must remain");
        }
      }
    });
  });

  it("rejects malformed, unsupported-version, unsafe-path, non-text, and oversized packages", () => {
    expect(() => validatePagePackage(Buffer.from("not a zip"))).toThrow("readable ZIP");
    expect(() => validatePagePackage(packageBuffer(manifest({ version: 2 })))).toThrow(
      "version 2 is not supported"
    );
    expect(() =>
      validatePagePackage(
        packageBuffer(
          manifest({
            assets: [{ entry: "assets/../escape.png", sourceUrls: ["/vault/a.assets/escape.png"] }],
          })
        )
      )
    ).toThrow("Unsafe package path");
    expect(() =>
      validatePagePackage(
        packageBuffer(
          manifest({
            page: {
              title: "Drawing",
              noteType: "ink",
              metadata: { title: "Drawing", note_type: "ink" },
              bodyHtml: "",
            },
          })
        )
      )
    ).toThrow("text pages only");
    expect(() =>
      validatePagePackage(
        packageBuffer(
          manifest({
            page: {
              title: "Huge",
              noteType: "text",
              metadata: { title: "Huge" },
              bodyHtml: "x".repeat(PAGE_PACKAGE_LIMITS.bodyBytes + 1),
            },
          })
        )
      )
    ).toThrow("HTML body is too large");
  });

  it("validates the whole package before changing the target section", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const before = await fs.readdir(path.join(vaultRoot, "Notebook", "Imported"));
      const invalid = packageBuffer(
        manifest({
          assets: [
            {
              entry: "assets/missing.png",
              sourceUrls: ["/vault/Notebook/Source/page.assets/missing.png"],
            },
          ],
        })
      );
      await expect(
        importPagePackage({ sectionPath: "Notebook/Imported", buffer: invalid })
      ).rejects.toThrow("missing asset");
      expect(await fs.readdir(path.join(vaultRoot, "Notebook", "Imported"))).toEqual(before);
    });
  });

  it("rejects traversal and unexpected ZIP directory entries before changing the target section", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const targetSection = path.join(vaultRoot, "Notebook", "Imported");
      const before = await fs.readdir(targetSection);
      const invalidPackages = [
        {
          buffer: packageBufferWithRawEntryName(manifest(), "aa/escape/", "../escape/"),
          message: "Unsafe package path",
        },
        {
          buffer: packageBuffer(manifest(), { "assets/": Buffer.alloc(0) }),
          message: "unexpected directory",
        },
      ];

      for (const invalid of invalidPackages) {
        await expect(
          importPagePackage({ sectionPath: "Notebook/Imported", buffer: invalid.buffer })
        ).rejects.toThrow(invalid.message);
        expect(await fs.readdir(targetSection)).toEqual(before);
      }
    });
  });

  it("rolls back staged siblings when the final atomic page commit fails", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const sourcePath = path.join(vaultRoot, "Notebook", "Source", "atomic.html");
      const assetsPath = path.join(vaultRoot, "Notebook", "Source", "atomic.assets");
      await fs.mkdir(assetsPath);
      await fs.writeFile(path.join(assetsPath, "asset.png"), Buffer.from("asset"));
      await fs.writeFile(
        sourcePath,
        serializeFrontmatterDocument(
          { title: "Atomic" },
          '<img src="/vault/Notebook/Source/atomic.assets/asset.png">'
        )
      );
      const exported = await exportPagePackage("Notebook/Source/atomic.html");
      const originalLink = fs.link.bind(fs);
      const linkSpy = jest.spyOn(fs, "link").mockImplementation(async (existingPath, newPath) => {
        if (String(newPath).endsWith("atomic.html")) {
          throw Object.assign(new Error("simulated commit failure"), { code: "EIO" });
        }
        return originalLink(existingPath, newPath);
      });
      try {
        await expect(
          importPagePackage({ sectionPath: "Notebook/Imported", buffer: exported.buffer })
        ).rejects.toThrow("vault was left unchanged");
      } finally {
        linkSpy.mockRestore();
      }

      expect(await fs.readdir(path.join(vaultRoot, "Notebook", "Imported"))).toEqual([]);
      await expect(readPage("Notebook/Imported/atomic.html")).rejects.toThrow("Page not found");
    });
  });
});
