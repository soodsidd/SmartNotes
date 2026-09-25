import { NextResponse } from "next/server";
import { getAppStateDir } from "@/server/app-state";
import { loadBackupConfig, runVaultBackup, validateBackupDirectory } from "@/server/vault/backup";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  try {
    const stateDir = getAppStateDir();
    const config = loadBackupConfig(stateDir);
    const dirCheck = validateBackupDirectory(config.backupDir);
    if (!dirCheck.ok) {
      return NextResponse.json({ error: dirCheck.error }, { status: 400 });
    }

    const result = await runVaultBackup(stateDir, { manual: true });
    return NextResponse.json({
      ok: true,
      snapshot: result.snapshot,
      deleted: result.deleted,
      config: result.config,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
