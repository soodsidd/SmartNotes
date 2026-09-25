/**
 * PDF attachment annotation sidecar I/O (SN-136).
 *
 * Stores EmbedPDF exportAnnotations() payloads beside the PDF asset as
 * `<file>.pdf.annotations.json`. Never writes into the PDF itself.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { VaultError } from "./errors";
import { resolveVaultPath, toVaultRelativePath } from "./paths";
import {
  buildPdfAnnotationSidecar,
  parsePdfAnnotationSidecar,
  pdfAnnotationSidecarPath,
  serializePdfAnnotationSidecar,
  type PdfAnnotationSidecar,
} from "@/lib/pdf-annotations";

async function renameFileAtomically(src: string, dest: string) {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EXDEV") {
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
          continue;
        }
        await fs.copyFile(src, dest);
        await fs.rm(src, { force: true });
        return;
      }
      throw err;
    }
  }
}

async function writeAtomically(targetPath: string, content: string) {
  const directory = path.dirname(targetPath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );
  await fs.writeFile(tempPath, content, "utf8");
  try {
    await renameFileAtomically(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizePdfAssetPath(pdfPath: string): string {
  const relative = toVaultRelativePath(pdfPath).trim();
  if (!relative) {
    throw new VaultError("INVALID_PATH", "Missing PDF path.");
  }
  if (relative.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new VaultError("INVALID_PATH", "Path traversal is not allowed.");
  }
  if (!relative.toLowerCase().endsWith(".pdf")) {
    throw new VaultError("INVALID_PATH", "PDF annotation path must end with .pdf.");
  }
  return relative;
}

/** Resolve a vault-relative PDF asset path; ensures the PDF file exists. */
export async function resolvePdfAssetFile(pdfPath: string) {
  const relativePath = normalizePdfAssetPath(pdfPath);
  const { absolutePath, vaultRoot } = resolveVaultPath(relativePath, "section");

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new VaultError("PAGE_NOT_FOUND", `PDF not found: ${relativePath}`, 404);
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new VaultError("INVALID_PATH", `PDF path is not a file: ${relativePath}`);
  }

  return {
    absolutePath,
    relativePath,
    vaultRoot,
    sidecarAbsolutePath: path.join(
      path.dirname(absolutePath),
      path.basename(pdfAnnotationSidecarPath(relativePath))
    ),
  };
}

export async function readPdfAnnotations(pdfPath: string): Promise<PdfAnnotationSidecar> {
  const { sidecarAbsolutePath } = await resolvePdfAssetFile(pdfPath);
  try {
    const raw = await fs.readFile(sidecarAbsolutePath, "utf8");
    return parsePdfAnnotationSidecar(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return buildPdfAnnotationSidecar([]);
    }
    throw error;
  }
}

export async function savePdfAnnotations(
  pdfPath: string,
  items: unknown
): Promise<PdfAnnotationSidecar> {
  const { sidecarAbsolutePath } = await resolvePdfAssetFile(pdfPath);
  const sidecar = buildPdfAnnotationSidecar(items);
  if (sidecar.items.length === 0) {
    await fs.rm(sidecarAbsolutePath, { force: true });
    return sidecar;
  }
  await writeAtomically(sidecarAbsolutePath, serializePdfAnnotationSidecar(sidecar));
  return sidecar;
}

/** SHA-256 of the PDF bytes — used to prove annotate+save never mutates the file. */
export async function hashPdfBytes(pdfPath: string): Promise<string> {
  const { absolutePath } = await resolvePdfAssetFile(pdfPath);
  const buffer = await fs.readFile(absolutePath);
  return createHash("sha256").update(buffer).digest("hex");
}
