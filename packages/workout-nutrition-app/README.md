# Workout & Nutrition App companion package

This package contains the workout-specific code used by the vault-native App page. Smart Notes core only supplies the generic SN-182 App/data contracts. Private exercise names, prescriptions, rows, and assets are never stored here: the migration derives its private configuration from the copied vault's existing `.form.json` and writes it only to that vault's app-owned `config` table.

## Safe rehearsal and cutover

First create and verify a backup from the source vault into an outside-the-vault directory. Then rehearse by restoring that exact backup into an empty copied vault:

```powershell
node packages/workout-nutrition-app/migration/cli.mjs backup --vault "C:\vault" --page "Health/Strength/workout-log.html" --backup "D:\vault-backups\workout-log-YYYYMMDD"
node packages/workout-nutrition-app/migration/cli.mjs rehearse --vault-copy "C:\empty-copied-vault" --page "Health/Strength/workout-log.html" --backup "D:\vault-backups\workout-log-YYYYMMDD" --report "D:\vault-backups\workout-log-YYYYMMDD\rehearsal-report.json"
```

The report contains only counts and equality booleans for schema, ids, timestamps, nested values, and the complete serialized document. It never includes row values or per-row hashes. A mismatch from the historical 13-row baseline is a warning; every row actually present at backup time is preserved.

Verify the backup and show its `backupId` to the owner before any live cutover:

```powershell
node packages/workout-nutrition-app/migration/cli.mjs verify --vault "C:\vault" --backup "D:\vault-backups\workout-log-YYYYMMDD"
```

Live migration fails unless the source checksums still match the confirmed backup, the confirmation is exactly that `backupId`, and the running target advertises the versioned SN-182 App capability at `/api/app/capabilities`:

```powershell
node packages/workout-nutrition-app/migration/cli.mjs migrate --vault "C:\vault" --backup "D:\vault-backups\workout-log-YYYYMMDD" --owner-confirmed "<backupId>" --runtime-url "https://smart-notes.example"
```

Restore is explicit and checksum-verified:

```powershell
node packages/workout-nutrition-app/migration/cli.mjs restore --vault-copy "C:\copied-vault" --backup "D:\vault-backups\workout-log-YYYYMMDD"
```

## Durable in-progress drafts

The app keeps a single durable draft of the in-progress workout form so a sandbox reload mid-entry never loses unsubmitted sets. Because the sandbox blocks `fetch`/`XHR`/`WebSocket` and has an opaque origin (so `localStorage` is unreliable), the draft is synced through the general App table API only. The cutover therefore declares a third app-owned table, `drafts`, via the standard manifest contract (`kind: "text"` fields `kind` / `view` / `savedAt`). All draft logic lives in companion app JS (`app/source.html`); no SN-182 platform behavior changes.

Draft rows are a separate table from committed `entries`, so drafts never appear in History, Progress, or the committed entry records. Every input change schedules a debounced (~1s) save well within the frame's 240-messages/10s limit; on load the latest unsent draft is restored; on a successful Accept the draft row is retired so a stale draft cannot resurface. The owner can inspect or clear the `drafts` table through the host-owned Develop → Data workspace like any other app-owned table.

The cutover writes the App page, manifest, app-owned entries, and private config as a rollback-protected transaction. It removes only the legacy Log/form siblings after outputs are installed. Companion metadata remains at the same page for chat continuity. The page asset directory and version history also remain at the same recognizable vault location; all are included in backup/restore.
