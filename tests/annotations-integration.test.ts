import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPage,
  deletePage,
  readAnnotationsScene,
  renamePage,
  saveAnnotationsScene,
} from "@/server/vault/pages";
import {
  listPageVersions,
  readPageVersionContent,
  restorePageVersion,
  snapshotAnnotationsContent,
  snapshotTextPageWithAnnotations,
  __testInternals,
} from "@/server/vault/versions";
import { GET, PUT } from "@/app/api/annotations/route";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-annotations-"));
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
    pageStates: [
      {
        pageId: "page:page",
        camera: { x: 0, y: 0, z: 1 },
        selectedShapeIds: [],
        focusedGroupId: null,
      },
    ],
  },
};

describe("annotations sidecar persistence", () => {
  it("returns null scene when no sidecar exists", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "text-note" });
      const result = await readAnnotationsScene(page.path);
      expect(result.scene).toBeNull();
    });
  });

  it("round-trips a scene through saveAnnotationsScene/readAnnotationsScene", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "annotated" });
      await saveAnnotationsScene(page.path, SAMPLE_SCENE);
      const result = await readAnnotationsScene(page.path);
      expect(result.scene).toEqual(SAMPLE_SCENE);
    });
  });

  it("serves annotations through GET/PUT /api/annotations", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "api-note" });

      const putResponse = await PUT(
        new Request("http://localhost/api/annotations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: page.path, scene: SAMPLE_SCENE }),
        })
      );
      expect(putResponse.status).toBe(200);

      const getResponse = await GET(
        new Request(`http://localhost/api/annotations?path=${encodeURIComponent(page.path)}`)
      );
      const payload = (await getResponse.json()) as { scene: unknown };
      expect(payload.scene).toEqual(SAMPLE_SCENE);
    });
  });

  it("moves the annotations sidecar when the page is renamed", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "rename-note" });
      await saveAnnotationsScene(page.path, SAMPLE_SCENE);

      const renamed = await renamePage(page.path, "Renamed note");
      const oldSidecar = path.join(vaultRoot, page.path.replace(/\.html$/, ".annotations.json"));
      const newSidecar = path.join(vaultRoot, renamed.path.replace(/\.html$/, ".annotations.json"));

      await expect(fs.stat(oldSidecar)).rejects.toThrow();
      const raw = await fs.readFile(newSidecar, "utf8");
      expect(JSON.parse(raw).scene).toEqual(SAMPLE_SCENE);
    });
  });

  it("removes the annotations sidecar when the page is deleted", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "delete-note" });
      await saveAnnotationsScene(page.path, SAMPLE_SCENE);
      const sidecarPath = path.join(vaultRoot, page.path.replace(/\.html$/, ".annotations.json"));
      await expect(fs.stat(sidecarPath)).resolves.toBeDefined();

      await deletePage(page.path);
      await expect(fs.stat(sidecarPath)).rejects.toThrow();
    });
  });
});

describe("annotations version history", () => {
  it("versions annotations sidecars under .versions/<page-stem>.annotations/", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "versioned" });
      await saveAnnotationsScene(page.path, SAMPLE_SCENE);
      await snapshotAnnotationsContent(page.path);

      const versionsDir = path.join(vaultRoot, "Notebook", "Section", ".versions", "versioned.annotations");
      const files = await fs.readdir(versionsDir);
      expect(files.some((file) => file.endsWith(".json"))).toBe(true);
    });
  });

  it("restores annotations alongside page content for text pages", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "restore-note" });
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "restore-note.html"),
        `---
title: Restore note
created: 2026-06-09T12:00:00Z
updated: 2026-06-09T12:00:00Z
---
<p>Original body</p>`,
        "utf8"
      );
      await saveAnnotationsScene(page.path, { marker: "v1" });

      await snapshotTextPageWithAnnotations(page.path);

      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "restore-note.html"),
        `---
title: Restore note
created: 2026-06-09T12:00:00Z
updated: 2026-06-09T12:05:00Z
---
<p>Changed body</p>`,
        "utf8"
      );
      await saveAnnotationsScene(page.path, { marker: "v2" });

      const pageVersions = await listPageVersions(page.path, "page");
      const target = pageVersions[pageVersions.length - 1];
      await restorePageVersion(page.path, target.id, "text");

      const body = await fs.readFile(path.join(vaultRoot, "Notebook", "Section", "restore-note.html"), "utf8");
      expect(body).toContain("Original body");

      const annotations = await readAnnotationsScene(page.path);
      expect(annotations.scene).toEqual({ marker: "v1" });
    });
  });
});
