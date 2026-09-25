import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Vault-root resolution for Next API routes. Must stay aligned with
 * `server/vault-root.js` (used by `server.js` for `/vault/*` serving) or a
 * worktree preview writes uploads into one vault while serving files from
 * another (SN-148 split-brain 404).
 *
 * In the custom server, `server.js` sets `SMART_NOTES_VAULT` to the same
 * absolute path it uses for static `/vault/*` assets, so the env branch below
 * is the normal path at runtime. The remaining order mirrors `vault-root.js`:
 *   1. SMART_NOTES_VAULT env
 *   2. <base>/vault if present
 *   3. <base>/.e2e-vault if present (worktree / E2E isolation)
 *   4. primary-repo vault via git-common-dir
 *   5. mkdir <base>/vault
 */
function resolvePrimaryRepoVault(fromDir: string): string | null {
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

function defaultVaultRoot() {
  const workspaceRoot = process.cwd();

  const localVault = path.join(workspaceRoot, "vault");
  if (fs.existsSync(localVault)) {
    return localVault;
  }

  // Prefer worktree .e2e-vault BEFORE primary-repo linking so API uploads and
  // /vault/* GETs hit the same tree (SN-148).
  const e2eVault = path.join(workspaceRoot, ".e2e-vault");
  if (fs.existsSync(e2eVault)) {
    return e2eVault;
  }

  const linkedVault = resolvePrimaryRepoVault(workspaceRoot);
  if (linkedVault) {
    return linkedVault;
  }

  return localVault;
}

export function getVaultRoot() {
  const configured = process.env.SMART_NOTES_VAULT;
  const root = configured
    ? path.resolve(configured)
    : path.resolve(defaultVaultRoot());

  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  return root;
}
