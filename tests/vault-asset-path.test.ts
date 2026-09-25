import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("server/vault-asset-path", () => {
  it("loads under CommonJS require (server.js startup path)", () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../server/vault-asset-path");
    }).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveVaultAssetAbsolutePath } = require("../server/vault-asset-path");
    expect(typeof resolveVaultAssetAbsolutePath).toBe("function");
  });

  it("resolves portable asset paths from the notebook registry", async () => {
    const previousState = process.env.SMART_NOTES_STATE_DIR;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn77-asset-"));
    const portableRoot = path.join(stateDir, "portable");
    await fs.mkdir(portableRoot, { recursive: true });
    await fs.mkdir(path.join(portableRoot, "Section", "page.assets"), { recursive: true });
    await fs.writeFile(path.join(portableRoot, "Section", "page.assets", "diagram.png"), "png");

    process.env.SMART_NOTES_STATE_DIR = stateDir;
    await fs.writeFile(
      path.join(stateDir, "notebook-registry.json"),
      JSON.stringify(
        {
          version: 1,
          notebooks: [
            {
              id: "abc12345",
              name: "Portable",
              rootPath: portableRoot,
              addedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveVaultAssetAbsolutePath } = require("../server/vault-asset-path");
      const resolved = resolveVaultAssetAbsolutePath(
        path.join(stateDir, "primary-vault"),
        "+abc12345/Section/page.assets/diagram.png"
      );
      expect(resolved).toBe(path.join(portableRoot, "Section", "page.assets", "diagram.png"));
    } finally {
      jest.resetModules();
      if (previousState) process.env.SMART_NOTES_STATE_DIR = previousState;
      else delete process.env.SMART_NOTES_STATE_DIR;
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("falls back to the default app state registry when a runtime dir has none", async () => {
    const previousRuntimeDir = process.env.CLI_CHAT_RUNTIME_DIR;
    const previousStateDir = process.env.SMART_NOTES_STATE_DIR;
    const os = require("node:os") as typeof import("node:os");
    const homedirSpy = jest.spyOn(os, "homedir");
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "sn135-home-"));
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn135-runtime-"));
    const defaultStateDir = path.join(tempHome, ".cli-chat", "dev-workspace", "smart-notes");
    const portableRoot = path.join(tempHome, "portable");
    await fs.mkdir(path.join(portableRoot, "Section", "page.assets"), { recursive: true });
    await fs.mkdir(defaultStateDir, { recursive: true });
    await fs.writeFile(path.join(portableRoot, "Section", "page.assets", "catalogue.pdf"), "pdf");
    await fs.writeFile(
      path.join(defaultStateDir, "notebook-registry.json"),
      JSON.stringify(
        {
          version: 1,
          notebooks: [
            {
              id: "def67890",
              name: "Portable",
              rootPath: portableRoot,
              addedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );

    process.env.CLI_CHAT_RUNTIME_DIR = runtimeDir;
    delete process.env.SMART_NOTES_STATE_DIR;
    homedirSpy.mockReturnValue(tempHome);

    try {
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveVaultAssetAbsolutePath } = require("../server/vault-asset-path");
      const resolved = resolveVaultAssetAbsolutePath(
        path.join(tempHome, "primary-vault"),
        "+def67890/Section/page.assets/catalogue.pdf"
      );
      expect(resolved).toBe(path.join(portableRoot, "Section", "page.assets", "catalogue.pdf"));
    } finally {
      jest.resetModules();
      homedirSpy.mockRestore();
      if (previousRuntimeDir) process.env.CLI_CHAT_RUNTIME_DIR = previousRuntimeDir;
      else delete process.env.CLI_CHAT_RUNTIME_DIR;
      if (previousStateDir) process.env.SMART_NOTES_STATE_DIR = previousStateDir;
      else delete process.env.SMART_NOTES_STATE_DIR;
      await fs.rm(tempHome, { recursive: true, force: true });
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
  });
});
