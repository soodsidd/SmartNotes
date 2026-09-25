export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startVaultBackupScheduler } = await import("@/server/vault/backup-scheduler");
    startVaultBackupScheduler();
  }
}
