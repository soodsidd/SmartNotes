import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../packages/workout-nutrition-app/migration/migration.cjs");

const FIXTURE = path.resolve("tests/fixtures/sn-183-redacted-workout-log");
const PAGE = "Health/Strength/workout-log.html";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sn183-vault-copy-"));
  const backup = await fs.mkdtemp(path.join(os.tmpdir(), "sn183-backup-parent-"));
  await fs.rm(backup, { recursive: true });
  await fs.cp(FIXTURE, root, { recursive: true });
  return { root, backup };
}

describe("SN-183 copied-vault backup, migration, and restore", () => {
  it("backs up every artifact, rehearses 13/13 exact nested preservation, and verifies restore", async () => {
    const { root, backup } = await fixture();
    try {
      const copy = await fs.mkdtemp(path.join(os.tmpdir(), "sn183-empty-copy-"));
      await migration.createBackup({ vaultRoot: root, pagePath: PAGE, backupDir: backup });
      const result = await migration.rehearse({
        vaultRoot: copy, pagePath: PAGE, backupDir: backup, expectedCount: 13,
        appSource: "<main><h1>Workout &amp; Nutrition</h1></main>",
      });
      expect(result).toEqual(expect.objectContaining({
        beforeCount: 13, afterCount: 13, countMatches: true, schemaEqual: true, idsEqual: true,
        timestampsEqual: true, nestedValuesEqual: true, explicitlyTransformedRows: 0,
        documentEqual: true, firstMigrationVerified: true, restoreVerified: true, warnings: [],
      }));
      const manifest = JSON.parse(await fs.readFile(path.join(backup, "manifest.json"), "utf8"));
      expect(manifest.artifacts.map((entry: { path: string }) => entry.path)).toEqual(expect.arrayContaining([
        PAGE,
        "Health/Strength/workout-log.form.json",
        "Health/Strength/workout-log.log.json",
        "Health/Strength/workout-log.companion.json",
        "Health/Strength/workout-log.assets/redacted.txt",
        "Health/Strength/.versions/workout-log/version-1.html",
      ]));
      expect(manifest.artifacts.every((entry: { sha256: string }) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
      expect(await fs.readFile(path.join(copy, PAGE), "utf8")).toContain("note_type: app");
      const appRows = JSON.parse(await fs.readFile(path.join(copy, "Health/Strength/workout-log.app-data.entries.json"), "utf8")).rows;
      expect(appRows).toHaveLength(13);
      expect(appRows[0].values.workoutA.exerciseAlpha.privateNested).toEqual({ preserve: true });
      expect(await fs.stat(path.join(copy, "Health/Strength/workout-log.assets/redacted.txt"))).toBeDefined();
      expect(await fs.readFile(path.join(copy, "Health/Strength/workout-log.companion.json"), "utf8")).toContain("redacted");
      await migration.restoreBackup({ vaultRoot: copy, backupDir: backup });
      expect(await fs.readFile(path.join(copy, PAGE), "utf8")).toContain("note_type: log");
      expect(JSON.parse(await fs.readFile(path.join(copy, "Health/Strength/workout-log.log.json"), "utf8")).rows).toHaveLength(13);
      await fs.rm(copy, { recursive: true, force: true });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(backup, { recursive: true, force: true });
    }
  });

  it("warns on count drift but preserves all rows", () => {
    const before = { rows: [{ id: "r_one000", createdAt: "2026-01-01", values: { nested: { keep: true } } }] };
    expect(migration.equalityReport(before, before, 13)).toEqual(expect.objectContaining({
      beforeCount: 1, afterCount: 1, nestedValuesEqual: true,
      warnings: ["Expected baseline 13; source currently contains 1. All current rows were preserved."],
    }));
  });

  it("fails closed when any source artifact changes after backup", async () => {
    const { root, backup } = await fixture();
    try {
      await migration.createBackup({ vaultRoot: root, pagePath: PAGE, backupDir: backup });
      await fs.appendFile(path.join(root, "Health/Strength/workout-log.companion.json"), " ");
      await expect(migration.migrate({
        vaultRoot: root, pagePath: PAGE, backupDir: backup, rehearsal: true,
        appSource: "<main>Refused</main>",
      })).rejects.toThrow(/source artifacts changed/);
      expect(await fs.readFile(path.join(root, PAGE), "utf8")).toContain("note_type: log");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(backup, { recursive: true, force: true });
    }
  });

  it("requires a verified owner confirmation and SN-182 runtime for live cutover", async () => {
    const { root, backup } = await fixture();
    try {
      const manifest = await migration.createBackup({ vaultRoot: root, pagePath: PAGE, backupDir: backup });
      await expect(migration.migrate({
        vaultRoot: root, pagePath: PAGE, backupDir: backup, rehearsal: false,
        ownerConfirmation: "wrong", runtimeUrl: "http://127.0.0.1:1", appSource: "<main>Refused</main>",
      })).rejects.toThrow(/owner confirmation/);
      await expect(migration.migrate({
        vaultRoot: root, pagePath: PAGE, backupDir: backup, rehearsal: false,
        ownerConfirmation: manifest.backupId, appSource: "<main>Refused</main>",
      })).rejects.toThrow(/runtime-url is required/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(backup, { recursive: true, force: true });
    }
  });

  it("fails a live cutover when the runtime capability endpoint is absent", async () => {
    const { root, backup } = await fixture();
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response("Not found", { status: 404 }));
    try {
      const manifest = await migration.createBackup({ vaultRoot: root, pagePath: PAGE, backupDir: backup });
      await expect(migration.migrate({
        vaultRoot: root, pagePath: PAGE, backupDir: backup, rehearsal: false,
        ownerConfirmation: manifest.backupId, runtimeUrl: "https://runtime.invalid", appSource: "<main>Refused</main>",
      })).rejects.toThrow(/versioned App capability/);
      expect(fetchSpy).toHaveBeenCalledWith("https://runtime.invalid/api/app/capabilities", { redirect: "manual" });
      expect(await fs.readFile(path.join(root, PAGE), "utf8")).toContain("note_type: log");
    } finally {
      fetchSpy.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(backup, { recursive: true, force: true });
    }
  });

  it("accepts a deployed App runtime capability while the target page is still a Log", async () => {
    const { root, backup } = await fixture();
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      capability: "smart-notes.app-pages", version: 1, manifestVersion: 1, rpcOperations: ["query", "add", "update", "delete"],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    try {
      const manifest = await migration.createBackup({ vaultRoot: root, pagePath: PAGE, backupDir: backup });
      expect(await fs.readFile(path.join(root, PAGE), "utf8")).toContain("note_type: log");
      await expect(migration.migrate({
        vaultRoot: root, pagePath: PAGE, backupDir: backup, rehearsal: false,
        ownerConfirmation: manifest.backupId, runtimeUrl: "https://runtime.invalid", appSource: "<main>App</main>",
      })).resolves.toEqual(expect.objectContaining({ beforeCount: 13, afterCount: 13, documentEqual: true }));
      expect(await fs.readFile(path.join(root, PAGE), "utf8")).toContain("note_type: app");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(backup, { recursive: true, force: true });
    }
  });

  it("rolls back every artifact when a staged promotion fails after partial cutover", async () => {
    const { root, backup } = await fixture();
    try {
      await migration.createBackup({ vaultRoot: root, pagePath: PAGE, backupDir: backup });
      await expect(migration.migrate({
        vaultRoot: root, pagePath: PAGE, backupDir: backup, rehearsal: true,
        appSource: "<main>Fault injection</main>",
        _testHooks: { afterPromotion: ({ promotedCount }: { promotedCount: number }) => {
          if (promotedCount === 2) throw new Error("injected promotion failure");
        } },
      })).rejects.toThrow(/injected promotion failure/);

      expect(await fs.readFile(path.join(root, PAGE), "utf8")).toContain("note_type: log");
      expect(JSON.parse(await fs.readFile(path.join(root, "Health/Strength/workout-log.log.json"), "utf8")).rows).toHaveLength(13);
      expect(JSON.parse(await fs.readFile(path.join(root, "Health/Strength/workout-log.form.json"), "utf8")).version).toBe(1);
      const names = await fs.readdir(path.join(root, "Health/Strength"));
      expect(names.filter((name) => name.includes(".sn183-") || name.startsWith("workout-log.app"))).toEqual([]);
      await expect(migration.verifyBackup({ backupDir: backup })).resolves.toEqual(expect.objectContaining({ ok: true, rowCount: 13 }));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(backup, { recursive: true, force: true });
    }
  });

  it("refuses backups inside the source vault", async () => {
    const { root, backup } = await fixture();
    try {
      await expect(migration.createBackup({
        vaultRoot: root, pagePath: PAGE, backupDir: path.join(root, "unsafe-backup"),
      })).rejects.toThrow(/outside the source vault/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(backup, { recursive: true, force: true });
    }
  });

  it("refuses migration when maintained App source is absent", async () => {
    const { root, backup } = await fixture();
    try {
      await migration.createBackup({ vaultRoot: root, pagePath: PAGE, backupDir: backup });
      await expect(migration.migrate({ vaultRoot: root, pagePath: PAGE, backupDir: backup, rehearsal: true }))
        .rejects.toThrow(/maintained App source is required/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(backup, { recursive: true, force: true });
    }
  });
});
