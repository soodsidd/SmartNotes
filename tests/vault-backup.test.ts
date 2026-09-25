import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  BACKUP_FILENAME_PREFIX,
  BACKUP_FILENAME_SUFFIX,
  MANIFEST_FILENAME,
  buildBackupManifest,
  createVaultBackup,
  loadBackupConfig,
  msUntilNextScheduledBackup,
  pruneBackupSnapshots,
  restoreVaultBackup,
  saveBackupConfig,
  shouldRunScheduledBackup,
  validateBackupDirectory,
  walkVaultRelativePaths,
  __testInternals,
} from "@/server/vault/backup";

async function withFixture(
  run: (input: { vaultRoot: string; backupDir: string; stateDir: string }) => Promise<void>
) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn49-vault-"));
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn49-backups-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn49-state-"));

  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;

  try {
    await run({ vaultRoot, backupDir, stateDir });
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
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

async function seedVault(vaultRoot: string) {
  const sectionDir = path.join(vaultRoot, "Notebook", "Section");
  const versionsDir = path.join(sectionDir, ".versions", "note");
  await fs.mkdir(versionsDir, { recursive: true });
  await fs.writeFile(
    path.join(sectionDir, "note.html"),
    "---\ntitle: Note\ncreated: 2026-06-10T00:00:00.000Z\nupdated: 2026-06-10T00:00:00.000Z\n---\n<p>Body</p>",
    "utf8"
  );
  await fs.writeFile(path.join(sectionDir, "note.ink.json"), "{\"version\":1}", "utf8");
  await fs.writeFile(
    path.join(sectionDir, "note.annotations.json"),
    "{\"records\":[]}",
    "utf8"
  );
  await fs.writeFile(path.join(versionsDir, "index.json"), "[]", "utf8");
  await fs.mkdir(path.join(sectionDir, "note.assets"), { recursive: true });
  await fs.writeFile(path.join(sectionDir, "note.assets", "diagram.png"), "png", "utf8");
}

describe("vault backup", () => {
  it("validates backup directories", async () => {
    await withFixture(async ({ backupDir }) => {
      expect(validateBackupDirectory(backupDir)).toEqual({ ok: true });
      expect(validateBackupDirectory(path.join(backupDir, "missing"))).toMatchObject({ ok: false });
    });
  });

  it("builds a manifest that includes pages, assets, ink, annotations, and .versions", async () => {
    await withFixture(async ({ vaultRoot }) => {
      await seedVault(vaultRoot);
      const paths = await walkVaultRelativePaths(vaultRoot);
      const manifest = buildBackupManifest(paths);

      expect(manifest.paths).toEqual(
        expect.arrayContaining([
          "Notebook/Section/note.html",
          "Notebook/Section/note.assets/diagram.png",
          "Notebook/Section/note.ink.json",
          "Notebook/Section/note.annotations.json",
          "Notebook/Section/.versions/note/index.json",
        ])
      );
    });
  });

  it("creates timestamped zip archives with manifest", async () => {
    await withFixture(async ({ vaultRoot, backupDir }) => {
      await seedVault(vaultRoot);
      const created = await createVaultBackup({ vaultRoot, backupDir });

      expect(created.filename.startsWith(BACKUP_FILENAME_PREFIX)).toBe(true);
      expect(created.filename.endsWith(BACKUP_FILENAME_SUFFIX)).toBe(true);

      const extractDir = path.join(backupDir, "extracted");
      await fs.mkdir(extractDir, { recursive: true });
      new AdmZip(created.absolutePath).extractAllTo(extractDir, true);

      const manifestRaw = await fs.readFile(path.join(extractDir, MANIFEST_FILENAME), "utf8");
      const manifest = JSON.parse(manifestRaw) as { paths: string[] };
      expect(manifest.paths).toContain("Notebook/Section/note.html");
      expect(manifest.paths).toContain("Notebook/Section/.versions/note/index.json");
    });
  });

  it("prunes oldest snapshots beyond retention", async () => {
    await withFixture(async ({ backupDir }) => {
      const names = ["a.zip", "b.zip", "c.zip"].map(
        (suffix, index) => `${BACKUP_FILENAME_PREFIX}2026-06-0${index + 1}T10-00-00.000Z${BACKUP_FILENAME_SUFFIX}`
      );

      for (const name of names) {
        const absolutePath = path.join(backupDir, name);
        await fs.writeFile(absolutePath, name, "utf8");
        const timestamp = Date.parse(`2026-06-0${names.indexOf(name) + 1}T10:00:00.000Z`);
        await fs.utimes(absolutePath, timestamp / 1000, timestamp / 1000);
      }

      const deleted = await pruneBackupSnapshots(backupDir, 2);
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toContain("2026-06-01");
      const remaining = await fs.readdir(backupDir);
      expect(remaining.filter((entry) => entry.endsWith(".zip"))).toHaveLength(2);
    });
  });

  it("decides when scheduled backups should run", () => {
    const base = {
      backupDir: "/tmp/backups",
      intervalHours: 6 as const,
      retentionCount: 5,
      enabled: true,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
      lastSnapshotFile: null,
    };

    expect(shouldRunScheduledBackup({ ...base, enabled: false })).toBe(false);
    expect(shouldRunScheduledBackup(base)).toBe(true);
    expect(
      shouldRunScheduledBackup({
        ...base,
        lastRunAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      })
    ).toBe(true);
    expect(
      shouldRunScheduledBackup({
        ...base,
        lastRunAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      })
    ).toBe(false);
    expect(
      msUntilNextScheduledBackup({
        ...base,
        lastRunAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      })
    ).toBeGreaterThan(0);
  });

  it("persists backup settings across reloads", async () => {
    await withFixture(async ({ stateDir, backupDir }) => {
      saveBackupConfig(stateDir, {
        backupDir,
        intervalHours: 12,
        retentionCount: 4,
        enabled: true,
      });

      const loaded = loadBackupConfig(stateDir);
      expect(loaded.backupDir).toBe(backupDir);
      expect(loaded.intervalHours).toBe(12);
      expect(loaded.retentionCount).toBe(4);
      expect(loaded.enabled).toBe(true);
    });
  });

  it("restores vault contents from a backup archive", async () => {
    await withFixture(async ({ vaultRoot, backupDir }) => {
      await seedVault(vaultRoot);
      const created = await createVaultBackup({ vaultRoot, backupDir });

      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "note.html"), "changed", "utf8");
      await restoreVaultBackup({ archivePath: created.absolutePath, vaultRoot });

      const restored = await fs.readFile(path.join(vaultRoot, "Notebook", "Section", "note.html"), "utf8");
      expect(restored).toContain("Body");
      expect(await fs.readFile(path.join(vaultRoot, "Notebook", "Section", "note.ink.json"), "utf8")).toBe(
        "{\"version\":1}"
      );
    });
  });

  it("clamps invalid retention values", () => {
    const normalized = __testInternals.normalizeBackupConfig({ retentionCount: 0 });
    expect(normalized.retentionCount).toBe(1);
  });
});
