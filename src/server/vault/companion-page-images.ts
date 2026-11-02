import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { readPage } from "./pages";
import { resolveVaultPath, siblingAssetDirectory, toVaultRelativePath } from "./paths";
import { sniffImageFormat } from "./companion-images";
import { VaultError } from "./errors";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Read an image actually embedded in this page, in document order. */
export async function readCompanionPageImage(pagePath: string, index: number, includeImageData = false) {
  if (!Number.isInteger(index) || index < 0) {
    throw new VaultError("INVALID_INPUT", '"index" must be a zero-based image number.');
  }
  const page = await readPage(pagePath);
  const assetDir = siblingAssetDirectory(page.path);
  const $ = cheerio.load(page.body);
  const images = $("img[src]").toArray().map((element) => ({
    src: $(element).attr("src") ?? "",
    alt: $(element).attr("alt") ?? "",
  }));
  if (index >= images.length) {
    throw new VaultError("INVALID_INPUT", `Page has ${images.length} embedded image(s); index ${index} is out of range.`);
  }
  const selected = images[index];
  const raw = selected.src.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new VaultError("INVALID_INPUT", "The embedded image URL is invalid.");
  }
  const relative = decoded.startsWith("/vault/")
    ? toVaultRelativePath(decoded.slice(7))
    : decoded.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(decoded)
      ? ""
      : path.posix.normalize(path.posix.join(path.posix.dirname(page.path), decoded.replaceAll("\\", "/")));
  if (!relative.startsWith(`${assetDir}/`) || relative.split("/").includes("..")) {
    throw new VaultError("INVALID_INPUT", "The embedded image is outside this page's assets.");
  }
  const asset = resolveVaultPath(relative, "section");
  const expectedDir = resolveVaultPath(assetDir, "section");
  const [realFile, realDir] = await Promise.all([
    fs.realpath(asset.absolutePath),
    fs.realpath(expectedDir.absolutePath),
  ]);
  if (!realFile.startsWith(`${realDir}${path.sep}`)) {
    throw new VaultError("INVALID_INPUT", "The embedded image escapes this page's assets.");
  }
  const stat = await fs.stat(realFile);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new VaultError("INVALID_INPUT", "Embedded image exceeds the 12 MB vision limit.", 413);
  }
  const bytes = await fs.readFile(realFile);
  const format = sniffImageFormat(bytes);
  if (!format || format.mime === "image/svg+xml") {
    throw new VaultError("INVALID_INPUT", "Embedded image is not a supported PNG, JPEG, GIF, or WebP photo.");
  }
  return {
    path: page.path,
    index,
    imageCount: images.length,
    fileName: path.posix.basename(relative),
    alt: selected.alt,
    mimeType: format.mime,
    bytes: bytes.length,
    resolvedDiskPath: realFile,
    ...(includeImageData ? { dataBase64: bytes.toString("base64") } : {}),
  };
}
