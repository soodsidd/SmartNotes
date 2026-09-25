import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import { executeVaultTool, getVaultToolDefinition } from "@/server/vault/agent-tools";
import { invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";
import { issueRenderToken, resetRenderTokensForTesting, verifyRenderToken } from "@/server/vault/page-render-token";
import { mapBrokenImagesToWarnings } from "@/server/vault/page-render";

const SEED_PATH = "Notebook/Section/seed.html";
const SEED_CONTENT = `---
title: Seed
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
---
<p>Seed page for render tests.</p>
`;

jest.mock("@/server/vault/page-render", () => ({
  ...jest.requireActual("@/server/vault/page-render"),
  renderPageToPng: jest.fn(async () => ({
    relativePath: "Notebook/Section/seed.assets/page-render-latest.png",
    vaultUrl: "/vault/Notebook/Section/seed.assets/page-render-latest.png",
    absoluteVaultUrl: "http://127.0.0.1:3002/vault/Notebook/Section/seed.assets/page-render-latest.png",
    absoluteDiskPath: path.join(
      os.tmpdir(),
      "smart-notes-render",
      "Notebook",
      "Section",
      "seed.assets",
      "page-render-latest.png"
    ),
    width: 760,
    height: 1200,
    bytes: 4096,
    warnings: [],
  })),
}));

const { renderPageToPng } = jest.requireMock("@/server/vault/page-render") as {
  renderPageToPng: jest.Mock;
};

async function withVaultFixture(run: () => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-render-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  invalidateVaultTreeCacheForTesting();
  resetRenderTokensForTesting();

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, SEED_PATH), SEED_CONTENT, "utf8");
    await run();
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
    resetRenderTokensForTesting();
  }
}

describe("page_render vault tool", () => {
  beforeEach(() => {
    renderPageToPng.mockClear();
  });

  it("registers page_render with required path parameter", () => {
    const tool = getVaultToolDefinition("page_render");
    expect(tool?.action).toBe("render");
    expect(tool?.parameters.path.required).toBe(true);
  });

  it("resolves rr alias to page_render", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultTool("rr", { path: SEED_PATH });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tool).toBe("page_render");
        expect(result.alias).toBe("rr");
        expect(
          (result.result.data as { vaultUrl: string; absoluteDiskPath: string }).vaultUrl
        ).toContain("page-render-latest.png");
        expect(
          (result.result.data as { vaultUrl: string; absoluteDiskPath: string }).absoluteDiskPath
        ).toContain("page-render-latest.png");
      }
      expect(renderPageToPng).toHaveBeenCalledWith(
        expect.objectContaining({
          pagePath: SEED_PATH,
          scale: 2,
          fullPage: true,
          outputName: "page-render-latest.png",
        })
      );
    });
  });

  it("validates render args and forwards custom scale/outputName", async () => {
    await withVaultFixture(async () => {
      const command = await executeVaultCommand({
        group: "page",
        action: "render",
        args: {
          path: SEED_PATH,
          scale: 3,
          fullPage: false,
          outputName: "custom-render.png",
        },
      });
      expect(command.data).toMatchObject({
        bytes: 4096,
        width: 760,
      });
      expect(renderPageToPng).toHaveBeenCalledWith({
        pagePath: SEED_PATH,
        scale: 3,
        fullPage: false,
        outputName: "custom-render.png",
      });
    });
  });

  it("rejects missing path", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultTool("page_render", {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID_INPUT");
      }
    });
  });
});

describe("missing-asset warnings", () => {
  it("maps broken image sources to structured missing_asset warnings", () => {
    const warnings = mapBrokenImagesToWarnings([
      "keys.assets/image-2.png",
      "https://example.com/remote.png",
    ]);
    expect(warnings).toEqual([
      { code: "missing_asset", detail: expect.stringContaining("keys.assets/image-2.png") },
      { code: "missing_asset", detail: expect.stringContaining("remote.png") },
    ]);
  });

  it("returns no warnings when all images load", () => {
    expect(mapBrokenImagesToWarnings([])).toEqual([]);
  });
});

describe("render token gate", () => {
  it("issues short-lived path-bound tokens for a page path", () => {
    resetRenderTokensForTesting();
    const token = issueRenderToken(SEED_PATH);
    expect(verifyRenderToken(SEED_PATH, token)).toBe(true);
    expect(verifyRenderToken(SEED_PATH, token)).toBe(true);
    expect(verifyRenderToken("Notebook/Section/other.html", token)).toBe(false);
  });
});
