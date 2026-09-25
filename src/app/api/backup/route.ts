import { NextResponse } from "next/server";
import { getAppStateDir } from "@/server/app-state";
import {
  BACKUP_INTERVAL_OPTIONS,
  loadBackupConfig,
  listBackupSnapshots,
  saveBackupConfig,
  validateBackupDirectory,
  type BackupIntervalHours,
} from "@/server/vault/backup";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_INTERVALS = new Set<number>(BACKUP_INTERVAL_OPTIONS.map((option) => option.hours));

export async function GET() {
  const stateDir = getAppStateDir();
  const config = loadBackupConfig(stateDir);
  const dirCheck = config.backupDir ? validateBackupDirectory(config.backupDir) : { ok: false as const, error: "Backup directory is required." };
  const snapshots = dirCheck.ok ? await listBackupSnapshots(config.backupDir) : [];

  return NextResponse.json({
    config,
    snapshots,
    backupDirValid: dirCheck.ok,
    backupDirError: dirCheck.ok ? null : dirCheck.error,
    intervalOptions: BACKUP_INTERVAL_OPTIONS,
  });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      backupDir?: string;
      intervalHours?: number;
      retentionCount?: number;
      enabled?: boolean;
    };

    const stateDir = getAppStateDir();
    const current = loadBackupConfig(stateDir);
    const nextBackupDir = body.backupDir !== undefined ? String(body.backupDir).trim() : current.backupDir;
    const nextEnabled = body.enabled !== undefined ? Boolean(body.enabled) : current.enabled;

    if (nextEnabled) {
      const dirCheck = validateBackupDirectory(nextBackupDir);
      if (!dirCheck.ok) {
        return NextResponse.json({ error: dirCheck.error }, { status: 400 });
      }
    }

    const intervalHours = body.intervalHours ?? current.intervalHours;
    if (!VALID_INTERVALS.has(intervalHours)) {
      return NextResponse.json({ error: "Invalid backup interval." }, { status: 400 });
    }

    const saved = saveBackupConfig(stateDir, {
      backupDir: nextBackupDir,
      intervalHours: intervalHours as BackupIntervalHours,
      retentionCount: body.retentionCount ?? current.retentionCount,
      enabled: nextEnabled,
    });

    const dirCheck = saved.backupDir ? validateBackupDirectory(saved.backupDir) : { ok: false as const, error: "Backup directory is required." };
    const snapshots = dirCheck.ok ? await listBackupSnapshots(saved.backupDir) : [];

    return NextResponse.json({
      config: saved,
      snapshots,
      backupDirValid: dirCheck.ok,
      backupDirError: dirCheck.ok ? null : dirCheck.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
