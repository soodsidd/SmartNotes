import { getAppStateDir } from "@/server/app-state";
import {
  loadBackupConfig,
  msUntilNextScheduledBackup,
  runVaultBackup,
  shouldRunScheduledBackup,
  validateBackupDirectory,
} from "./backup";

const TICK_MS = 60_000;

let started = false;
let tickTimer: NodeJS.Timeout | null = null;
let running = false;

async function schedulerTick(stateDir: string) {
  if (running) {
    return;
  }

  const config = loadBackupConfig(stateDir);
  if (!config.enabled) {
    return;
  }

  const dirCheck = validateBackupDirectory(config.backupDir);
  if (!dirCheck.ok) {
    return;
  }

  if (!shouldRunScheduledBackup(config)) {
    return;
  }

  running = true;
  try {
    await runVaultBackup(stateDir);
  } catch (error) {
    console.warn("[smart-notes] scheduled vault backup failed:", error);
  } finally {
    running = false;
  }
}

export function startVaultBackupScheduler(stateDir = getAppStateDir()) {
  if (started) {
    return;
  }
  started = true;

  void schedulerTick(stateDir);

  tickTimer = setInterval(() => {
    void schedulerTick(stateDir);
  }, TICK_MS);

  if (typeof tickTimer.unref === "function") {
    tickTimer.unref();
  }
}

export function stopVaultBackupScheduler() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  started = false;
}

export function getSchedulerDebugState(stateDir = getAppStateDir()) {
  const config = loadBackupConfig(stateDir);
  return {
    started,
    running,
    enabled: config.enabled,
    msUntilNext: msUntilNextScheduledBackup(config),
  };
}
