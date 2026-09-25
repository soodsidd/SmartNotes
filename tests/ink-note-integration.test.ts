/**
 * Integration tests for SN-26: Ink note foundation and Tldraw host.
 *
 * Covers:
 * 1. Ink scene persistence round-trip (save → reload via readInkScene/saveInkScene)
 * 2. Ink scene persistence via the /api/ink route handlers (GET/PUT)
 * 3. Note-type routing: createPage with noteType="ink" writes note_type frontmatter
 * 4. readVaultTree propagates noteType="ink" for ink pages
 * 5. deletePage removes the ink sidecar
 * 6. renamePage moves the ink sidecar alongside the .md file
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPage,
  deletePage,
  readInkScene,
  readVaultTree,
  renamePage,
  saveInkScene,
} from "@/server/vault/pages";
import { GET, PUT } from "@/app/api/ink/route";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-ink-"));
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

const SAMPLE_SCENE = {
  document: { store: { "page:page": { typeName: "page", id: "page:page" } }, schema: { schemaVersion: 2, sequences: {} } },
  session: { exportBackground: true, currentPageId: "page:page", dialogProps: {}, isGridMode: false, isDebugMode: false, isToolLocked: false, screenBounds: { x: 0, y: 0, w: 800, h: 600 }, insets: [false, false, false, false], pageStates: [{ pageId: "page:page", camera: { x: 0, y: 0, z: 1 }, selectedShapeIds: [], focusedGroupId: null }] },
};

// ---------------------------------------------------------------------------
// 1. Ink scene persistence: direct server functions
// ---------------------------------------------------------------------------

describe("ink scene persistence (server layer)", () => {
  it("returns null scene with blank mode when no sidecar exists", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "ink-test", noteType: "ink" });
      const result = await readInkScene(page.path);
      expect(result.scene).toBeNull();
      expect(result.backgroundMode).toBe("blank");
    });
  });

  it("round-trips a scene through saveInkScene/readInkScene", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "canvas", noteType: "ink" });
      await saveInkScene(page.path, SAMPLE_SCENE);
      const result = await readInkScene(page.path);
      expect(result.scene).toEqual(SAMPLE_SCENE);
      expect(result.backgroundMode).toBe("blank");
    });
  });

  it("round-trips backgroundMode=grid", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "canvas-grid", noteType: "ink" });
      await saveInkScene(page.path, SAMPLE_SCENE, "grid");
      const result = await readInkScene(page.path);
      expect(result.scene).toEqual(SAMPLE_SCENE);
      expect(result.backgroundMode).toBe("grid");
    });
  });

  it("overwrites an existing scene on subsequent saves", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "canvas-overwrite", noteType: "ink" });
      await saveInkScene(page.path, { version: 1 });
      await saveInkScene(page.path, { version: 2 });
      const result = await readInkScene(page.path);
      expect((result.scene as { version: number }).version).toBe(2);
    });
  });

  it("migrates legacy sidecar format (raw Tldraw snapshot without wrapper)", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "legacy-canvas", noteType: "ink" });
      // Write old-format sidecar directly (raw Tldraw snapshot at top level)
      const sidecarPath = path.join(vaultRoot, page.path.replace(/\.html$/, ".ink.json"));
      await fs.writeFile(sidecarPath, JSON.stringify(SAMPLE_SCENE), "utf8");
      const result = await readInkScene(page.path);
      // Should migrate: scene is the old snapshot, backgroundMode defaults to blank
      expect(result.scene).toEqual(SAMPLE_SCENE);
      expect(result.backgroundMode).toBe("blank");
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Ink scene persistence: /api/ink route
// ---------------------------------------------------------------------------

describe("/api/ink route", () => {
  it("GET returns null scene with blank backgroundMode when no sidecar exists", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "get-test", noteType: "ink" });
      const response = await GET(new Request(`http://localhost/api/ink?path=${encodeURIComponent(page.path)}`));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { scene: unknown; backgroundMode: string };
      expect(body.scene).toBeNull();
      expect(body.backgroundMode).toBe("blank");
    });
  });

  it("PUT saves and GET retrieves the scene with backgroundMode", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "put-get", noteType: "ink" });

      const putResponse = await PUT(
        new Request("http://localhost/api/ink", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: page.path, scene: SAMPLE_SCENE, backgroundMode: "grid" }),
        })
      );
      expect(putResponse.status).toBe(200);
      const putBody = (await putResponse.json()) as { ok: boolean };
      expect(putBody.ok).toBe(true);

      const getResponse = await GET(new Request(`http://localhost/api/ink?path=${encodeURIComponent(page.path)}`));
      expect(getResponse.status).toBe(200);
      const getBody = (await getResponse.json()) as { scene: unknown; backgroundMode: string };
      expect(getBody.scene).toEqual(SAMPLE_SCENE);
      expect(getBody.backgroundMode).toBe("grid");
    });
  });

  it("PUT returns 400 when path is missing from body", async () => {
    await withVaultFixture(async () => {
      const response = await PUT(
        new Request("http://localhost/api/ink", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scene: {} }),
        })
      );
      expect(response.status).not.toBe(200);
    });
  });

  it("GET returns 400 when path query param is missing", async () => {
    await withVaultFixture(async () => {
      const response = await GET(new Request("http://localhost/api/ink"));
      expect(response.status).not.toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Note-type routing: createPage noteType="ink" writes note_type frontmatter
// ---------------------------------------------------------------------------

describe("note-type routing via createPage", () => {
  it("creates a text note without note_type frontmatter by default", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "default-page" });
      expect(page.metadata.note_type).toBeUndefined();

      // Verify raw file has no note_type key
      const raw = await fs.readFile(path.join(vaultRoot, page.path), "utf8");
      expect(raw).not.toContain("note_type:");
    });
  });

  it("creates an ink note with note_type: ink in frontmatter", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "ink-canvas", noteType: "ink" });
      expect(page.metadata.note_type).toBe("ink");

      // Verify raw file has the note_type key
      const raw = await fs.readFile(path.join(vaultRoot, page.path), "utf8");
      expect(raw).toContain("note_type: ink");
    });
  });
});

// ---------------------------------------------------------------------------
// 4. readVaultTree propagates noteType
// ---------------------------------------------------------------------------

describe("readVaultTree noteType propagation", () => {
  it("reports noteType=text for normal pages", async () => {
    await withVaultFixture(async () => {
      await createPage({ sectionPath: "Notebook/Section", title: "text-page" });
      const { tree } = await readVaultTree();
      const pages = tree.flatMap((nb) => nb.sections.flatMap((s) => s.pages));
      const textPages = pages.filter((p) => p.title === "text-page");
      expect(textPages.length).toBe(1);
      expect(textPages[0].noteType).toBe("text");
    });
  });

  it("reports noteType=ink for ink pages", async () => {
    await withVaultFixture(async () => {
      await createPage({ sectionPath: "Notebook/Section", title: "ink-page", noteType: "ink" });
      const { tree } = await readVaultTree();
      const pages = tree.flatMap((nb) => nb.sections.flatMap((s) => s.pages));
      const inkPages = pages.filter((p) => p.title === "ink-page");
      expect(inkPages.length).toBe(1);
      expect(inkPages[0].noteType).toBe("ink");
    });
  });
});

// ---------------------------------------------------------------------------
// 5. deletePage removes the ink sidecar
// ---------------------------------------------------------------------------

describe("deletePage cleans up ink sidecar", () => {
  it("removes the .ink.json file when the page is deleted", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "delete-canvas", noteType: "ink" });
      await saveInkScene(page.path, SAMPLE_SCENE);

      const sidecarPath = path.join(vaultRoot, page.path.replace(/\.html$/, ".ink.json"));
      await expect(fs.stat(sidecarPath)).resolves.toBeTruthy();

      await deletePage(page.path);

      await expect(fs.stat(sidecarPath)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("deletes a text page without error even when no sidecar exists", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "plain-delete" });
      await expect(deletePage(page.path)).resolves.toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 6. renamePage moves the ink sidecar
// ---------------------------------------------------------------------------

describe("renamePage moves ink sidecar", () => {
  it("moves the .ink.json when the page is renamed", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "rename-canvas", noteType: "ink" });
      await saveInkScene(page.path, SAMPLE_SCENE);

      const renamed = await renamePage(page.path, "renamed-canvas");
      const oldSidecar = path.join(vaultRoot, page.path.replace(/\.html$/, ".ink.json"));
      const newSidecar = path.join(vaultRoot, renamed.path.replace(/\.html$/, ".ink.json"));

      // Old sidecar gone, new sidecar present with correct content.
      await expect(fs.stat(oldSidecar)).rejects.toMatchObject({ code: "ENOENT" });
      const result = await readInkScene(renamed.path);
      expect(result.scene).toEqual(SAMPLE_SCENE);
    });
  });
});
