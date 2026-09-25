import fs from "node:fs/promises";
import path from "node:path";
import { VaultError } from "./errors";
import { resolveVaultPath, siblingAssetDirectory, toVaultRelativePath } from "./paths";
import { readPage } from "./pages";

const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([...ALLOWED_IMAGE_EXTENSIONS, ".pdf"]);

function sanitizeFileName(fileName: string) {
  const base = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return base || "upload";
}

async function uniqueFileName(directory: string, fileName: string) {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension) || "file";
  let attempt = 0;

  while (true) {
    const candidate = attempt === 0 ? fileName : `${stem}-${attempt + 1}${extension}`;
    const candidatePath = path.join(directory, candidate);
    const exists = await fs.stat(candidatePath).then(() => true).catch(() => false);
    if (!exists) {
      return candidate;
    }
    attempt += 1;
  }
}

export async function uploadPageAsset(
  pagePath: string,
  fileName: string,
  buffer: Buffer,
  options?: { overwrite?: boolean }
) {
  await readPage(pagePath);

  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new VaultError(
      "INVALID_PATH",
      "Unsupported file type. Allowed: images and PDF."
    );
  }

  const assetsRelative = siblingAssetDirectory(pagePath);
  const { absolutePath: assetsDir } = resolveVaultPath(assetsRelative, "section");
  await fs.mkdir(assetsDir, { recursive: true });

  const safeName = sanitizeFileName(fileName);
  const storedName =
    options?.overwrite === true
      ? safeName
      : await uniqueFileName(assetsDir, safeName);
  await fs.writeFile(path.join(assetsDir, storedName), buffer);

  const vaultRelative = toVaultRelativePath(path.posix.join(assetsRelative, storedName));
  const url = `/vault/${vaultRelative.split("/").map(encodeURIComponent).join("/")}`;

  return {
    url,
    path: vaultRelative,
    fileName: storedName,
    isImage: ALLOWED_IMAGE_EXTENSIONS.has(extension),
  };
}
