import path from "node:path";
import { NextResponse } from "next/server";
import { getAppStateDir } from "@/server/app-state";
import {
  isBackupArchiveName,
  loadBackupConfig,
  restoreVaultBackup,
  validateBackupDirectory,
} from "@/server/vault/backup";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { filename?: string };
    const filename = String(body.filename ?? "").trim();

    if (!filename || !isBackupArchiveName(filename)) {
      return NextResponse.json({ error: "A valid backup filename is required." }, { status: 400 });
    }

    const stateDir = getAppStateDir();
    const config = loadBackupConfig(stateDir);
    const dirCheck = validateBackupDirectory(config.backupDir);
    if (!dirCheck.ok) {
      return NextResponse.json({ error: dirCheck.error }, { status: 400 });
    }

    const archivePath = path.join(path.resolve(config.backupDir), path.basename(filename));
    const result = await restoreVaultBackup({ archivePath });

    return NextResponse.json({
      ok: true,
      restoredPaths: result.restoredPaths,
      filename,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
