"use client";

import * as React from "react";
import { Archive, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchBackupSettings,
  formatBackupBytes,
  formatBackupDate,
  restoreVaultSnapshot,
  runVaultBackupNow,
  saveBackupSettings,
} from "@/lib/api/backup";
import type { BackupConfig, BackupSnapshot } from "@/server/vault/backup";
import { cn } from "@/lib/utils";

export function BackupSettingsPanel({
  onVaultRestored,
}: {
  onVaultRestored?: () => void | Promise<void>;
}) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [runningBackup, setRunningBackup] = React.useState(false);
  const [restoringFilename, setRestoringFilename] = React.useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = React.useState<BackupSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [config, setConfig] = React.useState<BackupConfig | null>(null);
  const [snapshots, setSnapshots] = React.useState<BackupSnapshot[]>([]);
  const [backupDirValid, setBackupDirValid] = React.useState(false);
  const [backupDirError, setBackupDirError] = React.useState<string | null>(null);
  const [intervalOptions, setIntervalOptions] = React.useState<{ hours: number; label: string }[]>([]);

  const [draftDir, setDraftDir] = React.useState("");
  const [draftIntervalHours, setDraftIntervalHours] = React.useState(24);
  const [draftRetention, setDraftRetention] = React.useState(7);
  const [draftEnabled, setDraftEnabled] = React.useState(false);

  const loadSettings = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBackupSettings();
      setConfig(data.config);
      setSnapshots(data.snapshots);
      setBackupDirValid(data.backupDirValid);
      setBackupDirError(data.backupDirError);
      setIntervalOptions(data.intervalOptions);
      setDraftDir(data.config.backupDir);
      setDraftIntervalHours(data.config.intervalHours);
      setDraftRetention(data.config.retentionCount);
      setDraftEnabled(data.config.enabled);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load backup settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const applySettings = React.useCallback(async (partial: Partial<BackupConfig>) => {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    try {
      const data = await saveBackupSettings(partial);
      setConfig(data.config);
      setSnapshots(data.snapshots);
      setBackupDirValid(data.backupDirValid);
      setBackupDirError(data.backupDirError);
      setDraftDir(data.config.backupDir);
      setDraftIntervalHours(data.config.intervalHours);
      setDraftRetention(data.config.retentionCount);
      setDraftEnabled(data.config.enabled);
      setStatusMessage("Backup settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save backup settings.");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleSave = React.useCallback(async () => {
    await applySettings({
      backupDir: draftDir,
      intervalHours: draftIntervalHours as BackupConfig["intervalHours"],
      retentionCount: draftRetention,
      enabled: draftEnabled,
    });
  }, [applySettings, draftDir, draftEnabled, draftIntervalHours, draftRetention]);

  const handleRunBackup = React.useCallback(async () => {
    setRunningBackup(true);
    setError(null);
    setStatusMessage(null);
    try {
      if (draftDir.trim() !== (config?.backupDir ?? "").trim()) {
        await applySettings({ backupDir: draftDir });
      }
      await runVaultBackupNow();
      await loadSettings();
      setStatusMessage("Backup created.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Backup failed.");
      await loadSettings();
    } finally {
      setRunningBackup(false);
    }
  }, [applySettings, config?.backupDir, draftDir, loadSettings]);

  const handleConfirmRestore = React.useCallback(async () => {
    if (!confirmRestore) {
      return;
    }

    const filename = confirmRestore.filename;
    setRestoringFilename(filename);
    setError(null);
    setStatusMessage(null);

    try {
      await restoreVaultSnapshot(filename);
      setConfirmRestore(null);
      setStatusMessage("Vault restored from backup.");
      await onVaultRestored?.();
      await loadSettings();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Restore failed.");
    } finally {
      setRestoringFilename(null);
    }
  }, [confirmRestore, loadSettings, onVaultRestored]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" data-testid="backup-settings-loading">
        <Loader2 className="size-4 animate-spin" />
        Loading backup settings…
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="backup-settings-panel">
      <section>
        <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Backup directory</p>
        <Input
          value={draftDir}
          onChange={(event) => setDraftDir(event.target.value)}
          placeholder="C:\Backups\smart-notes"
          data-testid="backup-directory-input"
          className="text-xs"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Absolute path on the server machine. Directory must exist and be writable before enabling scheduled backups.
        </p>
        {!backupDirValid && draftDir.trim() ? (
          <p className="mt-1 text-xs text-destructive" data-testid="backup-directory-error">
            {backupDirError ?? "Backup directory is invalid."}
          </p>
        ) : null}
      </section>

      <section>
        <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Schedule</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Interval</span>
            <select
              value={draftIntervalHours}
              onChange={(event) => setDraftIntervalHours(Number(event.target.value))}
              data-testid="backup-interval-select"
              className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
            >
              {intervalOptions.map((option) => (
                <option key={option.hours} value={option.hours}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Retention (keep last)</span>
            <Input
              type="number"
              min={1}
              max={100}
              value={draftRetention}
              onChange={(event) => setDraftRetention(Number(event.target.value))}
              data-testid="backup-retention-input"
              className="text-xs"
            />
          </label>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Scheduled backups</p>
          <button
            type="button"
            role="switch"
            aria-checked={draftEnabled}
            data-testid="backup-enabled-toggle"
            onClick={() => setDraftEnabled((value) => !value)}
            className={cn(
              "relative h-6 w-11 rounded-full border transition-colors",
              draftEnabled
                ? "border-[color:var(--accent)] bg-[color:var(--accent)]"
                : "border-border bg-muted"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-background shadow transition-transform",
                draftEnabled ? "translate-x-5" : "translate-x-0.5"
              )}
            />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Runs while the app is running. Missed intervals catch up on next start.
        </p>
      </section>

      {config?.lastRunAt ? (
        <section className="rounded-md border border-border/80 bg-muted/10 p-3 text-xs" data-testid="backup-last-run">
          <p className="text-foreground">
            Last run: {formatBackupDate(config.lastRunAt)}
            {config.lastRunStatus ? ` (${config.lastRunStatus})` : ""}
          </p>
          {config.lastSnapshotFile ? (
            <p className="mt-1 text-muted-foreground">Latest snapshot: {config.lastSnapshotFile}</p>
          ) : null}
          {config.lastRunError ? (
            <p className="mt-1 text-destructive">{config.lastRunError}</p>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={saving}
          data-testid="backup-save-settings"
        >
          {saving ? "Saving…" : "Save backup settings"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleRunBackup()}
          disabled={runningBackup || !draftDir.trim()}
          data-testid="backup-run-now"
          className="gap-1.5"
        >
          {runningBackup ? <Loader2 className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
          {runningBackup ? "Backing up…" : "Run backup now"}
        </Button>
      </div>

      {error ? (
        <p className="text-xs text-destructive" data-testid="backup-error">
          {error}
        </p>
      ) : null}
      {statusMessage ? (
        <p className="text-xs text-foreground" data-testid="backup-status-message">
          {statusMessage}
        </p>
      ) : null}

      <section>
        <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Snapshots</p>
        {snapshots.length === 0 ? (
          <p className="rounded-md border border-border/80 bg-muted/10 p-3 text-xs text-muted-foreground" data-testid="backup-snapshot-empty">
            No snapshots yet. Run a backup to create the first archive.
          </p>
        ) : (
          <ul className="space-y-1.5 rounded-md border border-border/80 bg-muted/10 p-2.5">
            {snapshots.map((snapshot) => (
              <li
                key={snapshot.filename}
                className="flex items-center justify-between gap-3 rounded border border-border/60 bg-background/60 px-2.5 py-2 text-xs"
                data-testid={`backup-snapshot-${snapshot.filename}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-foreground">{formatBackupDate(snapshot.createdAt)}</p>
                  <p className="text-muted-foreground">{formatBackupBytes(snapshot.sizeBytes)}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={restoringFilename !== null}
                  onClick={() => setConfirmRestore(snapshot)}
                  data-testid={`backup-restore-${snapshot.filename}`}
                  className="shrink-0 gap-1.5"
                >
                  {restoringFilename === snapshot.filename ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={Boolean(confirmRestore)} onOpenChange={(open) => !open && setConfirmRestore(null)}>
        <DialogContent className="sm:max-w-md" data-testid="backup-restore-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Restore vault backup?</DialogTitle>
            <DialogDescription>
              This replaces the entire current vault with the selected snapshot. Unsaved edits may be lost.
            </DialogDescription>
          </DialogHeader>
          {confirmRestore ? (
            <p className="text-xs text-muted-foreground">
              Snapshot: <span className="text-foreground">{confirmRestore.filename}</span>
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConfirmRestore(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={() => void handleConfirmRestore()}
              disabled={restoringFilename !== null}
              data-testid="backup-restore-confirm"
            >
              {restoringFilename ? "Restoring…" : "Restore vault"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
