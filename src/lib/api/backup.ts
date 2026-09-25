import type { BackupConfig, BackupIntervalHours, BackupSnapshot } from "@/server/vault/backup";
import { vaultWriteFetch } from "@/lib/connection-status";

export interface BackupSettingsResponse {
  config: BackupConfig;
  snapshots: BackupSnapshot[];
  backupDirValid: boolean;
  backupDirError: string | null;
  intervalOptions: { hours: BackupIntervalHours; label: string }[];
}

export async function fetchBackupSettings(): Promise<BackupSettingsResponse> {
  const response = await fetch("/api/backup", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load backup settings.");
  }
  return response.json() as Promise<BackupSettingsResponse>;
}

export async function saveBackupSettings(input: Partial<BackupConfig>): Promise<BackupSettingsResponse> {
  const response = await vaultWriteFetch("/api/backup", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await response.json()) as BackupSettingsResponse & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Failed to save backup settings.");
  }
  return data;
}

export async function runVaultBackupNow() {
  const response = await vaultWriteFetch("/api/backup/run", { method: "POST" });
  const data = (await response.json()) as { error?: string; snapshot?: BackupSnapshot };
  if (!response.ok) {
    throw new Error(data.error ?? "Backup failed.");
  }
  return data;
}

export async function restoreVaultSnapshot(filename: string) {
  const response = await vaultWriteFetch("/api/backup/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  const data = (await response.json()) as { error?: string; restoredPaths?: number };
  if (!response.ok) {
    throw new Error(data.error ?? "Restore failed.");
  }
  return data;
}

export function formatBackupBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatBackupDate(iso: string) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return iso;
  }
  return new Date(parsed).toLocaleString();
}
