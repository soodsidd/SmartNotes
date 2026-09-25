/**
 * Shared vault-root resolution for the custom server (`/vault/*`) and
 * Next API routes (`getVaultRoot`). Both must agree or uploads succeed
 * while immersive PDF/image open returns 404 (SN-148 worktree split-brain).
 *
 * Order:
 *   1. SMART_NOTES_VAULT env
 *   2. <baseDir>/vault if present
 *   3. <baseDir>/.e2e-vault if present (worktree / E2E isolation)
 *   4. primary-repo vault via git-common-dir (worktree with neither local vault)
 *   5. mkdir <baseDir>/vault
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function resolvePrimaryRepoVault(fromDir) {
  try {
    const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: fromDir,
      encoding: "utf8",
      windowsHide: true,
    });
    const commonDir = String(result.stdout || "").trim();
    if (!commonDir || result.status !== 0) {
      return null;
    }

    const gitDir = path.resolve(fromDir, commonDir);
    const repoRoot =
      path.basename(gitDir) === ".git" ? path.dirname(gitDir) : gitDir;
    const vault = path.join(repoRoot, "vault");
    return fs.existsSync(vault) ? vault : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ baseDir?: string, env?: NodeJS.ProcessEnv, mkdir?: boolean }} [options]
 * @returns {{ root: string, source: "env" | "local-vault" | "e2e-vault" | "primary-repo" | "created-vault" }}
 */
function resolveVaultRoot(options = {}) {
  const env = options.env || process.env;
  const baseDir = options.baseDir || process.cwd();
  const shouldMkdir = options.mkdir !== false;

  if (env.SMART_NOTES_VAULT) {
    const root = path.resolve(env.SMART_NOTES_VAULT);
    if (shouldMkdir && !fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    return { root, source: "env" };
  }

  const primary = path.join(baseDir, "vault");
  if (fs.existsSync(primary)) {
    return { root: path.resolve(primary), source: "local-vault" };
  }

  // Prefer worktree .e2e-vault BEFORE primary-repo linking so API uploads and
  // /vault/* GETs hit the same tree (SN-148).
  const e2eVault = path.join(baseDir, ".e2e-vault");
  if (fs.existsSync(e2eVault)) {
    return { root: path.resolve(e2eVault), source: "e2e-vault" };
  }

  const linkedVault = resolvePrimaryRepoVault(baseDir);
  if (linkedVault) {
    return { root: path.resolve(linkedVault), source: "primary-repo" };
  }

  if (shouldMkdir) {
    fs.mkdirSync(primary, { recursive: true });
  }
  return { root: path.resolve(primary), source: "created-vault" };
}

module.exports = {
  resolveVaultRoot,
  resolvePrimaryRepoVault,
};
