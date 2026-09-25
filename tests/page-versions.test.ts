import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  computeContentHash,
  listPageVersions,
  MAX_PAGE_VERSIONS,
  readPageVersionContent,
  restorePageVersion,
  snapshotInkContent,
  snapshotPageContent,
  __testInternals,
} from "@/server/vault/versions";
import {
  invalidateVaultTreeCacheForTesting,
  readPage,
  savePage,
} from "@/server/vault/pages";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-versions-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-versions-state-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
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
    invalidateVaultTreeCacheForTesting();
    delete (global as Record<string, unknown>)["_smartNotesIo"];
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

const PAGE_PATH = "Notebook/Section/seed.html";

async function writeSeedPage(vaultRoot: string, body: string) {
  await fs.writeFile(
    path.join(vaultRoot, "Notebook", "Section", "seed.html"),
    `---
title: Seed
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
---
${body}`,
    "utf8"
  );
}

describe("page versions", () => {
  it("computes a stable short hash", () => {
    expect(computeContentHash("hello")).toHaveLength(6);
    expect(computeContentHash("hello")).toBe(computeContentHash("hello"));
    expect(computeContentHash("hello")).not.toBe(computeContentHash("world"));
  });

  it("stores versions under section .versions/<page-stem>/", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await writeSeedPage(vaultRoot, "Body v1");
      await snapshotPageContent(PAGE_PATH);

      const versionsDir = path.join(vaultRoot, "Notebook", "Section", ".versions", "seed");
      const stat = await fs.stat(versionsDir);
      expect(stat.isDirectory()).toBe(true);
      await expect(fs.readFile(path.join(versionsDir, "index.json"), "utf8")).resolves.toContain("\"hash\"");
    });
  });

  it("skips snapshot when content hash is unchanged", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await writeSeedPage(vaultRoot, "Stable body");
      const first = await snapshotPageContent(PAGE_PATH);
      const second = await snapshotPageContent(PAGE_PATH);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(await listPageVersions(PAGE_PATH)).toHaveLength(1);
    });
  });

  it("enforces the max version cap in the vault", async () => {
    await withVaultFixture(async (vaultRoot) => {
      for (let index = 0; index < MAX_PAGE_VERSIONS + 2; index += 1) {
        await writeSeedPage(vaultRoot, `Body ${index}`);
        await snapshotPageContent(PAGE_PATH);
      }

      const versions = await listPageVersions(PAGE_PATH);
      expect(versions).toHaveLength(MAX_PAGE_VERSIONS);

      const versionsDir = path.join(vaultRoot, "Notebook", "Section", ".versions", "seed");
      const files = await fs.readdir(versionsDir);
      const snapshotFiles = files.filter((file) => file.endsWith(".html"));
      expect(snapshotFiles).toHaveLength(MAX_PAGE_VERSIONS);
    });
  });

  it("restores a version after auto-snapshotting current content", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await writeSeedPage(vaultRoot, "Original");
      await snapshotPageContent(PAGE_PATH);
      await savePage({ path: PAGE_PATH, title: "Seed", body: "Changed" });

      const versions = await listPageVersions(PAGE_PATH);
      const target = versions[versions.length - 1];
      await restorePageVersion(PAGE_PATH, target.id, "text");

      const page = await readPage(PAGE_PATH);
      expect(page.body).toBe("Original");

      const afterRestore = await listPageVersions(PAGE_PATH);
      expect(afterRestore.length).toBeGreaterThanOrEqual(2);
      const restoredSnapshot = await readPageVersionContent(PAGE_PATH, target.id, "page");
      expect(restoredSnapshot).toContain("Original");
    });
  });

  it("versions ink sidecars under .versions/<page-stem>.ink/", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await writeSeedPage(vaultRoot, "");
      const sidecar = JSON.stringify({ scene: { strokes: 1 }, inkMeta: { backgroundMode: "grid" } });
      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "seed.ink.json"), sidecar, "utf8");

      await snapshotInkContent(PAGE_PATH);

      const versionsDir = path.join(vaultRoot, "Notebook", "Section", ".versions", "seed.ink");
      const files = await fs.readdir(versionsDir);
      expect(files.some((file) => file.endsWith(".json"))).toBe(true);
    });
  });

  it("does not appear in vault tree reads", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await writeSeedPage(vaultRoot, "Listed page");
      await snapshotPageContent(PAGE_PATH);

      invalidateVaultTreeCacheForTesting();
      const { readVaultTree } = await import("@/server/vault/pages");
      const { tree } = await readVaultTree();
      const pages = tree.flatMap((notebook) => notebook.sections.flatMap((section) => section.pages));
      expect(pages.map((page) => page.path)).toEqual([PAGE_PATH]);
    });
  });
});

describe("page versions internals", () => {
  it("formats version timestamps without colons", () => {
    const formatted = __testInternals.formatVersionTimestamp(new Date("2026-06-09T12:00:00.000Z"));
    expect(formatted).toBe("2026-06-09T12-00-00.000Z");
  });
});
