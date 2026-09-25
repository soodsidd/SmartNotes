jest.mock("@/server/jupyter/runtime", () => ({
  stopSession: jest.fn(),
}));

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPage,
  deletePage,
  movePage,
  readVaultTree,
  renamePage,
} from "@/server/vault/pages";
import { JUPYTER_NOTEBOOK_FILE_NAME } from "@/server/vault/page-format";
import { stopSession } from "@/server/jupyter/runtime";

const mockedStopSession = jest.mocked(stopSession);

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-jupyter-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Other"), { recursive: true });
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

function stat(target: string) {
  return fs.stat(target).then(
    (s) => s,
    () => null
  );
}

describe("jupyter note vault handling (SN-101)", () => {
  beforeEach(() => {
    mockedStopSession.mockClear();
    mockedStopSession.mockResolvedValue({ stopped: true });
  });

  it("creates a .jupyter working folder with a valid seed notebook", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({
        sectionPath: "Notebook/Section",
        title: "Analysis",
        noteType: "jupyter",
      });

      // Page stub carries the jupyter note_type.
      expect(page.metadata.note_type).toBe("jupyter");
      const stubPath = path.join(vaultRoot, page.path);
      expect(await stat(stubPath)).not.toBeNull();

      // Sibling working directory + seed notebook exist.
      const folder = path.join(vaultRoot, page.path.replace(/\.html$/i, ".jupyter"));
      const folderStat = await stat(folder);
      expect(folderStat?.isDirectory()).toBe(true);

      const notebookPath = path.join(folder, JUPYTER_NOTEBOOK_FILE_NAME);
      const raw = await fs.readFile(notebookPath, "utf8");
      const parsed = JSON.parse(raw) as { nbformat?: number; cells?: unknown[] };
      expect(parsed.nbformat).toBe(4);
      expect(Array.isArray(parsed.cells)).toBe(true);
    });
  });

  it("reports the jupyter note type in the vault tree", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({
        sectionPath: "Notebook/Section",
        title: "Tree Notebook",
        noteType: "jupyter",
      });

      const { tree } = await readVaultTree({ skipCache: true });
      const summaries = tree.flatMap((n) => n.sections).flatMap((s) => s.pages);
      const summary = summaries.find((p) => p.path === page.path);
      expect(summary?.noteType).toBe("jupyter");
    });
  });

  it("relocates the .jupyter folder when the note is renamed", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({
        sectionPath: "Notebook/Section",
        title: "Before Rename",
        noteType: "jupyter",
      });
      const oldFolder = path.join(vaultRoot, page.path.replace(/\.html$/i, ".jupyter"));
      await fs.writeFile(path.join(oldFolder, "helper.py"), "VALUE = 42\n", "utf8");
      const notebookPath = path.join(oldFolder, JUPYTER_NOTEBOOK_FILE_NAME);
      await fs.writeFile(
        notebookPath,
        JSON.stringify({ cells: [{ cell_type: "code", source: ["VALUE\\n"] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }),
        "utf8"
      );

      const renamed = await renamePage(page.path, "After Rename");
      const newFolder = path.join(vaultRoot, renamed.path.replace(/\.html$/i, ".jupyter"));
      const reloaded = await readVaultTree({ skipCache: true });
      const renamedSummary = reloaded.tree
        .flatMap((notebook) => notebook.sections)
        .flatMap((section) => section.pages)
        .find((candidate) => candidate.path === renamed.path);

      expect(mockedStopSession).toHaveBeenCalledWith(page.path);
      expect(await stat(oldFolder)).toBeNull();
      expect((await stat(newFolder))?.isDirectory()).toBe(true);
      expect(renamedSummary?.noteType).toBe("jupyter");
      // Sibling project file travels with the folder.
      const helper = await fs.readFile(path.join(newFolder, "helper.py"), "utf8");
      expect(helper).toContain("VALUE = 42");
      const notebook = await fs.readFile(path.join(newFolder, JUPYTER_NOTEBOOK_FILE_NAME), "utf8");
      expect(notebook).toContain("VALUE");
    });
  });

  it("creates root-level Jupyter notes as notebook pages, not section pages", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({
        notebookPath: "Notebook",
        title: "Root Analysis",
        noteType: "jupyter",
      });

      expect(page.path).toBe("Notebook/root-analysis.html");
      expect(page.metadata.note_type).toBe("jupyter");
      expect(page.metadata.parent_id).toBeUndefined();

      const folder = path.join(vaultRoot, "Notebook", "root-analysis.jupyter");
      expect((await stat(folder))?.isDirectory()).toBe(true);
      await expect(fs.readFile(path.join(folder, JUPYTER_NOTEBOOK_FILE_NAME), "utf8")).resolves.toContain('"nbformat": 4');

      const { tree } = await readVaultTree({ skipCache: true });
      const notebook = tree.find((entry) => entry.path === "Notebook");
      expect(notebook?.pages.map((candidate) => candidate.path)).toContain(page.path);
      expect(notebook?.sections.flatMap((section) => section.pages.map((candidate) => candidate.path))).not.toContain(page.path);
    });
  });

  it("does not leave an orphaned Jupyter page when rename cannot move the working folder", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({
        sectionPath: "Notebook/Section",
        title: "Before Rename",
        noteType: "jupyter",
      });
      const oldFolder = path.join(vaultRoot, page.path.replace(/\.html$/i, ".jupyter"));
      const nextPagePath = path.join(vaultRoot, "Notebook", "Section", "after-rename.html");
      const collidingFolder = path.join(vaultRoot, "Notebook", "Section", "after-rename.jupyter");
      await fs.mkdir(collidingFolder, { recursive: true });

      await expect(renamePage(page.path, "After Rename")).rejects.toThrow("destination notebook folder already exists");

      expect(await stat(nextPagePath)).toBeNull();
      expect((await stat(oldFolder))?.isDirectory()).toBe(true);
      await expect(fs.readFile(path.join(oldFolder, JUPYTER_NOTEBOOK_FILE_NAME), "utf8")).resolves.toContain('"nbformat": 4');

      const { tree } = await readVaultTree({ skipCache: true });
      const pages = tree.flatMap((notebook) => notebook.sections).flatMap((section) => section.pages);
      expect(pages.some((candidate) => candidate.path === page.path)).toBe(true);
      expect(pages.some((candidate) => candidate.path === "Notebook/Section/after-rename.html")).toBe(false);
    });
  });

  it("creates nested Jupyter notes with parent metadata and launchable working folders", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const parent = await createPage({
        sectionPath: "Notebook/Section",
        title: "Parent",
      });
      const child = await createPage({
        sectionPath: "Notebook/Section",
        title: "Nested Notebook",
        noteType: "jupyter",
        parentId: parent.path,
      });

      expect(child.metadata.note_type).toBe("jupyter");
      expect(child.metadata.parent_id).toBe(parent.path);

      const folder = path.join(vaultRoot, child.path.replace(/\.html$/i, ".jupyter"));
      expect((await stat(folder))?.isDirectory()).toBe(true);
      await expect(fs.readFile(path.join(folder, JUPYTER_NOTEBOOK_FILE_NAME), "utf8")).resolves.toContain('"nbformat": 4');

      const { tree } = await readVaultTree({ skipCache: true });
      const summary = tree
        .flatMap((notebook) => notebook.sections)
        .flatMap((section) => section.pages)
        .find((candidate) => candidate.path === child.path);
      expect(summary).toMatchObject({
        parentId: parent.path,
        noteType: "jupyter",
      });
    });
  });

  it("creates child Jupyter notes under root pages in the notebook root", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const parent = await createPage({
        notebookPath: "Notebook",
        title: "Root Parent",
      });
      const child = await createPage({
        notebookPath: "Notebook",
        title: "Root Child Notebook",
        noteType: "jupyter",
        parentId: parent.path,
      });

      expect(child.path).toBe("Notebook/root-child-notebook.html");
      expect(child.metadata.parent_id).toBe(parent.path);
      expect(child.metadata.note_type).toBe("jupyter");
      await expect(
        fs.readFile(path.join(vaultRoot, "Notebook", "root-child-notebook.jupyter", JUPYTER_NOTEBOOK_FILE_NAME), "utf8")
      ).resolves.toContain('"nbformat": 4');

      const { tree } = await readVaultTree({ skipCache: true });
      const notebook = tree.find((entry) => entry.path === "Notebook");
      const summary = notebook?.pages.find((candidate) => candidate.path === child.path);
      expect(summary).toMatchObject({
        parentId: parent.path,
        noteType: "jupyter",
      });
    });
  });

  it("relocates the .jupyter folder when the note is moved between sections", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({
        sectionPath: "Notebook/Section",
        title: "Movable",
        noteType: "jupyter",
      });
      const oldFolder = path.join(vaultRoot, page.path.replace(/\.html$/i, ".jupyter"));

      const moved = await movePage(page.path, "Notebook/Other");
      const newFolder = path.join(vaultRoot, moved.path.replace(/\.html$/i, ".jupyter"));

      expect(mockedStopSession).toHaveBeenCalledWith(page.path);
      expect(await stat(oldFolder)).toBeNull();
      expect((await stat(newFolder))?.isDirectory()).toBe(true);
    });
  });

  it("removes the .jupyter folder when the note is deleted", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({
        sectionPath: "Notebook/Section",
        title: "Disposable",
        noteType: "jupyter",
      });
      const folder = path.join(vaultRoot, page.path.replace(/\.html$/i, ".jupyter"));
      expect((await stat(folder))?.isDirectory()).toBe(true);

      await deletePage(page.path);
      expect(mockedStopSession).toHaveBeenCalledWith(page.path);
      expect(await stat(folder)).toBeNull();
    });
  });

  it("does not create a .jupyter folder for a plain text page", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const page = await createPage({
        sectionPath: "Notebook/Section",
        title: "Just Text",
      });
      expect(page.metadata.note_type).toBeUndefined();
      const folder = path.join(vaultRoot, page.path.replace(/\.html$/i, ".jupyter"));
      expect(await stat(folder)).toBeNull();
      await deletePage(page.path);
      expect(mockedStopSession).not.toHaveBeenCalled();
    });
  });
});
