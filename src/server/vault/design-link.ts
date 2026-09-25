/**
 * Linked design pages (SN-168).
 *
 * An existing self-contained `.html` file inside a registered portable-notebook
 * root can be linked in place. Smart Notes stores display/path metadata in a
 * sibling `.design-link.json` sidecar and never copies or frontmatter-wraps the
 * HTML — the ordinary file remains the single ground truth.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { VaultError } from "./errors";
import {
  loadNotebookRegistry,
  portableNotebookPath,
  type PortableNotebookEntry,
} from "./notebook-registry";
import { PAGE_FILE_EXTENSION } from "./page-format";
import { toVaultRelativePath } from "./paths";
import type { FrontmatterData } from "./types";

export const DESIGN_LINK_SIDECAR_VERSION = 1 as const;

export interface DesignLinkSidecar {
  version: typeof DESIGN_LINK_SIDECAR_VERSION;
  note_type: "design";
  linked: true;
  title: string;
  created: string;
  updated: string;
  /** Absolute OS path of the linked HTML at link/relink time (informational). */
  sourcePath: string;
  /** SN-229: key-note marker. Omitted when false so the sidecar stays clean. */
  key_note?: boolean;
}

export interface ResolvedDesignLinkTarget {
  absolutePath: string;
  relativePath: string;
  portableEntry: PortableNotebookEntry;
  fileName: string;
}

function isPathInsideRoot(candidate: string, root: string) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Find the registered portable notebook whose root contains `absolutePath`. */
export function findPortableNotebookContainingPath(
  absolutePath: string,
  stateDir?: string
): PortableNotebookEntry | null {
  const resolved = path.resolve(absolutePath);
  let best: PortableNotebookEntry | null = null;
  let bestRootLength = -1;

  for (const entry of loadNotebookRegistry(stateDir).notebooks) {
    const root = path.resolve(entry.rootPath);
    if (!isPathInsideRoot(resolved, root)) continue;
    if (root.length > bestRootLength) {
      best = entry;
      bestRootLength = root.length;
    }
  }

  return best;
}

/**
 * Resolve and validate an absolute `.html` path for linking. Rejects traversal,
 * non-html files, and paths outside every registered portable-notebook root.
 */
export async function resolveDesignLinkTarget(
  sourcePathInput: string,
  stateDir?: string
): Promise<ResolvedDesignLinkTarget> {
  const trimmed = String(sourcePathInput ?? "").trim();
  if (!trimmed) {
    throw new VaultError("INVALID_PATH", "A source HTML path is required to link a design.", 400);
  }

  const absolutePath = path.resolve(trimmed);
  if (absolutePath.includes("\0")) {
    throw new VaultError("INVALID_PATH", "Invalid source path.", 400);
  }

  const extension = path.extname(absolutePath).toLowerCase();
  if (extension !== PAGE_FILE_EXTENSION) {
    throw new VaultError(
      "INVALID_PATH",
      `Linked designs must be self-contained ${PAGE_FILE_EXTENSION} files.`,
      400
    );
  }

  const portableEntry = findPortableNotebookContainingPath(absolutePath, stateDir);
  if (!portableEntry) {
    throw new VaultError(
      "INVALID_PATH",
      "Linked designs must resolve inside a registered portable-notebook root.",
      400
    );
  }

  const root = path.resolve(portableEntry.rootPath);
  const relativeToRoot = path.relative(root, absolutePath);
  if (
    !relativeToRoot ||
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot) ||
    relativeToRoot.split(path.sep).some((segment) => segment === ".." || segment === ".")
  ) {
    throw new VaultError("INVALID_PATH", "Path traversal is not allowed for linked designs.", 400);
  }

  // Vault tree only discovers pages at notebook root or one section deep.
  const posixRemainder = relativeToRoot.split(path.sep).join("/");
  const segments = posixRemainder.split("/").filter(Boolean);
  if (segments.length < 1 || segments.length > 2) {
    throw new VaultError(
      "INVALID_PATH",
      "Linked design HTML must live at the portable notebook root or directly inside one section folder.",
      400
    );
  }

  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new VaultError("PAGE_NOT_FOUND", `Design source not found: ${absolutePath}`, 404);
  }

  const relativePath = toVaultRelativePath(
    path.posix.join(portableNotebookPath(portableEntry.id), posixRemainder)
  );

  return {
    absolutePath,
    relativePath,
    portableEntry,
    fileName: path.basename(absolutePath),
  };
}

export function designLinkSidecarAbsolutePath(htmlAbsolutePath: string) {
  return htmlAbsolutePath.replace(/\.html$/i, ".design-link.json");
}

export function isDesignLinkSidecar(data: unknown): data is DesignLinkSidecar {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const sidecar = data as Partial<DesignLinkSidecar>;
  return (
    sidecar.version === DESIGN_LINK_SIDECAR_VERSION &&
    sidecar.note_type === "design" &&
    sidecar.linked === true &&
    typeof sidecar.title === "string" &&
    typeof sidecar.created === "string" &&
    typeof sidecar.updated === "string" &&
    typeof sidecar.sourcePath === "string"
  );
}

export async function readDesignLinkSidecar(
  htmlAbsolutePath: string
): Promise<DesignLinkSidecar | null> {
  const sidecarPath = designLinkSidecarAbsolutePath(htmlAbsolutePath);
  try {
    const raw = await fs.readFile(sidecarPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isDesignLinkSidecar(parsed) ? parsed : null;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeDesignLinkSidecar(
  htmlAbsolutePath: string,
  sidecar: DesignLinkSidecar
): Promise<void> {
  const sidecarPath = designLinkSidecarAbsolutePath(htmlAbsolutePath);
  const payload = `${JSON.stringify(sidecar, null, 2)}\n`;
  const directory = path.dirname(sidecarPath);
  const tempPath = path.join(
    directory,
    `.${path.basename(sidecarPath)}.${process.pid}.${Date.now()}.tmp`
  );
  await fs.writeFile(tempPath, payload, "utf8");
  try {
    await fs.rename(tempPath, sidecarPath);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EXDEV") {
      await fs.copyFile(tempPath, sidecarPath);
      await fs.rm(tempPath, { force: true });
      return;
    }
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeDesignLinkSidecar(htmlAbsolutePath: string): Promise<void> {
  await fs.rm(designLinkSidecarAbsolutePath(htmlAbsolutePath), { force: true });
}

/** Pull a display title from a `<title>` tag when present. */
export function titleFromHtmlArtifact(html: string, fallbackFileName: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const fromTag = match?.[1]?.replace(/\s+/g, " ").trim();
  if (fromTag) return fromTag;

  const stem = fallbackFileName.replace(/\.html$/i, "");
  return (
    stem
      .split(/[-_]/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Linked design"
  );
}

export function designLinkMetadataFromSidecar(sidecar: DesignLinkSidecar): FrontmatterData {
  return {
    title: sidecar.title,
    created: sidecar.created,
    updated: sidecar.updated,
    note_type: "design",
    design_linked: true,
    design_source_path: sidecar.sourcePath,
    ...(sidecar.key_note === true ? { key_note: true } : {}),
  };
}

export function vaultRelativeDesignLinkSidecarPath(pagePath: string) {
  return pagePath.replace(/\.html$/i, ".design-link.json");
}
