import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { POST as postReveal } from "@/app/api/fs/reveal/route";
import {
  registerPortableNotebook,
  portableNotebookPath,
} from "@/server/vault/notebook-registry";
import { resolveNotebookRevealPath } from "@/server/fs/reveal-in-explorer";

async function withVaultFixture(
  run: (input: { vaultRoot: string; portableRoot: string; stateDir: string }) => Promise<void>
) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn77-reveal-vault-"));
  const portableRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn77-reveal-portable-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn77-reveal-state-"));

  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;

  try {
    await fs.mkdir(path.join(vaultRoot, "Primary"), { recursive: true });
    await run({ vaultRoot, portableRoot, stateDir });
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    if (previousState) process.env.SMART_NOTES_STATE_DIR = previousState;
    else delete process.env.SMART_NOTES_STATE_DIR;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(portableRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

describe("reveal notebook in explorer", () => {
  it("resolves vault notebook paths under the vault root", async () => {
    await withVaultFixture(async ({ vaultRoot }) => {
      const resolved = resolveNotebookRevealPath("Primary");
      expect(resolved).toBe(path.join(vaultRoot, "Primary"));
    });
  });

  it("resolves remote notebook paths from the registry", async () => {
    await withVaultFixture(async ({ portableRoot, stateDir }) => {
      const entry = registerPortableNotebook(portableRoot, "Field Notes", stateDir);
      const resolved = resolveNotebookRevealPath(portableNotebookPath(entry.id));
      expect(resolved).toBe(path.resolve(portableRoot));
    });
  });

  it("serves reveal requests through the API route", async () => {
    await withVaultFixture(async ({ vaultRoot }) => {
      const response = await postReveal(
        new Request("http://localhost/api/fs/reveal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notebookPath: "Primary" }),
        })
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        path: path.join(vaultRoot, "Primary"),
      });
    });
  });
});
