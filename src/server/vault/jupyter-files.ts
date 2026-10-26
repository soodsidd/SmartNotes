/**
 * SN-387: module files in a vault Jupyter page's own `.jupyter` folder.
 *
 * Companion keeps real logic in modules beside notebook.ipynb (the managed
 * kernel live-imports them, see buildKernelConfig in
 * src/server/jupyter/runtime.ts). These two tools are the minimal surface for
 * that: list/read a file, and create or whole-file replace one. They reuse the
 * Deep Work source helpers (src/server/jupyter/workspace-files.ts), so the
 * same path policy, size bounds, strong revisions, and atomic writes apply,
 * with the page folder as the root. Notebooks stay on the jupyter_cell_* tools.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeDeepWorkRelativePath } from "@/lib/deep-work";
import {
  WORKSPACE_FILE_MAX_BYTES,
  createWorkspaceSource,
  listWorkspaceSources,
  readWorkspaceSource,
  writeWorkspaceSource,
  type WorkspaceSourceList,
  type WorkspaceSourceRead,
} from "@/server/jupyter/workspace-files";
import type { ProjectWorkspaceRequest } from "@/server/jupyter/workspace-root";
import { VaultError } from "./errors";
import { resolveJupyterNotebookFile } from "./jupyter-notebook";

export interface JupyterPageFileList extends WorkspaceSourceList {
  path: string;
  folder: string;
}

export interface JupyterPageFileRead extends WorkspaceSourceRead {
  /** Vault-relative Jupyter page path. */
  page: string;
  /** Vault-relative `.jupyter` folder. */
  folder: string;
}

export interface JupyterPageFileWrite extends Omit<JupyterPageFileRead, "source" | "truncated"> {
  created: boolean;
}

async function pageFolder(pagePath: string): Promise<{
  page: string;
  folder: string;
  request: ProjectWorkspaceRequest;
}> {
  const resolved = await resolveJupyterNotebookFile(pagePath);
  const absoluteFolder = path.dirname(resolved.absolutePath);
  const stat = await fs.lstat(absoluteFolder).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new VaultError(
      "NOTEBOOK_UNAVAILABLE",
      "This Jupyter page's working folder is missing. It may have been moved or deleted outside Smart Notes.",
      404
    );
  }
  return {
    page: resolved.page.path,
    folder: path.posix.dirname(resolved.relativePath),
    request: {
      // The real path keeps the root check exact even when the vault itself
      // sits behind a junction; the folder itself was checked above.
      rootPath: await fs.realpath(absoluteFolder),
      requestedAccess: "editable",
      // A vault page folder is vault-owned and always editable. The fixed
      // label only skips the git default-branch policy meant for owner-opened
      // repositories; it is never read from or written to disk.
      branch: "smart-notes-jupyter-page",
      isDefaultBranch: false,
    },
  };
}

function requireFile(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new VaultError("INVALID_INPUT", '"file" must be a path relative to the page\'s .jupyter folder.');
  }
  return value;
}

/** List the page folder (file omitted) or read one UTF-8 file with its strong revision. */
export async function readJupyterPageFile(input: {
  path: string;
  file?: unknown;
  maxBytes?: unknown;
  maxCount?: unknown;
}): Promise<JupyterPageFileList | JupyterPageFileRead> {
  const { page, folder, request } = await pageFolder(input.path);
  if (input.file === undefined) {
    const listed = await listWorkspaceSources(request, input.maxCount);
    return { path: page, folder, ...listed };
  }
  const read = await readWorkspaceSource(
    request,
    requireFile(input.file),
    input.maxBytes === undefined ? undefined : (input.maxBytes as number)
  );
  return { ...read, page, folder };
}

/**
 * Create a new file (missing parent directories included) or replace an
 * existing one in full. Replacing requires the expectedRevision from
 * jupyter_file_read or the previous write, so an owner edit is never
 * overwritten blindly. `.ipynb` files are refused: notebooks change only
 * through the cell tools.
 */
export async function writeJupyterPageFile(input: {
  path: string;
  file: unknown;
  source: unknown;
  expectedRevision?: unknown;
}): Promise<JupyterPageFileWrite> {
  const file = requireFile(input.file);
  const normalized = normalizeDeepWorkRelativePath(file);
  if (normalized && path.posix.extname(normalized).toLowerCase() === ".ipynb") {
    throw new VaultError(
      "JUPYTER_FILE_NOTEBOOK",
      "Notebooks are edited only with jupyter_cell_create/edit/reorder/delete; jupyter_file_write is for module and data files.",
      400
    );
  }
  if (typeof input.source !== "string") {
    throw new VaultError("INVALID_INPUT", '"source" must be the full file text.');
  }
  const { page, folder, request } = await pageFolder(input.path);

  if (input.expectedRevision === undefined) {
    try {
      const created = await createWorkspaceSource(request, file, input.source);
      return { path: created.path, revision: created.revision, size: created.size, page, folder, created: true };
    } catch (error) {
      if (error instanceof VaultError && error.code === "WORKSPACE_FILE_EXISTS") {
        throw new VaultError(
          "JUPYTER_FILE_EXISTS",
          `${file} already exists. Read it with jupyter_file_read and pass its revision as expectedRevision to replace it.`,
          409
        );
      }
      throw error;
    }
  }

  // Whole-file replacement: one edit spanning the current text, guarded by
  // the strong revision inside writeWorkspaceSource.
  const current = await readWorkspaceSource(request, file).catch((error: unknown) => {
    if (error instanceof VaultError && error.code === "WORKSPACE_FILE_MISSING") {
      throw new VaultError(
        "JUPYTER_FILE_MISSING",
        `${file} does not exist. Omit expectedRevision to create it.`,
        404
      );
    }
    throw error;
  });
  if (current.size > WORKSPACE_FILE_MAX_BYTES) {
    throw new VaultError("WORKSPACE_FILE_TOO_LARGE", "The file is too large to replace.", 413);
  }
  const currentLength = current.truncated
    ? (await fs.readFile(path.join(request.rootPath, ...current.path.split("/")), "utf8")).length
    : current.source.length;
  const written = await writeWorkspaceSource(request, file, input.expectedRevision, [
    { start: 0, end: currentLength, text: input.source },
  ]);
  return { path: written.path, revision: written.revision, size: written.size, page, folder, created: false };
}
