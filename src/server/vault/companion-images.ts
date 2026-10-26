/**
 * SN-370: durable images the Companion agent displays inline in the sidebar.
 *
 * `companion_image_put` takes either an http(s) URL (downloaded server-side)
 * or base64 bytes (an image the agent generated), validates that the bytes
 * really are an image, and stores them in the vault:
 *   - with `path` → the page's sibling `<Page>.assets/` folder;
 *   - without     → the hidden vault folder `.companion-images/<YYYY-MM>/`
 *     (dot folders never appear in the vault tree).
 * It returns a `/vault/...` URL plus a ready-to-paste markdown image line, so
 * the image survives reload instead of pointing at an ephemeral blob or a
 * remote URL that may disappear.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getVaultRoot } from "./config";
import { uploadPageAsset } from "./assets";
import { VaultError } from "./errors";

export const COMPANION_IMAGE_DIR = ".companion-images";
export const MAX_COMPANION_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

type ImageFormat = { ext: string; mime: string };

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

/** Identify an image by magic bytes (SVG by its root element). */
export function sniffImageFormat(buffer: Buffer): ImageFormat | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: ".png", mime: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: ".jpg", mime: "image/jpeg" };
  }
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1"))) {
    return { ext: ".gif", mime: "image/gif" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
    return { ext: ".webp", mime: "image/webp" };
  }
  const head = buffer.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return { ext: ".svg", mime: "image/svg+xml" };
  }
  return null;
}

function sanitizeStem(name: string): string {
  const stem = path.basename(name, path.extname(name))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return stem || "image";
}

function decodeImageBase64(value: string): Buffer {
  const raw = value.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    throw new VaultError("INVALID_INPUT", '"dataBase64" must be base64 image data (a data: URL prefix is allowed).');
  }
  return Buffer.from(raw, "base64");
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string; nameHint: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VaultError("INVALID_INPUT", `Could not display image: "${url}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new VaultError("INVALID_INPUT", "Could not display image: only http(s) URLs can be downloaded.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(parsed, {
        signal: controller.signal,
        redirect: "follow",
        headers: { Accept: "image/*,*/*;q=0.5", "User-Agent": "SmartNotes-Companion/1.0" },
      });
    } catch (error) {
      const reason = controller.signal.aborted ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : (error as Error).message;
      throw new VaultError("INVALID_INPUT", `Could not download image from ${parsed.host}: ${reason}.`);
    }
    if (!response.ok) {
      throw new VaultError("INVALID_INPUT", `Could not download image from ${parsed.host}: HTTP ${response.status}.`);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_COMPANION_IMAGE_BYTES) {
      throw new VaultError("INVALID_INPUT", `Image is too large to display (${Math.round(declared / 1024 / 1024)} MB; limit 15 MB).`, 413);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(),
      nameHint: decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? ""),
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface CompanionImagePutInput {
  url?: string;
  dataBase64?: string;
  fileName?: string;
  alt?: string;
  /** Optional vault page; the image is stored in its .assets folder. */
  path?: string;
}

export interface CompanionImagePutResult {
  url: string;
  path: string;
  fileName: string;
  alt: string;
  mimeType: string;
  bytes: number;
  source: "download" | "generated";
  /** Paste this line into the chat reply to display the image inline. */
  markdown: string;
}

function escapeMarkdownAlt(alt: string): string {
  return alt.replace(/[\[\]\\]/g, (ch) => `\\${ch}`).replace(/\s+/g, " ").trim();
}

export async function putCompanionImage(input: CompanionImagePutInput): Promise<CompanionImagePutResult> {
  const hasUrl = typeof input.url === "string" && input.url.trim().length > 0;
  const hasData = typeof input.dataBase64 === "string" && input.dataBase64.trim().length > 0;
  if (hasUrl === hasData) {
    throw new VaultError("INVALID_INPUT", 'companion_image_put needs exactly one of "url" (download) or "dataBase64" (generated image).');
  }

  let buffer: Buffer;
  let nameHint = input.fileName?.trim() ?? "";
  let declaredType = "";
  if (hasUrl) {
    const downloaded = await downloadImage(input.url!.trim());
    buffer = downloaded.buffer;
    declaredType = downloaded.contentType;
    if (!nameHint) nameHint = downloaded.nameHint;
  } else {
    buffer = decodeImageBase64(input.dataBase64!);
  }

  if (buffer.length === 0) {
    throw new VaultError("INVALID_INPUT", "Could not display image: the image data is empty.");
  }
  if (buffer.length > MAX_COMPANION_IMAGE_BYTES) {
    throw new VaultError("INVALID_INPUT", "Image is too large to display (limit 15 MB).", 413);
  }

  const format = sniffImageFormat(buffer);
  if (!format) {
    const what = declaredType ? ` (server sent ${declaredType})` : "";
    throw new VaultError("INVALID_INPUT", `Could not display image: the data is not a PNG, JPEG, GIF, WebP, or SVG image${what}.`);
  }

  const ext = format.ext || MIME_TO_EXT[declaredType] || ".png";
  const fileName = `${sanitizeStem(nameHint || "companion-image")}${ext}`;
  const alt = (input.alt ?? "").trim() || sanitizeStem(fileName).replace(/[-_]+/g, " ");

  let url: string;
  let vaultPath: string;
  let storedName: string;
  if (input.path && input.path.trim()) {
    const asset = await uploadPageAsset(input.path.trim(), fileName, buffer);
    url = asset.url;
    vaultPath = asset.path;
    storedName = asset.fileName;
  } else {
    const month = new Date().toISOString().slice(0, 7);
    const dir = path.join(getVaultRoot(), COMPANION_IMAGE_DIR, month);
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    storedName = `${stamp}-${fileName}`;
    await fs.writeFile(path.join(dir, storedName), buffer);
    vaultPath = `${COMPANION_IMAGE_DIR}/${month}/${storedName}`;
    url = `/vault/${vaultPath.split("/").map(encodeURIComponent).join("/")}`;
  }

  return {
    url,
    path: vaultPath,
    fileName: storedName,
    alt,
    mimeType: format.mime,
    bytes: buffer.length,
    source: hasUrl ? "download" : "generated",
    markdown: `![${escapeMarkdownAlt(alt)}](<${url}>)`,
  };
}
