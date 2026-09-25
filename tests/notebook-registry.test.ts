import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadNotebookRegistry,
  portableNotebookPath,
  registerPortableNotebook,
  registerPortableNotebookFromInput,
  renamePortableNotebook,
  resolvePortableNotebookRootPath,
  unregisterPortableNotebook,
} from "@/server/vault/notebook-registry";
import {
  invalidateVaultTreeCacheForTesting,
  readPage,
  readVaultTree,
  renameNotebook,
  toApiPageDocument,
} from "@/server/vault/pages";
import { resolveVaultPath } from "@/server/vault/paths";

async function withPortableFixture(
  run: (input: { vaultRoot: string; portableRoot: string; stateDir: string }) => Promise<void>
) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn77-vault-"));
  const portableRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn77-portable-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn77-state-"));

  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;

  try {
    await fs.mkdir(path.join(vaultRoot, "Primary"), { recursive: true });
    await fs.mkdir(path.join(portableRoot, "Field Notes"), { recursive: true });
    await fs.writeFile(
      path.join(portableRoot, "Field Notes", "welcome.html"),
      "---\ntitle: Welcome\n---\n<p>Portable page</p>\n",
      "utf8"
    );

    await run({ vaultRoot, portableRoot, stateDir });
  } finally {
    invalidateVaultTreeCacheForTesting();
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    if (previousState) process.env.SMART_NOTES_STATE_DIR = previousState;
    else delete process.env.SMART_NOTES_STATE_DIR;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(portableRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

describe("portable notebook registry", () => {
  it("registers a directory and exposes it in the vault tree", async () => {
    await withPortableFixture(async ({ portableRoot, stateDir }) => {
      const entry = registerPortableNotebook(portableRoot, "Project Notes", stateDir);
      expect(entry.name).toBe("Project Notes");
      expect(entry.rootPath).toBe(path.resolve(portableRoot));

      const registry = loadNotebookRegistry(stateDir);
      expect(registry.notebooks).toHaveLength(1);

      const { tree } = await readVaultTree({ skipCache: true });
      const portableNotebook = tree.find((notebook) => notebook.path === portableNotebookPath(entry.id));
      expect(portableNotebook).toBeDefined();
      expect(portableNotebook?.isPortable).toBe(true);
      expect(portableNotebook?.sections[0]?.pages[0]?.title).toBe("Welcome");
    });
  });

  it("resolves portable page paths against the registered root", async () => {
    await withPortableFixture(async ({ portableRoot, stateDir }) => {
      const entry = registerPortableNotebook(portableRoot, "Project Notes", stateDir);
      const pagePath = `${portableNotebookPath(entry.id)}/Field Notes/welcome.html`;
      const resolved = resolveVaultPath(pagePath, "page");
      expect(resolved.absolutePath).toBe(
        path.join(portableRoot, "Field Notes", "welcome.html")
      );
      expect(resolved.isPortable).toBe(true);
    });
  });

  it("renames portable notebook display names without moving files", async () => {
    await withPortableFixture(async ({ portableRoot, stateDir }) => {
      const entry = registerPortableNotebook(portableRoot, "Old Label", stateDir);
      renamePortableNotebook(entry.id, "New Label", stateDir);
      const registry = loadNotebookRegistry(stateDir);
      expect(registry.notebooks[0]?.name).toBe("New Label");
      expect(registry.notebooks[0]?.rootPath).toBe(path.resolve(portableRoot));
    });
  });

  it("preserves punctuation in portable notebook display names on rename", async () => {
    await withPortableFixture(async ({ portableRoot, stateDir }) => {
      const entry = registerPortableNotebook(portableRoot, "Old Label", stateDir);
      const notebookPath = portableNotebookPath(entry.id);
      const renamed = await renameNotebook(notebookPath, "Research: 2025");
      expect(renamed.name).toBe("Research: 2025");
      expect(loadNotebookRegistry(stateDir).notebooks[0]?.name).toBe("Research: 2025");
    });
  });

  it("returns portable notebook display names in page API documents", async () => {
    await withPortableFixture(async ({ portableRoot, stateDir }) => {
      const entry = registerPortableNotebook(portableRoot, "Project Notes", stateDir);
      const pagePath = `${portableNotebookPath(entry.id)}/Field Notes/welcome.html`;
      const page = await readPage(pagePath);
      const apiPage = toApiPageDocument(page);
      expect(apiPage.notebookName).toBe("Project Notes");
      expect(apiPage.notebookPath).toBe(portableNotebookPath(entry.id));
    });
  });

  it("unregisters a portable notebook without deleting files", async () => {
    await withPortableFixture(async ({ portableRoot, stateDir }) => {
      const entry = registerPortableNotebook(portableRoot, "Project Notes", stateDir);
      unregisterPortableNotebook(entry.id, stateDir);
      expect(loadNotebookRegistry(stateDir).notebooks).toHaveLength(0);
      await expect(fs.stat(path.join(portableRoot, "Field Notes", "welcome.html"))).resolves.toBeDefined();
    });
  });

  it("creates a missing notebook directory when createIfMissing is true", async () => {
    await withPortableFixture(async ({ stateDir }) => {
      const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn77-parent-"));
      const notebookDir = path.join(parentDir, "Project Notes");
      try {
        const entry = registerPortableNotebook(notebookDir, "Project Notes", stateDir, {
          createIfMissing: true,
        });
        await expect(fs.stat(notebookDir)).resolves.toBeDefined();
        expect(entry.rootPath).toBe(path.resolve(notebookDir));
      } finally {
        await fs.rm(parentDir, { recursive: true, force: true });
      }
    });
  });

  it("registers a new folder from parent path and folder name", async () => {
    await withPortableFixture(async ({ stateDir }) => {
      const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn77-parent-"));
      try {
        const entry = registerPortableNotebookFromInput(
          {
            parentPath: parentDir,
            folderName: "Field Notes",
            name: "Portable Field Notes",
          },
          stateDir
        );
        const expectedRoot = path.join(parentDir, "Field Notes");
        await expect(fs.stat(expectedRoot)).resolves.toBeDefined();
        expect(entry.rootPath).toBe(path.resolve(expectedRoot));
        expect(entry.name).toBe("Portable Field Notes");

        const resolved = resolvePortableNotebookRootPath({
          parentPath: parentDir,
          folderName: "Field Notes",
        });
        expect(resolved).toBe(path.resolve(expectedRoot));
      } finally {
        await fs.rm(parentDir, { recursive: true, force: true });
      }
    });
  });
});
