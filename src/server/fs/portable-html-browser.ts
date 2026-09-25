/**
 * In-app HTML file browser scoped to registered portable-notebook roots (SN-168).
 * Prefer this over the native WinForms picker for Inspect / phone / remote UI —
 * the OS dialog opens on the host and appears to "do nothing" from the client.
 */
import fs from "node:fs";
import path from "node:path";
import {
  findPortableNotebookContainingPath,
  type ResolvedDesignLinkTarget,
} from "@/server/vault/design-link";
import { VaultError } from "@/server/vault/errors";
import { loadNotebookRegistry } from "@/server/vault/notebook-registry";
import { PAGE_FILE_EXTENSION } from "@/server/vault/page-format";

export interface PortableHtmlRoot {
  id: string;
  label: string;
  path: string;
}

export interface PortableHtmlEntry {
  name: string;
  path: string;
}

export interface PortableHtmlListing {
  path: string;
  parentPath: string | null;
  portableRoot: string;
  portableNotebookId: string;
  roots: PortableHtmlRoot[];
  folders: PortableHtmlEntry[];
  files: PortableHtmlEntry[];
}

function isPathInsideRoot(candidate: string, root: string) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function listPortableRoots(stateDir?: string): PortableHtmlRoot[] {
  return loadNotebookRegistry(stateDir)
    .notebooks.map((entry) => ({
      id: entry.id,
      label: entry.name,
      path: path.resolve(entry.rootPath),
    }))
    .filter((root) => {
      const stat = fs.statSync(root.path, { throwIfNoEntry: false });
      return Boolean(stat?.isDirectory());
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

function resolveListingDirectory(inputPath: string | undefined, stateDir?: string) {
  const roots = listPortableRoots(stateDir);
  if (roots.length === 0) {
    throw new VaultError(
      "INVALID_PATH",
      "Register a portable (remote) notebook before linking an HTML design.",
      400
    );
  }

  const trimmed = String(inputPath ?? "").trim();
  const candidate = path.resolve(trimmed || roots[0].path);
  const portable = findPortableNotebookContainingPath(candidate, stateDir);
  if (!portable) {
    throw new VaultError(
      "INVALID_PATH",
      "Browse only inside a registered portable-notebook root.",
      400
    );
  }

  const root = path.resolve(portable.rootPath);
  const stat = fs.statSync(candidate, { throwIfNoEntry: false });
  if (!stat) {
    throw new VaultError("SERVER_FOLDER_NOT_FOUND", `Folder not found: ${candidate}`, 404);
  }

  const directory = stat.isDirectory() ? candidate : path.dirname(candidate);
  if (!isPathInsideRoot(directory, root)) {
    throw new VaultError(
      "INVALID_PATH",
      "Browse only inside a registered portable-notebook root.",
      400
    );
  }

  const dirStat = fs.statSync(directory, { throwIfNoEntry: false });
  if (!dirStat?.isDirectory()) {
    throw new VaultError("INVALID_PATH", `Server path is not a folder: ${directory}`, 400);
  }

  return { directory, portable, root, roots };
}

/**
 * List folders + `.html` files under a path constrained to portable-notebook roots.
 */
export function listPortableHtmlBrowser(
  inputPath?: string,
  stateDir?: string
): PortableHtmlListing {
  const { directory, portable, root, roots } = resolveListingDirectory(inputPath, stateDir);

  let folders: PortableHtmlEntry[] = [];
  let files: PortableHtmlEntry[] = [];
  try {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    folders = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        path: path.join(directory, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    files = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          path.extname(entry.name).toLowerCase() === PAGE_FILE_EXTENSION &&
          !entry.name.toLowerCase().endsWith(".design-link.json")
      )
      .map((entry) => ({
        name: entry.name,
        path: path.join(directory, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read folder.";
    throw new VaultError("SERVER_FOLDER_UNREADABLE", message, 403);
  }

  const parentCandidate = path.dirname(directory);
  const parentPath =
    parentCandidate !== directory && isPathInsideRoot(parentCandidate, root)
      ? parentCandidate
      : null;

  return {
    path: directory,
    parentPath,
    portableRoot: root,
    portableNotebookId: portable.id,
    roots,
    folders,
    files,
  };
}

/** Re-export resolve helper for callers that already validated via the browser. */
export type { ResolvedDesignLinkTarget };
