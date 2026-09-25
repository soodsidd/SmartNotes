import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("server/vault-root", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveVaultRoot } = require("../server/vault-root");

  it("loads under CommonJS require (server.js startup path)", () => {
    expect(typeof resolveVaultRoot).toBe("function");
  });

  it("prefers SMART_NOTES_VAULT over local vault dirs", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn148-vault-env-"));
    const envVault = path.join(baseDir, "from-env");
    await fs.mkdir(path.join(baseDir, "vault"), { recursive: true });
    await fs.mkdir(path.join(baseDir, ".e2e-vault"), { recursive: true });

    try {
      const resolved = resolveVaultRoot({
        baseDir,
        env: { SMART_NOTES_VAULT: envVault },
        mkdir: true,
      });
      expect(resolved.source).toBe("env");
      expect(resolved.root).toBe(path.resolve(envVault));
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  it("prefers local vault/ over .e2e-vault", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn148-vault-local-"));
    const localVault = path.join(baseDir, "vault");
    await fs.mkdir(localVault, { recursive: true });
    await fs.mkdir(path.join(baseDir, ".e2e-vault"), { recursive: true });

    try {
      const resolved = resolveVaultRoot({
        baseDir,
        env: {},
        mkdir: false,
      });
      expect(resolved.source).toBe("local-vault");
      expect(resolved.root).toBe(path.resolve(localVault));
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  it("prefers worktree .e2e-vault over primary-repo linking (SN-148)", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn148-vault-e2e-"));
    const e2eVault = path.join(baseDir, ".e2e-vault");
    await fs.mkdir(e2eVault, { recursive: true });

    try {
      const resolved = resolveVaultRoot({
        baseDir,
        env: {},
        mkdir: false,
      });
      expect(resolved.source).toBe("e2e-vault");
      expect(resolved.root).toBe(path.resolve(e2eVault));
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });
});
