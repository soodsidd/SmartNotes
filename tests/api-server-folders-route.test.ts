import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET as GET_SERVER_FOLDERS, POST as POST_SERVER_FOLDERS } from "@/app/api/fs/server-folders/route";
import { POST as POST_NOTEBOOK_REGISTRY } from "@/app/api/notebook-registry/route";

async function withServerFolderFixture(
  run: (input: { parentDir: string; stateDir: string; vaultRoot: string }) => Promise<void>
) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn100-server-folders-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn100-state-"));
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn100-vault-"));

  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;

  try {
    await run({ parentDir, stateDir, vaultRoot });
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    if (previousState) process.env.SMART_NOTES_STATE_DIR = previousState;
    else delete process.env.SMART_NOTES_STATE_DIR;
    await fs.rm(parentDir, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(vaultRoot, { recursive: true, force: true });
    delete (global as Record<string, unknown>)["_smartNotesIo"];
  }
}

describe("server folder browser route", () => {
  it("lists backend-host folders", async () => {
    await withServerFolderFixture(async ({ parentDir }) => {
      await fs.mkdir(path.join(parentDir, "Existing Folder"));

      const response = await GET_SERVER_FOLDERS(
        new Request(`http://localhost/api/fs/server-folders?path=${encodeURIComponent(parentDir)}`)
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        path: path.resolve(parentDir),
        entries: [{ name: "Existing Folder", path: path.join(parentDir, "Existing Folder") }],
      });
    });
  });

  it("creates, validates, and registers a remote notebook folder", async () => {
    await withServerFolderFixture(async ({ parentDir }) => {
      const createResponse = await POST_SERVER_FOLDERS(
        new Request("http://localhost/api/fs/server-folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            parentPath: parentDir,
            folderName: "Mobile Notebook",
          }),
        })
      );
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as { path: string };
      expect(created.path).toBe(path.join(parentDir, "Mobile Notebook"));

      const existingResponse = await POST_SERVER_FOLDERS(
        new Request("http://localhost/api/fs/server-folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            parentPath: parentDir,
            folderName: "Mobile Notebook",
          }),
        })
      );
      expect(existingResponse.status).toBe(201);
      await expect(existingResponse.json()).resolves.toMatchObject({
        path: path.resolve(created.path),
      });

      const validateResponse = await POST_SERVER_FOLDERS(
        new Request("http://localhost/api/fs/server-folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "validate", path: created.path }),
        })
      );
      expect(validateResponse.status).toBe(200);
      await expect(validateResponse.json()).resolves.toEqual({
        valid: true,
        path: path.resolve(created.path),
      });

      const registerResponse = await POST_NOTEBOOK_REGISTRY(
        new Request("http://localhost/api/notebook-registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rootPath: created.path,
            name: "Mobile Notebook",
          }),
        })
      );
      expect(registerResponse.status).toBe(201);
      await expect(registerResponse.json()).resolves.toMatchObject({
        notebook: {
          name: "Mobile Notebook",
          rootPath: path.resolve(created.path),
        },
      });
    });
  });
});
