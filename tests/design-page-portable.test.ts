import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import { invalidateVaultTreeCacheForTesting, readPage, readVaultTree } from "@/server/vault/pages";
import { resetRenderTokensForTesting } from "@/server/vault/page-render-token";
import { registerPortableNotebook, portableNotebookPath } from "@/server/vault/notebook-registry";
import { uploadPageAsset } from "@/server/vault/assets";
import { resolveVaultPath } from "@/server/vault/paths";

// SN-167 follow-up: editing UI files in a REMOTE (portable) vault is a primary
// use case. A portable notebook's `.html` files live in an external target repo
// (own-in-place), addressed via the "+<id>/…" vault path. These tests exercise
// the companion server flow end to end against a real external directory.

const DESIGN_BODY =
  '<!doctype html><html><head><style>.hero{padding:32px}</style></head>' +
  '<body><main class="hero"><h1>Remote design artifact</h1></main></body></html>';

async function withPortableFixture(
  run: (ctx: { vaultRoot: string; targetRepo: string; notebookPath: string; id: string }) => Promise<void>
) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousStateDir = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-pv-vault-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-pv-state-"));
  // Simulates an external project repo the owner wants to land UI files in.
  const targetRepo = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-pv-repo-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  invalidateVaultTreeCacheForTesting();
  resetRenderTokensForTesting();
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    const entry = registerPortableNotebook(targetRepo, "Target Repo", stateDir);
    await run({ vaultRoot, targetRepo, notebookPath: portableNotebookPath(entry.id), id: entry.id });
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    if (previousStateDir) process.env.SMART_NOTES_STATE_DIR = previousStateDir;
    else delete process.env.SMART_NOTES_STATE_DIR;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(targetRepo, { recursive: true, force: true });
  }
}

describe("design pages in a portable (remote) notebook — own-in-place", () => {
  it("creates a design page whose .html lands in the external target repo with note_type frontmatter", async () => {
    await withPortableFixture(async ({ targetRepo, notebookPath }) => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: notebookPath, title: "Landing Hero", noteType: "design", content: DESIGN_BODY },
      });
      const data = created.data as {
        page: { path: string };
        resolvedDiskPath?: string;
        vaultRelativePath?: string;
      };
      const page = data.page;

      // Path is a vault path under the portable prefix, not a native vault path.
      expect(page.path.startsWith(notebookPath)).toBe(true);

      // Companion discoverability: create returns the REAL absolute path in the
      // target repo — not vaultRoot+"/+id/…".
      expect(data.resolvedDiskPath).toBe(path.join(targetRepo, "landing-hero.html"));
      expect(data.vaultRelativePath).toBe(page.path);

      // The actual file lands in the EXTERNAL repo (own-in-place), not the vault root.
      const onDisk = path.join(targetRepo, "landing-hero.html");
      const raw = await fs.readFile(onDisk, "utf8");
      expect(raw).toContain("note_type: design");
      expect(raw).toContain("<style>"); // raw artifact preserved (not Tiptap-normalized)
      expect(raw).toContain("Remote design artifact");

      // Read back through the vault layer: note_type survives the create+save round-trip.
      const reread = await readPage(page.path);
      expect(reread.metadata.note_type).toBe("design");

      // notebook_list exposes rootPath so companions can map +id → target repo.
      const listed = await executeVaultCommand({ group: "notebook", action: "list", args: {} });
      const notebooks = (listed.data as { notebooks: Array<{ path: string; rootPath: string | null; isPortable: boolean }> })
        .notebooks;
      const portable = notebooks.find((n) => n.path === notebookPath);
      expect(portable?.isPortable).toBe(true);
      expect(portable?.rootPath).toBe(targetRepo);
    });
  });

  it("round-trips page_get / page_write / page_edit and keeps note_type=design", async () => {
    await withPortableFixture(async ({ notebookPath }) => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: notebookPath, title: "Card", noteType: "design", content: DESIGN_BODY },
      });
      const pagePath = (created.data as { page: { path: string } }).page.path;

      const got = await executeVaultCommand({ group: "page", action: "get", args: { path: pagePath } });
      const gotPage = (got.data as { page: { metadata: { note_type?: string }; body: string } }).page;
      expect(gotPage.metadata.note_type).toBe("design");
      expect(gotPage.body).toContain("Remote design artifact");

      // Full replace.
      const rewritten =
        '<!doctype html><html><head><style>.x{color:red}</style></head><body><h1>Rewritten remote</h1></body></html>';
      await executeVaultCommand({ group: "page", action: "write", args: { path: pagePath, body: rewritten } });

      // Targeted patch.
      await executeVaultCommand({
        group: "page",
        action: "edit",
        args: { path: pagePath, edits: [{ search: "Rewritten remote", replacement: "Patched remote" }] },
      });

      const reread = await readPage(pagePath);
      expect(reread.metadata.note_type).toBe("design");
      expect(reread.body).toContain("Patched remote");

      // reload/readPage resolves the portable path to the external repo verbatim.
      expect(reread.body).toContain("<style>");
    });
  });

  // Regression (companion feedback #1): renderUiToPng / page_render returned an
  // absoluteDiskPath built as path.join(vaultRoot, asset.path), which for a
  // portable page invents a "vaultRoot/+id/…" path that does NOT exist on disk.
  // The PNG actually lands in the target repo's sibling .assets. The render
  // helpers now resolve the asset path portable-aware (resolveVaultPath), which
  // is exactly what uploadPageAsset returns here.
  it("resolves a rendered asset's absolute disk path to the external repo, not vaultRoot", async () => {
    await withPortableFixture(async ({ vaultRoot, targetRepo, notebookPath }) => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: notebookPath, title: "Render Target", noteType: "design", content: DESIGN_BODY },
      });
      const pagePath = (created.data as { page: { path: string } }).page.path;

      // Same asset write path the render pipeline uses for its PNG output.
      const asset = await uploadPageAsset(pagePath, "ui-render-desktop-latest.png", Buffer.from([1, 2, 3, 4]), {
        overwrite: true,
      });

      // This is exactly how the render helpers now compute absoluteDiskPath
      // (kind "section": no .html extension check, portable-aware resolution).
      const absoluteDiskPath = resolveVaultPath(asset.path, "section").absolutePath;

      // It resolves under the EXTERNAL target repo, not the vault root.
      expect(absoluteDiskPath.startsWith(targetRepo)).toBe(true);
      expect(absoluteDiskPath.startsWith(vaultRoot)).toBe(false);

      // And the file genuinely exists at that path (the old buggy join did not).
      await expect(fs.access(absoluteDiskPath)).resolves.toBeUndefined();

      // The old buggy computation points at a non-existent vaultRoot/+id/… path.
      const buggyPath = path.join(vaultRoot, asset.path.replace(/\//g, path.sep));
      expect(buggyPath).not.toBe(absoluteDiskPath);
      await expect(fs.access(buggyPath)).rejects.toBeTruthy();
    });
  });

  it("surfaces the portable design page in the vault tree with noteType=design", async () => {
    await withPortableFixture(async ({ notebookPath }) => {
      await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: notebookPath, title: "Tree Design", noteType: "design", content: DESIGN_BODY },
      });

      invalidateVaultTreeCacheForTesting();
      const { tree } = await readVaultTree({ skipCache: true });
      const notebook = tree.find((nb) => nb.path === notebookPath);
      expect(notebook).toBeTruthy();
      const pages = [
        ...(notebook?.pages ?? []),
        ...(notebook?.sections ?? []).flatMap((section) => section.pages ?? []),
      ];
      const designPage = pages.find((p) => p.title === "Tree Design");
      expect(designPage).toBeTruthy();
      expect(designPage?.noteType).toBe("design");
    });
  });
});
