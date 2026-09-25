import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPage,
  deletePage,
  invalidateVaultTreeCacheForTesting,
  linkDesignPage,
  readAnnotationsScene,
  readPage,
  readVaultTree,
  relinkDesignPage,
  saveAnnotationsScene,
  savePage,
  setPageKeyNote,
  unlinkDesignPage,
} from "@/server/vault/pages";
import { registerPortableNotebook, portableNotebookPath } from "@/server/vault/notebook-registry";
import { resolveDesignLinkTarget } from "@/server/vault/design-link";
import { executeVaultTool } from "@/server/vault/agent-tools";
import { VaultError } from "@/server/vault/errors";
import { resetRenderTokensForTesting } from "@/server/vault/page-render-token";

jest.mock("@/server/vault/page-render", () => ({
  ...jest.requireActual("@/server/vault/page-render"),
  renderUiToPng: jest.fn(async (options: { pagePath: string; viewport?: unknown }) => ({
    relativePath: `${options.pagePath.replace(/\.html$/i, "")}.assets/ui-render-desktop-latest.png`,
    vaultUrl: "/vault/ui-render-desktop-latest.png",
    absoluteVaultUrl: "http://127.0.0.1:3002/vault/ui-render-desktop-latest.png",
    absoluteDiskPath: path.join(os.tmpdir(), "ui-render-desktop-latest.png"),
    width: options.viewport === "mobile" ? 780 : 2560,
    height: 3000,
    bytes: 16384,
    warnings: [],
  })),
}));

const { renderUiToPng } = jest.requireMock("@/server/vault/page-render") as {
  renderUiToPng: jest.Mock;
};

const SAFE_FIXTURE =
  "C:\\Projects\\Safe\\docs\\design-system\\Safe Switchgears Website (offline).html";

async function withPortableLinkFixture(
  run: (ctx: {
    vaultRoot: string;
    targetRepo: string;
    notebookPath: string;
    sectionAbs: string;
    sectionRel: string;
    stateDir: string;
  }) => Promise<void>
) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousStateDir = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-link-vault-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-link-state-"));
  const targetRepo = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-link-repo-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  invalidateVaultTreeCacheForTesting();
  resetRenderTokensForTesting();
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    const entry = registerPortableNotebook(targetRepo, "Linked Designs", stateDir);
    const notebookPath = portableNotebookPath(entry.id);
    const sectionAbs = path.join(targetRepo, "Concepts");
    await fs.mkdir(sectionAbs, { recursive: true });
    await run({
      vaultRoot,
      targetRepo,
      notebookPath,
      sectionAbs,
      sectionRel: `${notebookPath}/Concepts`,
      stateDir,
    });
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    if (previousStateDir) process.env.SMART_NOTES_STATE_DIR = previousStateDir;
    else delete process.env.SMART_NOTES_STATE_DIR;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(targetRepo, { recursive: true, force: true });
    invalidateVaultTreeCacheForTesting();
    resetRenderTokensForTesting();
  }
}

describe("linked design pages (SN-168)", () => {
  it("links an ordinary HTML file inside a portable root without copying or injecting frontmatter", async () => {
    await withPortableLinkFixture(async ({ sectionAbs }) => {
      const sourceName = "Safe Switchgears Website (offline).html";
      const sourceAbs = path.join(sectionAbs, sourceName);
      await fs.copyFile(SAFE_FIXTURE, sourceAbs);

      const beforeHtmlFiles = (await fs.readdir(sectionAbs)).filter((name) =>
        name.toLowerCase().endsWith(".html")
      );
      expect(beforeHtmlFiles).toEqual([sourceName]);

      const page = await linkDesignPage({ sourcePath: sourceAbs });
      expect(page.designLinked).toBe(true);
      expect(page.sourceMissing).toBeFalsy();
      expect(page.metadata.note_type).toBe("design");
      expect(page.title).toMatch(/Safe Switchgears/i);
      expect(page.body).toContain("Safe Switchgears");

      const afterEntries = await fs.readdir(sectionAbs);
      const htmlFiles = afterEntries.filter((name) => name.toLowerCase().endsWith(".html"));
      expect(htmlFiles).toEqual([sourceName]); // no second HTML copy
      expect(afterEntries).toContain(sourceName.replace(/\.html$/i, ".design-link.json"));

      const raw = await fs.readFile(sourceAbs, "utf8");
      expect(raw.startsWith("---")).toBe(false);
      expect(raw).not.toContain("note_type:");
      expect(raw).toBe(page.body);
    });
  });

  it("stores the key-note flag on the design-link sidecar without wrapping the HTML", async () => {
    await withPortableLinkFixture(async ({ sectionAbs }) => {
      const sourceName = "key-note-design.html";
      const sourceAbs = path.join(sectionAbs, sourceName);
      await fs.writeFile(
        sourceAbs,
        "<!doctype html><html><head><title>Linked gem</title></head><body>Artifact</body></html>",
        "utf8"
      );

      const page = await linkDesignPage({ sourcePath: sourceAbs });
      const marked = await setPageKeyNote({ path: page.path, keyNote: true });
      expect(marked.designLinked).toBe(true);
      expect(marked.metadata.key_note).toBe(true);

      const html = await fs.readFile(sourceAbs, "utf8");
      expect(html.startsWith("---")).toBe(false);
      expect(html).not.toContain("key_note");
      expect(html).toContain("Artifact");

      const sidecarRaw = await fs.readFile(sourceAbs.replace(/\.html$/i, ".design-link.json"), "utf8");
      const sidecar = JSON.parse(sidecarRaw) as { key_note?: boolean };
      expect(sidecar.key_note).toBe(true);

      const tree = await readVaultTree({ skipCache: true });
      const notebook = tree.tree.find((entry) => entry.path === page.path.split("/")[0]);
      const section = notebook?.sections.find((entry) => entry.name === "Concepts");
      expect(section?.pages.find((entry) => entry.path === page.path)?.keyNote).toBe(true);

      const unmarked = await setPageKeyNote({ path: page.path, keyNote: false });
      expect(unmarked.metadata.key_note).toBeUndefined();
      const clearedSidecar = JSON.parse(
        await fs.readFile(sourceAbs.replace(/\.html$/i, ".design-link.json"), "utf8")
      ) as { key_note?: boolean };
      expect(clearedSidecar.key_note).toBeUndefined();
    });
  });

  it("replaces an empty design stub when linking from inside the design page", async () => {
    await withPortableLinkFixture(async ({ notebookPath, sectionAbs, sectionRel }) => {
      const sourceName = "existing-design.html";
      const sourceAbs = path.join(sectionAbs, sourceName);
      await fs.writeFile(
        sourceAbs,
        "<!doctype html><html><head><title>Existing design</title></head><body>Linked</body></html>",
        "utf8"
      );
      const placeholder = await createPage({
        notebookPath,
        sectionPath: sectionRel,
        title: "Main Page",
        noteType: "design",
      });

      const linked = await linkDesignPage({
        sourcePath: sourceAbs,
        replacePath: placeholder.path,
      });

      expect(linked.path).toBe(`${sectionRel}/${sourceName}`);
      await expect(fs.stat(path.join(sectionAbs, "main-page.html"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const htmlFiles = (await fs.readdir(sectionAbs)).filter((name) =>
        name.toLowerCase().endsWith(".html")
      );
      expect(htmlFiles).toEqual([sourceName]);

      const tree = await readVaultTree({ skipCache: true });
      const section = tree.tree
        .find((notebook) => notebook.path === notebookPath)
        ?.sections.find((entry) => entry.path === sectionRel);
      expect(section?.pages.map((page) => page.title)).toEqual(["Existing design"]);
    });
  });

  it("accepts ui_render on a linked SAFE design and keeps the HTML free of frontmatter", async () => {
    await withPortableLinkFixture(async ({ sectionAbs }) => {
      const sourceAbs = path.join(sectionAbs, "Safe Switchgears Website (offline).html");
      await fs.copyFile(SAFE_FIXTURE, sourceAbs);
      const page = await linkDesignPage({ sourcePath: sourceAbs });
      expect(page.title).toMatch(/Safe Switchgears/i);

      renderUiToPng.mockClear();
      const desktop = await executeVaultTool("ui_render", { path: page.path, viewport: "desktop" });
      const mobile = await executeVaultTool("ui_render", { path: page.path, viewport: "mobile" });
      expect(desktop.ok).toBe(true);
      expect(mobile.ok).toBe(true);
      expect(renderUiToPng).toHaveBeenCalled();
      if (!desktop.ok || !mobile.ok) {
        throw new Error("ui_render failed unexpectedly");
      }
      const desktopData = desktop.result.data as { bytes: number; width: number };
      const mobileData = mobile.result.data as { bytes: number; width: number };
      expect(desktopData.bytes).toBeGreaterThan(0);
      expect(mobileData.bytes).toBeGreaterThan(0);
      expect(desktopData.width).toBe(2560);
      expect(mobileData.width).toBe(780);

      const raw = await fs.readFile(sourceAbs, "utf8");
      expect(raw.startsWith("---")).toBe(false);
      expect(raw).toContain("Safe Switchgears");
    });
  });

  it("rejects paths outside registered portable roots and traversal escapes", async () => {
    await withPortableLinkFixture(async ({ targetRepo }) => {
      const outside = path.join(os.tmpdir(), `outside-design-${Date.now()}.html`);
      await fs.writeFile(outside, "<html><title>Outside</title></html>", "utf8");
      try {
        await expect(linkDesignPage({ sourcePath: outside })).rejects.toMatchObject({
          code: "INVALID_PATH",
        } satisfies Partial<VaultError>);

        await expect(
          resolveDesignLinkTarget(path.join(targetRepo, "..", "escape.html"))
        ).rejects.toMatchObject({ code: "INVALID_PATH" } satisfies Partial<VaultError>);
      } finally {
        await fs.rm(outside, { force: true });
      }
    });
  });

  it("persists Source edits verbatim to the linked HTML and keeps ink in the annotations sidecar", async () => {
    await withPortableLinkFixture(async ({ sectionAbs }) => {
      const sourceAbs = path.join(sectionAbs, "hero.html");
      const original =
        "<!doctype html><html><head><title>Hero</title></head><body><h1>Hero</h1></body></html>";
      await fs.writeFile(sourceAbs, original, "utf8");

      const page = await linkDesignPage({ sourcePath: sourceAbs });
      const edited =
        "<!doctype html><html><head><title>Hero</title></head><body><h1>Hero edited</h1><!-- SN-168 --></body></html>";
      const saved = await savePage({ path: page.path, title: page.title, body: edited });
      expect(saved.designLinked).toBe(true);
      expect(saved.body).toBe(edited);

      const onDisk = await fs.readFile(sourceAbs, "utf8");
      expect(onDisk).toBe(edited);
      expect(onDisk.startsWith("---")).toBe(false);

      await saveAnnotationsScene(page.path, { shapes: [{ id: "stroke-1" }] });
      const ink = await readAnnotationsScene(page.path);
      expect(ink.scene).toEqual({ shapes: [{ id: "stroke-1" }] });

      const stillHtml = await fs.readFile(sourceAbs, "utf8");
      expect(stillHtml).toBe(edited);
      expect(stillHtml).not.toContain("stroke-1");

      const sidecar = sourceAbs.replace(/\.html$/i, ".annotations.json");
      const sidecarRaw = await fs.readFile(sidecar, "utf8");
      expect(sidecarRaw).toContain("stroke-1");
    });
  });

  it("surfaces missing-source after the HTML is removed and supports relink without copying", async () => {
    await withPortableLinkFixture(async ({ sectionAbs }) => {
      const firstAbs = path.join(sectionAbs, "first.html");
      const secondAbs = path.join(sectionAbs, "second.html");
      await fs.writeFile(firstAbs, "<html><title>First</title><body>One</body></html>", "utf8");
      await fs.writeFile(secondAbs, "<html><title>Second</title><body>Two</body></html>", "utf8");

      const linked = await linkDesignPage({ sourcePath: firstAbs });
      await setPageKeyNote({ path: linked.path, keyNote: true });
      await fs.rm(firstAbs);

      const missing = await readPage(linked.path);
      expect(missing.designLinked).toBe(true);
      expect(missing.sourceMissing).toBe(true);

      const tree = await readVaultTree({ skipCache: true });
      const notebook = tree.tree.find((entry) => entry.path === linked.path.split("/")[0]);
      const section = notebook?.sections.find((entry) => entry.name === "Concepts");
      const summary = section?.pages.find((entry) => entry.path === linked.path);
      expect(summary?.sourceMissing).toBe(true);
      expect(summary?.noteType).toBe("design");

      const relinked = await relinkDesignPage({ path: linked.path, sourcePath: secondAbs });
      expect(relinked.path.endsWith("/second.html")).toBe(true);
      expect(relinked.sourceMissing).toBeFalsy();
      expect(relinked.body).toContain("Two");
      expect(relinked.metadata.key_note).toBe(true);
      const relinkedSidecar = JSON.parse(
        await fs.readFile(secondAbs.replace(/\.html$/i, ".design-link.json"), "utf8")
      ) as { key_note?: boolean };
      expect(relinkedSidecar.key_note).toBe(true);

      const htmlCount = (await fs.readdir(sectionAbs)).filter((name) =>
        name.toLowerCase().endsWith(".html")
      ).length;
      expect(htmlCount).toBe(1); // first removed by test; second remains; no extra copy
    });
  });

  it("delete/unlink removes link metadata but leaves the ordinary HTML on disk", async () => {
    await withPortableLinkFixture(async ({ sectionAbs }) => {
      const sourceAbs = path.join(sectionAbs, "keep-me.html");
      await fs.writeFile(sourceAbs, "<html><title>Keep</title><body>Stay</body></html>", "utf8");
      const page = await linkDesignPage({ sourcePath: sourceAbs });
      await deletePage(page.path);

      const exists = await fs.stat(sourceAbs).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      const linkExists = await fs
        .stat(sourceAbs.replace(/\.html$/i, ".design-link.json"))
        .then(() => true)
        .catch(() => false);
      expect(linkExists).toBe(false);

      // Re-link then unlink via the dedicated API.
      const again = await linkDesignPage({ sourcePath: sourceAbs });
      await unlinkDesignPage(again.path);
      const stillThere = await fs.stat(sourceAbs).then(() => true).catch(() => false);
      expect(stillThere).toBe(true);
    });
  });
});
