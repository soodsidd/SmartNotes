import AdmZip from "adm-zip";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getVaultRoot } from "./config";
import { emitVaultSideEffects } from "./socket-events";

export const BACKUP_FILENAME_PREFIX = "smart-notes-vault-";
export const BACKUP_FILENAME_SUFFIX = ".zip";
export const BACKUP_SETTINGS_FILENAME = "vault-backup-settings.json";
export const MANIFEST_FILENAME = "manifest.json";

export const BACKUP_INTERVAL_OPTIONS = [
  { hours: 1, label: "Every hour" },
  { hours: 6, label: "Every 6 hours" },
  { hours: 12, label: "Every 12 hours" },
  { hours: 24, label: "Daily" },
  { hours: 168, label: "Weekly" },
] as const;

export type BackupIntervalHours = (typeof BACKUP_INTERVAL_OPTIONS)[number]["hours"];

export interface BackupManifest {
  version: 1;
  createdAt: string;
  paths: string[];
}

export interface BackupSnapshot {
  filename: string;
  createdAt: string;
  sizeBytes: number;
}

export interface BackupConfig {
  backupDir: string;
  intervalHours: BackupIntervalHours;
  retentionCount: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: "success" | "error" | null;
  lastRunError: string | null;
  lastSnapshotFile: string | null;
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  backupDir: "",
  intervalHours: 24,
  retentionCount: 7,
  enabled: false,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
  lastSnapshotFile: null,
};

const VALID_INTERVAL_HOURS = new Set<number>(BACKUP_INTERVAL_OPTIONS.map((option) => option.hours));

function normalizeBackupConfig(input: Partial<BackupConfig> | null | undefined): BackupConfig {
  const intervalHours = Number(input?.intervalHours ?? DEFAULT_BACKUP_CONFIG.intervalHours);
  const retentionCount = Math.max(1, Math.min(100, Math.round(Number(input?.retentionCount ?? DEFAULT_BACKUP_CONFIG.retentionCount))));

  return {
    backupDir: String(input?.backupDir ?? "").trim(),
    intervalHours: VALID_INTERVAL_HOURS.has(intervalHours)
      ? (intervalHours as BackupIntervalHours)
      : DEFAULT_BACKUP_CONFIG.intervalHours,
    retentionCount,
    enabled: Boolean(input?.enabled),
    lastRunAt: typeof input?.lastRunAt === "string" ? input.lastRunAt : null,
    lastRunStatus:
      input?.lastRunStatus === "success" || input?.lastRunStatus === "error"
        ? input.lastRunStatus
        : null,
    lastRunError: typeof input?.lastRunError === "string" ? input.lastRunError : null,
    lastSnapshotFile: typeof input?.lastSnapshotFile === "string" ? input.lastSnapshotFile : null,
  };
}

export function getBackupSettingsPath(stateDir: string) {
  return path.join(path.resolve(stateDir), BACKUP_SETTINGS_FILENAME);
}

export function loadBackupConfig(stateDir: string): BackupConfig {
  const settingsPath = getBackupSettingsPath(stateDir);
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BackupConfig>;
    return normalizeBackupConfig(parsed);
  } catch {
    return { ...DEFAULT_BACKUP_CONFIG };
  }
}

export function saveBackupConfig(stateDir: string, partial: Partial<BackupConfig>): BackupConfig {
  const current = loadBackupConfig(stateDir);
  const next = normalizeBackupConfig({ ...current, ...partial });
  const settingsPath = getBackupSettingsPath(stateDir);
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function validateBackupDirectory(backupDir: string): { ok: true } | { ok: false; error: string } {
  const resolved = backupDir.trim();
  if (!resolved) {
    return { ok: false, error: "Backup directory is required." };
  }

  const absolute = path.resolve(resolved);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return { ok: false, error: "Backup directory does not exist." };
  }

  if (!stat.isDirectory()) {
    return { ok: false, error: "Backup path must be a directory." };
  }

  const probePath = path.join(absolute, `.smart-notes-write-probe-${process.pid}`);
  try {
    fs.writeFileSync(probePath, "ok", "utf8");
    fs.unlinkSync(probePath);
    return { ok: true };
  } catch {
    return { ok: false, error: "Backup directory is not writable." };
  }
}

export function isBackupArchiveName(filename: string) {
  return (
    filename.startsWith(BACKUP_FILENAME_PREFIX) &&
    filename.endsWith(BACKUP_FILENAME_SUFFIX)
  );
}

export function backupTimestampFromFilename(filename: string) {
  const stem = filename.slice(BACKUP_FILENAME_PREFIX.length, -BACKUP_FILENAME_SUFFIX.length);
  const match = stem.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}\.\d{3}Z)$/);
  if (!match) {
    return stem;
  }
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}`;
}

export async function walkVaultRelativePaths(vaultRoot: string): Promise<string[]> {
  const paths: string[] = [];

  async function walk(currentDir: string, relativePrefix = "") {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        paths.push(relativePath.replace(/\\/g, "/"));
      }
    }
  }

  await walk(vaultRoot);
  return paths.sort();
}

export function buildBackupManifest(paths: string[], createdAt = new Date().toISOString()): BackupManifest {
  return {
    version: 1,
    createdAt,
    paths,
  };
}

export function shouldRunScheduledBackup(
  config: BackupConfig,
  now = Date.now()
): boolean {
  if (!config.enabled) {
    return false;
  }

  if (!config.lastRunAt) {
    return true;
  }

  const lastRunMs = Date.parse(config.lastRunAt);
  if (!Number.isFinite(lastRunMs)) {
    return true;
  }

  const intervalMs = config.intervalHours * 60 * 60 * 1000;
  return now - lastRunMs >= intervalMs;
}

export function msUntilNextScheduledBackup(
  config: BackupConfig,
  now = Date.now()
): number | null {
  if (!config.enabled) {
    return null;
  }

  if (!config.lastRunAt) {
    return 0;
  }

  const lastRunMs = Date.parse(config.lastRunAt);
  if (!Number.isFinite(lastRunMs)) {
    return 0;
  }

  const intervalMs = config.intervalHours * 60 * 60 * 1000;
  return Math.max(0, intervalMs - (now - lastRunMs));
}

export async function listBackupSnapshots(backupDir: string): Promise<BackupSnapshot[]> {
  const absoluteDir = path.resolve(backupDir);
  let entries: string[];
  try {
    entries = await fsp.readdir(absoluteDir);
  } catch {
    return [];
  }

  const snapshots = await Promise.all(
    entries
      .filter((entry) => isBackupArchiveName(entry))
      .map(async (filename) => {
        const absolutePath = path.join(absoluteDir, filename);
        const stat = await fsp.stat(absolutePath);
        return {
          filename,
          createdAt: backupTimestampFromFilename(filename),
          sizeBytes: stat.size,
        };
      })
  );

  return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function pruneBackupSnapshots(
  backupDir: string,
  retentionCount: number
): Promise<string[]> {
  const snapshots = await listBackupSnapshots(backupDir);
  const toDelete = snapshots.slice(retentionCount);
  const deleted: string[] = [];

  for (const snapshot of toDelete) {
    const absolutePath = path.join(path.resolve(backupDir), snapshot.filename);
    await fsp.rm(absolutePath, { force: true });
    deleted.push(snapshot.filename);
  }

  return deleted;
}

function formatBackupTimestamp(date = new Date()) {
  return date.toISOString().replace(/:/g, "-");
}

async function zipVaultToArchive(input: {
  vaultRoot: string;
  archivePath: string;
  manifest: BackupManifest;
}) {
  await fsp.mkdir(path.dirname(input.archivePath), { recursive: true });

  const zip = new AdmZip();
  zip.addFile(MANIFEST_FILENAME, Buffer.from(JSON.stringify(input.manifest, null, 2), "utf8"));

  for (const relativePath of input.manifest.paths) {
    const absolutePath = path.join(input.vaultRoot, relativePath);
    zip.addLocalFile(absolutePath, path.posix.dirname(relativePath.replace(/\\/g, "/")), path.posix.basename(relativePath));
  }

  zip.writeZip(input.archivePath);
}

async function clearDirectoryContents(dir: string) {
  const entries = await fsp.readdir(dir);
  await Promise.all(
    entries.map((entry) => fsp.rm(path.join(dir, entry), { recursive: true, force: true }))
  );
}

export async function createVaultBackup(input: {
  vaultRoot?: string;
  backupDir: string;
}): Promise<{ filename: string; absolutePath: string; manifest: BackupManifest }> {
  const vaultRoot = input.vaultRoot ?? getVaultRoot();
  const backupDir = path.resolve(input.backupDir);
  const createdAt = new Date().toISOString();
  const paths = await walkVaultRelativePaths(vaultRoot);
  const manifest = buildBackupManifest(paths, createdAt);
  const filename = `${BACKUP_FILENAME_PREFIX}${formatBackupTimestamp(new Date(createdAt))}${BACKUP_FILENAME_SUFFIX}`;
  const absolutePath = path.join(backupDir, filename);

  await zipVaultToArchive({ vaultRoot, archivePath: absolutePath, manifest });
  return { filename, absolutePath, manifest };
}

export async function restoreVaultBackup(input: {
  archivePath: string;
  vaultRoot?: string;
}): Promise<{ restoredPaths: number }> {
  const vaultRoot = input.vaultRoot ?? getVaultRoot();
  const archivePath = path.resolve(input.archivePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "smart-notes-restore-"));
  const extractDir = path.join(tempDir, "extracted");

  try {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(extractDir, true);
    const manifestRaw = await fsp.readFile(path.join(extractDir, MANIFEST_FILENAME), "utf8");
    const manifest = JSON.parse(manifestRaw) as BackupManifest;

    if (manifest.version !== 1 || !Array.isArray(manifest.paths)) {
      throw new Error("Backup archive is missing a valid manifest.");
    }

    await clearDirectoryContents(vaultRoot);

    for (const relativePath of manifest.paths) {
      const sourcePath = path.join(extractDir, relativePath);
      const destPath = path.join(vaultRoot, relativePath);
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await fsp.copyFile(sourcePath, destPath);
    }

    emitVaultSideEffects({ treeChanged: true });
    return { restoredPaths: manifest.paths.length };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

export async function runVaultBackup(stateDir: string, options?: { manual?: boolean }) {
  const config = loadBackupConfig(stateDir);
  const dirCheck = validateBackupDirectory(config.backupDir);
  if (!dirCheck.ok) {
    const message = dirCheck.error;
    saveBackupConfig(stateDir, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "error",
      lastRunError: message,
    });
    throw new Error(message);
  }

  if (!config.enabled && !options?.manual) {
    throw new Error("Scheduled backups are disabled.");
  }

  try {
    const created = await createVaultBackup({ backupDir: config.backupDir });
    const deleted = await pruneBackupSnapshots(config.backupDir, config.retentionCount);
    const saved = saveBackupConfig(stateDir, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "success",
      lastRunError: null,
      lastSnapshotFile: created.filename,
    });

    return {
      config: saved,
      snapshot: {
        filename: created.filename,
        createdAt: created.manifest.createdAt,
        sizeBytes: (await fsp.stat(created.absolutePath)).size,
      },
      manifest: created.manifest,
      deleted,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup failed.";
    saveBackupConfig(stateDir, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "error",
      lastRunError: message,
    });
    throw error;
  }
}

export const __testInternals = {
  normalizeBackupConfig,
  zipVaultToArchive,
  clearDirectoryContents,
};
