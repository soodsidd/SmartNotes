/**
 * Tests for SN-28: ink canvas background mode toggle (blank vs grid).
 *
 * Covers:
 * 1. Background mode defaults to "blank" for new ink notes
 * 2. Background mode "grid" round-trips through save/load
 * 3. Background mode switches correctly (blank → grid → blank)
 * 4. Background mode is returned correctly by the /api/ink GET route
 * 5. Background mode is persisted correctly by the /api/ink PUT route
 * 6. Legacy sidecar format (pre-SN-28) is migrated to "blank" without error
 * 7. Unknown backgroundMode values in PUT default to "blank"
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPage, readInkScene, saveInkScene } from "@/server/vault/pages";
import { GET, PUT } from "@/app/api/ink/route";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn28-bg-toggle-"));
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

const MINIMAL_SCENE = {
  document: {
    store: { "page:page": { typeName: "page", id: "page:page" } },
    schema: { schemaVersion: 2, sequences: {} },
  },
  session: {
    exportBackground: true,
    currentPageId: "page:page",
    dialogProps: {},
    isGridMode: false,
    isDebugMode: false,
    isToolLocked: false,
    screenBounds: { x: 0, y: 0, w: 800, h: 600 },
    insets: [false, false, false, false],
    pageStates: [{ pageId: "page:page", camera: { x: 0, y: 0, z: 1 }, selectedShapeIds: [], focusedGroupId: null }],
  },
};

// ---------------------------------------------------------------------------
// 1–3: Server function tests
// ---------------------------------------------------------------------------

describe("background mode — server functions", () => {
  it("defaults to blank for a new ink note with no sidecar", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "new-note", noteType: "ink" });
      const { scene, backgroundMode } = await readInkScene(page.path);
      expect(scene).toBeNull();
      expect(backgroundMode).toBe("blank");
    });
  });

  it("round-trips backgroundMode=grid", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "grid-note", noteType: "ink" });
      await saveInkScene(page.path, MINIMAL_SCENE, "grid");
      const { scene, backgroundMode } = await readInkScene(page.path);
      expect(scene).toEqual(MINIMAL_SCENE);
      expect(backgroundMode).toBe("grid");
    });
  });

  it("round-trips backgroundMode=blank explicitly", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "blank-note", noteType: "ink" });
      await saveInkScene(page.path, MINIMAL_SCENE, "blank");
      const { backgroundMode } = await readInkScene(page.path);
      expect(backgroundMode).toBe("blank");
    });
  });

  it("switches background mode from grid back to blank", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "toggle-note", noteType: "ink" });
      await saveInkScene(page.path, MINIMAL_SCENE, "grid");
      await saveInkScene(page.path, MINIMAL_SCENE, "blank");
      const { backgroundMode } = await readInkScene(page.path);
      expect(backgroundMode).toBe("blank");
    });
  });

  it("migrates legacy sidecar (no inkMeta wrapper) to blank mode", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "legacy-note", noteType: "ink" });
      // Write old format: raw Tldraw snapshot with `document` at top level
      const sidecarPath = path.join(vaultRoot, page.path.replace(/\.html$/, ".ink.json"));
      await fs.writeFile(sidecarPath, JSON.stringify(MINIMAL_SCENE), "utf8");
      const { scene, backgroundMode } = await readInkScene(page.path);
      expect(scene).toEqual(MINIMAL_SCENE);
      expect(backgroundMode).toBe("blank");
    });
  });
});

// ---------------------------------------------------------------------------
// 4–5: API route tests
// ---------------------------------------------------------------------------

describe("background mode — /api/ink route", () => {
  it("GET returns backgroundMode=blank for new note", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "api-new", noteType: "ink" });
      const res = await GET(new Request(`http://localhost/api/ink?path=${encodeURIComponent(page.path)}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { scene: unknown; backgroundMode: string };
      expect(body.backgroundMode).toBe("blank");
    });
  });

  it("PUT with backgroundMode=grid, then GET returns grid", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "api-grid", noteType: "ink" });

      await PUT(
        new Request("http://localhost/api/ink", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: page.path, scene: MINIMAL_SCENE, backgroundMode: "grid" }),
        })
      );

      const res = await GET(new Request(`http://localhost/api/ink?path=${encodeURIComponent(page.path)}`));
      const body = (await res.json()) as { scene: unknown; backgroundMode: string };
      expect(body.backgroundMode).toBe("grid");
    });
  });

  it("PUT with unknown backgroundMode defaults to blank", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "api-unknown", noteType: "ink" });

      await PUT(
        new Request("http://localhost/api/ink", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: page.path, scene: MINIMAL_SCENE, backgroundMode: "dots" }),
        })
      );

      const res = await GET(new Request(`http://localhost/api/ink?path=${encodeURIComponent(page.path)}`));
      const body = (await res.json()) as { backgroundMode: string };
      expect(body.backgroundMode).toBe("blank");
    });
  });

  it("PUT without backgroundMode field defaults to blank", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "api-nofield", noteType: "ink" });

      await PUT(
        new Request("http://localhost/api/ink", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: page.path, scene: MINIMAL_SCENE }),
        })
      );

      const res = await GET(new Request(`http://localhost/api/ink?path=${encodeURIComponent(page.path)}`));
      const body = (await res.json()) as { backgroundMode: string };
      expect(body.backgroundMode).toBe("blank");
    });
  });
});
