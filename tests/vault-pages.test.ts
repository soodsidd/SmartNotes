import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  __testInternals,
  capturePage,
  copyAttachmentToNote,
  createNotebook,
  createPage,
  createSection,
  deleteCompanionSessions,
  deleteNotebook,
  deletePage,
  deleteSection,
  movePage,
  previewAttachment,
  readCompanionSessions,
  readPage,
  readVaultTree,
  renameNotebook,
  renamePage,
  renameSection,
  saveCompanionSessions,
  savePage,
  spliceEditPage,
} from "@/server/vault/pages";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-vault-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-state-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "seed.html"),
      `---
title: Seed
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
tags:
  - optics
custom:
  stage: alpha
---
# Seed

Initial body.
`,
      "utf8"
    );
    await run(vaultRoot);
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    if (previousState) {
      process.env.SMART_NOTES_STATE_DIR = previousState;
    } else {
      delete process.env.SMART_NOTES_STATE_DIR;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
    delete (global as Record<string, unknown>)["_smartNotesIo"];
  }
}

describe("vault pages", () => {
  it("does not corrupt an existing page when an atomic write fails before rename", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-atomic-"));
    const target = path.join(directory, "page.html");

    try {
      await fs.writeFile(target, "original body", "utf8");
      await expect(
        __testInternals.writeAtomically(target, "new body", {
          beforeRename: () => {
            throw new Error("simulated failure");
          },
        })
      ).rejects.toThrow("simulated failure");

      await expect(fs.readFile(target, "utf8")).resolves.toBe("original body");
      await expect(fs.readdir(directory)).resolves.not.toContainEqual(
        expect.stringMatching(/\.tmp$/)
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("persists create, save, reopen, rename, and delete against the vault", async () => {
    await withVaultFixture(async () => {
      const tree = await readVaultTree();
      expect(tree.tree).toHaveLength(1);
      expect(tree.tree[0]?.sections[0]?.pages[0]?.title).toBe("Seed");

      const savedSeed = await savePage({
        path: "Notebook/Section/seed.html",
        title: "Seed Revised",
        body: "# Seed Revised\n\nOriginal note persisted.",
      });
      expect(savedSeed.metadata.tags).toEqual(["optics"]);
      expect(savedSeed.metadata.custom).toEqual({ stage: "alpha" });

      const created = await createPage({
        sectionPath: "Notebook/Section",
        title: "Fresh Page",
      });
      expect(created.path).toBe("Notebook/Section/fresh-page.html");

      const saved = await savePage({
        path: created.path,
        title: "Fresh Page",
        body: "# Draft\n\nSaved body.",
      });
      expect(saved.updatedAt).toBeTruthy();

      const reopened = await readPage(created.path);
      expect(reopened.body).toContain("Saved body.");

      const renamed = await renamePage(created.path, "Renamed Page");
      expect(renamed.path).toBe("Notebook/Section/renamed-page.html");

      const reloadedRenamed = await readPage(renamed.path);
      expect(reloadedRenamed.title).toBe("Renamed Page");

      await deletePage(renamed.path);
      await expect(readPage(renamed.path)).rejects.toThrow("Page not found");

      const original = await readPage("Notebook/Section/seed.html");
      expect(original.title).toBe("Seed Revised");
      expect(original.metadata.tags).toEqual(["optics"]);
      expect(original.metadata.custom).toEqual({ stage: "alpha" });
    });
  });

  it("suppresses splice edit live-sync echoes to the originating socket when provided", async () => {
    await withVaultFixture(async () => {
      const emit = jest.fn();
      const exceptEmit = jest.fn();
      const except = jest.fn(() => ({ emit: exceptEmit }));
      (global as Record<string, unknown>)["_smartNotesIo"] = { emit, except };

      const page = await readPage("Notebook/Section/seed.html");
      const start = page.body.indexOf("Initial body.");
      const end = start + "Initial body.".length;

      const saved = await spliceEditPage({
        path: "Notebook/Section/seed.html",
        start,
        end,
        replacement: "Splice replacement.",
        originSocketId: "socket-splice",
        originClientId: "client-splice",
      });

      expect(saved.body).toContain("Splice replacement.");
      expect(except).toHaveBeenCalledWith("socket-splice");
      expect(exceptEmit).toHaveBeenCalledWith("file_updated", {
        path: "Notebook/Section/seed.html",
        content: saved.body,
        originSocketId: "socket-splice",
        originClientId: "client-splice",
      });
      expect(emit).not.toHaveBeenCalledWith("file_updated", expect.anything());
    });
  });

  it("creates child pages under a section-nested parent (SN-157)", async () => {
    await withVaultFixture(async () => {
      // Reproduces the tree context-menu payload: notebookPath is the top-level
      // notebook, sectionPath is null, and parentId points at a page that lives
      // inside a section. This previously threw INVALID_PARENT.
      const child = await createPage({
        notebookPath: "Notebook",
        sectionPath: null,
        parentId: "Notebook/Section/seed.html",
        title: "Section Child",
      });
      expect(child.path).toBe("Notebook/Section/section-child.html");
      expect(child.metadata.parent_id).toBe("Notebook/Section/seed.html");

      // A grandchild (depth 2) is still permitted...
      const grandchild = await createPage({
        notebookPath: "Notebook",
        sectionPath: null,
        parentId: child.path,
        title: "Grandchild",
      });
      expect(grandchild.metadata.parent_id).toBe(child.path);

      // ...but a fourth level must still be rejected by the depth cap.
      await expect(
        createPage({
          notebookPath: "Notebook",
          sectionPath: null,
          parentId: grandchild.path,
          title: "Too Deep",
        })
      ).rejects.toThrow("2 levels");
    });
  });

  it("creates child pages under a notebook-root parent (SN-157)", async () => {
    await withVaultFixture(async () => {
      const rootParent = await createPage({
        notebookPath: "Notebook",
        title: "Root Parent",
      });
      expect(rootParent.path).toBe("Notebook/root-parent.html");

      const child = await createPage({
        notebookPath: "Notebook",
        sectionPath: null,
        parentId: rootParent.path,
        title: "Root Child",
      });
      expect(child.path).toBe("Notebook/root-child.html");
      expect(child.metadata.parent_id).toBe(rootParent.path);
    });
  });

  it("rejects a child whose parent lives in a different notebook (SN-157)", async () => {
    await withVaultFixture(async () => {
      await createNotebook("Other");
      await expect(
        createPage({
          notebookPath: "Other",
          sectionPath: null,
          parentId: "Notebook/Section/seed.html",
          title: "Cross Notebook",
        })
      ).rejects.toThrow("same notebook");
    });
  });

  it("persists notebook-root pages without creating placeholder sections", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const created = await createPage({
        notebookPath: "Notebook",
        title: "Root Page",
      });
      expect(created.path).toBe("Notebook/root-page.html");
      expect(created.metadata.parent_id).toBeUndefined();
      await expect(fs.stat(path.join(vaultRoot, "Notebook", "root-page.html"))).resolves.toBeDefined();

      const saved = await savePage({
        path: created.path,
        title: "Root Page",
        body: "Root body.",
      });
      expect(saved.body).toBe("Root body.");

      await expect(readPage(created.path)).resolves.toMatchObject({
        title: "Root Page",
        body: "Root body.",
      });

      const tree = await readVaultTree({ skipCache: true });
      const notebook = tree.tree.find((entry) => entry.path === "Notebook");
      expect(notebook?.pages.map((page) => page.path)).toContain(created.path);
      expect(notebook?.sections.map((section) => section.path)).toEqual(["Notebook/Section"]);
      expect(notebook?.sections.flatMap((section) => section.pages.map((page) => page.path))).not.toContain(created.path);
    });
  });

  it("supports notebook and section CRUD, page moves, and Inbox capture against the vault tree", async () => {
    await withVaultFixture(async () => {
      const notebook = await createNotebook("Research");
      expect(notebook.path).toBe("Research");
      expect(notebook).not.toHaveProperty("inboxSectionPath");

      const treeAfterCreate = await readVaultTree();
      const createdNotebook = treeAfterCreate.tree.find((entry) => entry.path === "Research");
      expect(createdNotebook?.sections).toEqual([]);

      const createdSection = await createSection(notebook.path, "Sources");
      expect(createdSection.path).toBe("Research/Sources");

      const movedPage = await movePage("Notebook/Section/seed.html", createdSection.path);
      expect(movedPage.path).toBe("Research/Sources/seed.html");
      await expect(readPage("Notebook/Section/seed.html")).rejects.toThrow("Page not found");
      await expect(readPage("Research/Sources/seed.html")).resolves.toMatchObject({
        title: "Seed",
      });

      const captured = await capturePage({
        destination: "inbox",
        notebookPath: notebook.path,
        title: "Captured Note",
        content: "Captured body.",
      });
      expect(captured.path).toBe("Research/Inbox/captured-note.html");
      await expect(readPage(captured.path)).resolves.toMatchObject({
        body: "Captured body.",
      });

      const renamedSection = await renameSection("Research/Sources", "Primary Sources");
      expect(renamedSection.path).toBe("Research/Primary Sources");
      await expect(readPage("Research/Primary Sources/seed.html")).resolves.toMatchObject({
        title: "Seed",
      });

      const renamedNotebook = await renameNotebook("Research", "Archive");
      expect(renamedNotebook.path).toBe("Archive");
      await expect(readPage("Archive/Primary Sources/seed.html")).resolves.toMatchObject({
        title: "Seed",
      });
      await expect(readPage("Archive/Inbox/captured-note.html")).resolves.toMatchObject({
        body: "Captured body.",
      });

      const tree = await readVaultTree();
      const archiveNotebook = tree.tree.find((entry) => entry.path === "Archive");
      expect(archiveNotebook?.sections.map((section) => section.path)).toEqual([
        "Archive/Inbox",
        "Archive/Primary Sources",
      ]);

      await deleteSection("Archive/Primary Sources");
      await deleteNotebook("Archive");
      await expect(readPage("Archive/Inbox/captured-note.html")).rejects.toThrow("Page not found");
    });
  });

  it("previews and copies AI image attachments into vault attachments", async ( ) => {
    await withVaultFixture(async (vaultRoot) => {
      const png = Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300010000000500010d0a2db40000000049454e44ae426082",
        "hex"
      );
      const sourcePath = path.join(vaultRoot, "generated-preview.png");
      await fs.writeFile(sourcePath, png);

      const preview = await previewAttachment("Notebook/Section/seed.html", sourcePath);
      expect(preview.previewSrc.startsWith("data:image/png;base64,")).toBe(true);

      const copied = await copyAttachmentToNote(
        "Notebook/Section/seed.html",
        sourcePath,
        "Generated preview"
      );
      expect(copied.html).toBe('<img src="./attachments/generated-preview.png" alt="Generated preview" />');
      await expect(
        fs.readFile(path.join(vaultRoot, "attachments", "generated-preview.png"))
      ).resolves.toEqual(png);
    });
  });

  // SN-80: companion session sidecar — round-trip + carry on rename/move + delete.
  it("reads, writes, carries, and deletes the companion session sidecar", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const seedPath = "Notebook/Section/seed.html";
      const sidecarFile = path.join(vaultRoot, "Notebook", "Section", "seed.companion.json");

      // Empty by default.
      await expect(readCompanionSessions(seedPath)).resolves.toEqual({ scopes: {} });

      const scopes = {
        whole: { messages: [{ id: "u1", role: "user", content: "hello" }], updatedAt: "2026-06-22T00:00:00.000Z" },
        "section:intro": { messages: [{ id: "u2", role: "user", content: "intro" }] },
      };
      await saveCompanionSessions(seedPath, scopes);
      await expect(fs.stat(sidecarFile)).resolves.toBeTruthy();
      const roundTrip = await readCompanionSessions(seedPath);
      expect(Object.keys(roundTrip.scopes)).toEqual(["whole", "section:intro"]);

      // Carried alongside the page on rename.
      const renamed = await renamePage(seedPath, "Renamed Seed");
      await expect(fs.stat(sidecarFile)).rejects.toMatchObject({ code: "ENOENT" });
      const afterRename = await readCompanionSessions(renamed.path);
      expect(Object.keys(afterRename.scopes)).toEqual(["whole", "section:intro"]);

      // Carried alongside the page on move.
      const movedSection = await createSection("Notebook", "Archive");
      const moved = await movePage(renamed.path, movedSection.path);
      const afterMove = await readCompanionSessions(moved.path);
      expect(Object.keys(afterMove.scopes)).toEqual(["whole", "section:intro"]);

      // Removed when the page is deleted.
      await deletePage(moved.path);
      await expect(readCompanionSessions(moved.path)).resolves.toEqual({ scopes: {} });
    });
  });

  it("removes the companion sidecar when an empty scope map is saved", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const seedPath = "Notebook/Section/seed.html";
      const sidecarFile = path.join(vaultRoot, "Notebook", "Section", "seed.companion.json");

      await saveCompanionSessions(seedPath, {
        whole: { messages: [{ id: "u1", role: "user", content: "hi" }] },
      });
      await expect(fs.stat(sidecarFile)).resolves.toBeTruthy();

      await saveCompanionSessions(seedPath, {});
      await expect(fs.stat(sidecarFile)).rejects.toMatchObject({ code: "ENOENT" });

      // Deleting an already-absent sidecar is a no-op.
      await expect(deleteCompanionSessions(seedPath)).resolves.toBeUndefined();
    });
  });

  it("shares one companion store across every page in a notebook section", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const sectionPath = "Notebook/Section";
      const sidecarFile = path.join(vaultRoot, "Notebook", "Section", ".companion.json");
      const scopes = {
        section: {
          messages: [{ id: "u1", role: "user", content: "shared section thread" }],
        },
      };

      await saveCompanionSessions(sectionPath, scopes);

      await expect(fs.stat(sidecarFile)).resolves.toBeTruthy();
      await expect(readCompanionSessions(sectionPath)).resolves.toEqual({ scopes });

      await deleteCompanionSessions(sectionPath);
      await expect(fs.stat(sidecarFile)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});
