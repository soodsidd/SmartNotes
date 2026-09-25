import path from "node:path";
import { VaultError } from "./errors";
import { getVaultRoot } from "./config";
import {
  findPortableNotebookByPath,
  portableNotebookPath,
  resolvePortableRootForRelativePath,
} from "./notebook-registry";
import { isPageFileName, LEGACY_PAGE_FILE_EXTENSION, PAGE_FILE_EXTENSION } from "./page-format";

export function toVaultRelativePath(input: string) {
  return input.replaceAll("\\", "/").replace(/^\/+/, "");
}

/**
 * Canonicalize a raw page path supplied by an AI agent or external caller.
 *
 * Handles common agent mistakes:
 *   - Missing .html extension   → appended automatically
 *   - Legacy .md extension      → replaced with .html
 *   - Absolute path under the vault root → stripped to vault-relative
 *   - Windows backslashes       → forward slashes
 *   - Leading slashes           → stripped
 */
export function canonicalizePagePath(input: string): string {
  // Normalize separators and strip leading slashes first.
  let normalized = toVaultRelativePath(input).trim();

  // Strip absolute vault root prefix if the caller passed a full OS path.
  const vaultRoot = getVaultRoot();
  const vaultRootUnix = toVaultRelativePath(vaultRoot).replace(/\/$/, "");
  if (normalized.startsWith(`${vaultRootUnix}/`)) {
    normalized = normalized.slice(vaultRootUnix.length + 1);
  }

  // Canonicalize extension.
  const ext = path.posix.extname(normalized).toLowerCase();
  if (ext === LEGACY_PAGE_FILE_EXTENSION) {
    // Legacy .md → .html
    normalized = normalized.slice(0, -LEGACY_PAGE_FILE_EXTENSION.length) + PAGE_FILE_EXTENSION;
  } else if (ext === "") {
    // No extension at all — append .html so agents can omit it.
    normalized = normalized + PAGE_FILE_EXTENSION;
  }
  // Other extensions (e.g. .txt, .doc) are passed through unchanged and will fail
  // the PAGE_FILE_EXTENSION validation check in ensureSafeRelativePath.

  return normalized;
}

function ensureSafeRelativePath(input: string, kind: "page" | "section" | "notebook") {
  const relativePath = kind === "page"
    ? canonicalizePagePath(input)
    : toVaultRelativePath(input).trim();

  if (!relativePath) {
    throw new VaultError("INVALID_PATH", `Missing ${kind} path.`);
  }

  const segments = relativePath.split("/").filter(Boolean);
  if (!segments.length) {
    throw new VaultError("INVALID_PATH", `Missing ${kind} path.`);
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new VaultError("INVALID_PATH", "Path traversal is not allowed.");
  }

  if (kind === "page" && path.posix.extname(relativePath).toLowerCase() !== PAGE_FILE_EXTENSION) {
    throw new VaultError("INVALID_PATH", `Page files must use the ${PAGE_FILE_EXTENSION} extension.`);
  }

  if (kind === "notebook" && segments.length !== 1) {
    throw new VaultError("INVALID_PATH", "Notebook path must be a single directory name.");
  }

  return segments.join("/");
}

function resolvePhysicalRoot(relativePath: string) {
  const portableEntry = resolvePortableRootForRelativePath(relativePath);
  if (portableEntry) {
    return {
      vaultRoot: portableEntry.rootPath,
      portableEntry,
    };
  }

  return {
    vaultRoot: getVaultRoot(),
    portableEntry: null,
  };
}

export function resolveVaultPath(relativePath: string, kind: "page" | "section" | "notebook") {
  const safeRelativePath = ensureSafeRelativePath(relativePath, kind);
  const { vaultRoot, portableEntry } = resolvePhysicalRoot(safeRelativePath);

  if (portableEntry) {
    const portablePrefix = portableNotebookPath(portableEntry.id);
    if (
      safeRelativePath !== portablePrefix &&
      !safeRelativePath.startsWith(`${portablePrefix}/`)
    ) {
      throw new VaultError("INVALID_PATH", "Portable notebook path prefix mismatch.");
    }
  }

  let absolutePath: string;
  if (portableEntry) {
    const portablePrefix = portableNotebookPath(portableEntry.id);
    const remainder =
      safeRelativePath === portablePrefix
        ? ""
        : safeRelativePath.slice(portablePrefix.length + 1);
    absolutePath = remainder
      ? path.resolve(portableEntry.rootPath, ...remainder.split("/"))
      : portableEntry.rootPath;
  } else {
    absolutePath = path.resolve(vaultRoot, safeRelativePath);
  }

  const relativeToRoot = path.relative(vaultRoot, absolutePath);

  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new VaultError("INVALID_PATH", "Resolved path escapes the vault root.");
  }

  return {
    absolutePath,
    relativePath: safeRelativePath,
    vaultRoot,
    isPortable: Boolean(portableEntry),
    portableEntry,
  };
}

export function resolvePortableNotebookDirectory(notebookPath: string) {
  const safeNotebookPath = ensureSafeRelativePath(notebookPath, "notebook");
  const portableEntry = findPortableNotebookByPath(safeNotebookPath);
  if (!portableEntry) {
    throw new VaultError("NOTEBOOK_NOT_FOUND", `Portable notebook not found: ${safeNotebookPath}`, 404);
  }

  return {
    absolutePath: portableEntry.rootPath,
    relativePath: safeNotebookPath,
    vaultRoot: portableEntry.rootPath,
    isPortable: true as const,
    portableEntry,
  };
}

function slugifySegment(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
}

export function fileNameFromTitle(title: string) {
  const base = slugifySegment(title) || "untitled-page";
  return `${base}${PAGE_FILE_EXTENSION}`;
}

/**
 * Convert a human label (notebook or section name) to a filesystem-safe
 * directory name. Unlike fileNameFromTitle, this preserves the original
 * casing and spaces but strips characters that are unsafe on common OSes.
 */
export function dirNameFromLabel(label: string) {
  return (
    label
      .trim()
      // Remove characters illegal on Windows/macOS/Linux filesystems
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .replace(/\.+$/, "")
      .trim() || "Untitled"
  );
}

export function siblingAssetDirectory(pagePath: string) {
  return pagePath.replace(/\.html$/i, ".assets");
}

/** Working-directory folder for a Jupyter note (sibling to the .html stub). */
export function siblingJupyterDirectory(pagePath: string) {
  return pagePath.replace(/\.html$/i, ".jupyter");
}

export { isPageFileName, PAGE_FILE_EXTENSION };
