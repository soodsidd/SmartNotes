/**
 * SN-370: agents display downloaded / generated images inline in the
 * Companion sidebar via the companion_image_put vault tool.
 */
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { executeVaultCommand, listVaultCommands } from "@/server/vault/agent-commands";
import { putCompanionImage, sniffImageFormat } from "@/server/vault/companion-images";
import { formatVaultToolsPrompt, getVaultToolDefinition } from "@/server/vault/agent-tools";

// 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG = Buffer.from(PNG_BASE64, "base64");

async function withVault(run: (vaultRoot: string) => Promise<void>) {
  const prev = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn-370-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(
      path.join(vaultRoot, "Notebook/Section/Page.html"),
      "---\ntitle: Page\ncreated: 2026-10-26T00:00:00Z\nupdated: 2026-10-26T00:00:00Z\n---\n<p>stub</p>\n",
      "utf8"
    );
    await run(vaultRoot);
  } finally {
    if (prev) process.env.SMART_NOTES_VAULT = prev;
    else delete process.env.SMART_NOTES_VAULT;
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

async function withImageServer(run: (base: string) => Promise<void>) {
  const server = http.createServer((req, res) => {
    if (req.url === "/cat.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG);
    } else if (req.url === "/page.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not an image</html>");
    } else {
      res.writeHead(404);
      res.end("missing");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("sniffImageFormat", () => {
  test("detects real image bytes and rejects others", () => {
    expect(sniffImageFormat(PNG)?.mime).toBe("image/png");
    expect(sniffImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe(".jpg");
    expect(sniffImageFormat(Buffer.from("GIF89a....")))?.toMatchObject({ ext: ".gif" });
    expect(sniffImageFormat(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))?.ext).toBe(".svg");
    expect(sniffImageFormat(Buffer.from("<html>hi</html>"))).toBeNull();
  });
});

describe("companion_image_put", () => {
  test("is registered as a vault tool, command, and in the companion prompt", () => {
    const def = getVaultToolDefinition("companion_image_put");
    expect(def).toMatchObject({ group: "companion", action: "image_put" });
    expect(listVaultCommands().companion).toEqual(["image_put"]);
    expect(formatVaultToolsPrompt()).toContain("companion_image_put");
  });

  test("stores a generated (base64) image durably in .companion-images and returns markdown", async () => {
    await withVault(async (vaultRoot) => {
      const result = await executeVaultCommand({
        group: "companion",
        action: "image_put",
        args: { dataBase64: `data:image/png;base64,${PNG_BASE64}`, alt: "Unit circle diagram", fileName: "circle.jpg" },
      });
      const data = result.data as Awaited<ReturnType<typeof putCompanionImage>>;
      expect(data.source).toBe("generated");
      expect(data.mimeType).toBe("image/png");
      expect(data.fileName).toMatch(/circle\.png$/); // extension corrected from real bytes
      expect(data.path.startsWith(".companion-images/")).toBe(true);
      expect(data.url).toBe(`/vault/${data.path.split("/").map(encodeURIComponent).join("/")}`);
      expect(data.markdown).toBe(`![Unit circle diagram](<${data.url}>)`);
      const stored = await fs.readFile(path.join(vaultRoot, ...data.path.split("/")));
      expect(stored.equals(PNG)).toBe(true);
    });
  });

  test("downloads a web image and files it under a page's .assets when path is given", async () => {
    await withVault(async (vaultRoot) => {
      await withImageServer(async (base) => {
        const data = await putCompanionImage({ url: `${base}/cat.png`, path: "Notebook/Section/Page.html" });
        expect(data.source).toBe("download");
        expect(data.path).toBe("Notebook/Section/Page.assets/cat.png");
        expect(data.url).toBe("/vault/Notebook/Section/Page.assets/cat.png");
        expect(data.alt).toBe("cat"); // default alt from file name
        await expect(fs.stat(path.join(vaultRoot, "Notebook/Section/Page.assets/cat.png"))).resolves.toBeTruthy();
      });
    });
  });

  test("failures return readable errors and store nothing", async () => {
    await withVault(async (vaultRoot) => {
      await withImageServer(async (base) => {
        await expect(putCompanionImage({ url: `${base}/missing.png` })).rejects.toThrow(/HTTP 404/);
        await expect(putCompanionImage({ url: `${base}/page.html` })).rejects.toThrow(/not a PNG, JPEG, GIF, WebP, or SVG image \(server sent text\/html\)/);
      });
      await expect(putCompanionImage({ url: "file:///etc/passwd" })).rejects.toThrow(/only http\(s\) URLs/);
      await expect(putCompanionImage({ dataBase64: "not base64!!" })).rejects.toThrow(/base64 image data/);
      await expect(putCompanionImage({})).rejects.toThrow(/exactly one of "url"/);
      await expect(putCompanionImage({ url: "https://x.test/a.png", dataBase64: PNG_BASE64 })).rejects.toThrow(/exactly one/);
      await expect(fs.stat(path.join(vaultRoot, ".companion-images"))).rejects.toThrow();
    });
  });
});
