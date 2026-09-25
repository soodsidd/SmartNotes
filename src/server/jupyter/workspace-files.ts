import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  normalizeDeepWorkRelativePath,
  workspacePathBlockReason,
} from "@/lib/deep-work";
import {
  atomicReplaceFile,
  isUtf16Boundary,
  withFileMutation,
} from "@/server/atomic-file";
import {
  resolveProjectWorkspace,
  type ProjectWorkspaceRequest,
  type ResolvedProjectWorkspace,
} from "@/server/jupyter/workspace-root";
import { VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

export const WORKSPACE_FILE_MAX_BYTES = 1024 * 1024;
export const WORKSPACE_READ_MAX_BYTES = 64 * 1024;
export const WORKSPACE_EDIT_MAX_COUNT = 64;
export const WORKSPACE_REPLACEMENT_MAX_BYTES = 64 * 1024;
export const WORKSPACE_CREATE_MAX_BYTES = 64 * 1024;
export const WORKSPACE_LIST_DEFAULT_COUNT = 200;
export const WORKSPACE_LIST_MAX_COUNT = 500;
export const WORKSPACE_LIST_MAX_DEPTH = 16;
export const WORKSPACE_LIST_MAX_SCANNED_ENTRIES = 5_000;

export interface WorkspaceSourceEdit {
  start: number;
  end: number;
  text: string;
}

export interface WorkspaceSourceRead {
  path: string;
  source: string;
  revision: string;
  size: number;
  truncated: boolean;
}

export interface WorkspaceSourceListEntry {
  path: string;
  size: number;
}

export interface WorkspaceSourceList {
  files: WorkspaceSourceListEntry[];
  count: number;
  limit: number;
  truncated: boolean;
}

function revision(bytes: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeText(bytes: Buffer): string {
  if (bytes.includes(0)) {
    throw new VaultError("WORKSPACE_BINARY_FILE", "Binary files are not available to workspace source tools.", 415);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new VaultError("WORKSPACE_BINARY_FILE", "The file is not valid UTF-8 text.", 415);
  }
}

async function resolveWorkspacePath(
  request: ProjectWorkspaceRequest,
  relativeValue: unknown
): Promise<{ workspace: ResolvedProjectWorkspace; relativePath: string; absolutePath: string }> {
  const relativePath = normalizeDeepWorkRelativePath(relativeValue);
  const blockReason = workspacePathBlockReason(relativeValue);
  if (!relativePath || blockReason) {
    throw new VaultError("WORKSPACE_PATH_BLOCKED", blockReason ?? "Invalid workspace-relative path.", 403);
  }
  const workspace = await resolveProjectWorkspace(request);
  const absolutePath = path.resolve(workspace.realRoot, ...relativePath.split("/"));
  const relativeCheck = path.relative(workspace.realRoot, absolutePath);
  if (!relativeCheck || relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
    throw new VaultError("WORKSPACE_PATH_ESCAPE", "Workspace source paths must stay beneath the chosen root.", 403);
  }

  return { workspace, relativePath, absolutePath };
}

async function resolveFile(
  request: ProjectWorkspaceRequest,
  relativeValue: unknown
): Promise<{ workspace: ResolvedProjectWorkspace; relativePath: string; absolutePath: string }> {
  const resolved = await resolveWorkspacePath(request, relativeValue);
  // Existing path segments must be ordinary directories/files, never symlinks
  // or junctions that can escape the chosen root.
  let walked = resolved.workspace.realRoot;
  for (const segment of resolved.relativePath.split("/")) {
    walked = path.join(walked, segment);
    const stat = await fs.lstat(walked).catch(() => null);
    if (!stat) throw new VaultError("WORKSPACE_FILE_MISSING", `Workspace file does not exist: ${resolved.relativePath}`, 404);
    if (stat.isSymbolicLink()) {
      throw new VaultError("WORKSPACE_SYMLINK_ESCAPE", "Workspace source tools do not follow symlinks.", 403);
    }
  }
  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isFile()) throw new VaultError("WORKSPACE_NOT_FILE", "Workspace source reads require one regular file.", 400);
  if (typeof stat.nlink === "number" && stat.nlink > 1) {
    throw new VaultError("WORKSPACE_HARD_LINK_BLOCKED", "Workspace source tools do not read or replace multiply-linked files.", 403);
  }
  if (stat.size > WORKSPACE_FILE_MAX_BYTES) {
    throw new VaultError(
      "WORKSPACE_FILE_TOO_LARGE",
      `Workspace source files may not exceed ${WORKSPACE_FILE_MAX_BYTES} bytes.`,
      413
    );
  }
  return resolved;
}

function parseListLimit(value: unknown): number {
  const limit = value === undefined ? WORKSPACE_LIST_DEFAULT_COUNT : value;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > WORKSPACE_LIST_MAX_COUNT) {
    throw new VaultError(
      "INVALID_WORKSPACE_LIST_LIMIT",
      `maxCount must be between 1 and ${WORKSPACE_LIST_MAX_COUNT}.`
    );
  }
  return limit as number;
}

export async function listWorkspaceSources(
  request: ProjectWorkspaceRequest,
  maxCount?: unknown
): Promise<WorkspaceSourceList> {
  const limit = parseListLimit(maxCount);
  const workspace = await resolveProjectWorkspace(request);
  const files: WorkspaceSourceListEntry[] = [];
  const directories: Array<{ absolutePath: string; relativePath: string; depth: number }> = [{
    absolutePath: workspace.realRoot,
    relativePath: "",
    depth: 0,
  }];
  let scanned = 0;
  let truncated = false;

  while (directories.length > 0 && files.length <= limit) {
    const current = directories.shift()!;
    const entries = (await fs.readdir(current.absolutePath, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      scanned += 1;
      if (scanned > WORKSPACE_LIST_MAX_SCANNED_ENTRIES) {
        truncated = true;
        break;
      }
      const relativePath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name;
      if (workspacePathBlockReason(relativePath)) continue;
      const absolutePath = path.join(current.absolutePath, entry.name);
      const stat = await fs.lstat(absolutePath).catch(() => null);
      if (!stat || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (current.depth >= WORKSPACE_LIST_MAX_DEPTH) {
          truncated = true;
        } else {
          directories.push({ absolutePath, relativePath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!stat.isFile() || stat.size > WORKSPACE_FILE_MAX_BYTES || (typeof stat.nlink === "number" && stat.nlink > 1)) {
        continue;
      }
      files.push({ path: relativePath.replace(/\\/g, "/"), size: stat.size });
      if (files.length > limit) {
        truncated = true;
        break;
      }
    }
    if (scanned > WORKSPACE_LIST_MAX_SCANNED_ENTRIES) break;
  }

  const bounded = files.slice(0, limit);
  return { files: bounded, count: bounded.length, limit, truncated };
}

export async function readWorkspaceSource(
  request: ProjectWorkspaceRequest,
  relativePath: unknown,
  maxBytes = WORKSPACE_READ_MAX_BYTES
): Promise<WorkspaceSourceRead> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > WORKSPACE_READ_MAX_BYTES) {
    throw new VaultError("INVALID_WORKSPACE_READ_LIMIT", `maxBytes must be between 1 and ${WORKSPACE_READ_MAX_BYTES}.`);
  }
  const resolved = await resolveFile(request, relativePath);
  const bytes = await fs.readFile(resolved.absolutePath);
  const source = decodeText(bytes);
  const bounded = Buffer.from(source, "utf8").subarray(0, maxBytes);
  // Avoid returning a partial UTF-8 character at the truncation edge.
  const boundedSource = new TextDecoder("utf-8", { fatal: false }).decode(bounded).replace(/\uFFFD$/, "");
  return {
    path: resolved.relativePath,
    source: boundedSource,
    revision: revision(bytes),
    size: bytes.length,
    truncated: bytes.length > maxBytes,
  };
}

function validateCreateSource(relativePath: string, value: unknown): Buffer {
  if (typeof value !== "string" || value.includes("\u0000")) {
    throw new VaultError("INVALID_WORKSPACE_SOURCE", "New workspace source must be UTF-8 text.");
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > WORKSPACE_CREATE_MAX_BYTES) {
    throw new VaultError(
      "WORKSPACE_CREATE_TOO_LARGE",
      `New workspace source may not exceed ${WORKSPACE_CREATE_MAX_BYTES} bytes.`,
      413
    );
  }
  if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== value) {
    throw new VaultError("INVALID_WORKSPACE_SOURCE", "New workspace source must be valid UTF-8 text.");
  }
  if (path.posix.extname(relativePath).toLowerCase() === ".ipynb") {
    let notebook: unknown;
    try {
      notebook = JSON.parse(value);
    } catch {
      throw new VaultError("INVALID_WORKSPACE_NOTEBOOK", "New .ipynb source must be valid JSON.", 422);
    }
    if (!notebook || typeof notebook !== "object" || Array.isArray(notebook)) {
      throw new VaultError("INVALID_WORKSPACE_NOTEBOOK", "New .ipynb source must be a notebook object.", 422);
    }
    const record = notebook as Record<string, unknown>;
    const metadata = record.metadata;
    const cells = record.cells;
    if (
      record.nbformat !== 4 ||
      !Number.isInteger(record.nbformat_minor) ||
      (record.nbformat_minor as number) < 0 ||
      !metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      !Array.isArray(cells) || cells.length > 1_000
    ) {
      throw new VaultError(
        "INVALID_WORKSPACE_NOTEBOOK",
        "New .ipynb source must be a bounded nbformat v4 notebook.",
        422
      );
    }
    for (const cell of cells) {
      if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
        throw new VaultError("INVALID_WORKSPACE_NOTEBOOK", "Every notebook cell must be an object.", 422);
      }
      const parsed = cell as Record<string, unknown>;
      if (
        (parsed.cell_type !== "code" && parsed.cell_type !== "markdown" && parsed.cell_type !== "raw") ||
        !parsed.metadata || typeof parsed.metadata !== "object" || Array.isArray(parsed.metadata) ||
        !(typeof parsed.source === "string" || (
          Array.isArray(parsed.source) && parsed.source.every((line) => typeof line === "string")
        ))
      ) {
        throw new VaultError("INVALID_WORKSPACE_NOTEBOOK", "Notebook cells must have valid type, metadata, and source.", 422);
      }
      if (
        parsed.cell_type === "code" &&
        (!Array.isArray(parsed.outputs) || !(
          parsed.execution_count === null || Number.isInteger(parsed.execution_count)
        ))
      ) {
        throw new VaultError(
          "INVALID_WORKSPACE_NOTEBOOK",
          "Code cells must include outputs and a valid execution_count.",
          422
        );
      }
    }
  }
  return bytes;
}

async function resolveCreateTarget(
  request: ProjectWorkspaceRequest,
  relativeValue: unknown
): Promise<{ workspace: ResolvedProjectWorkspace; relativePath: string; absolutePath: string }> {
  const resolved = await resolveWorkspacePath(request, relativeValue);
  if (resolved.workspace.accessMode !== "editable") {
    throw new VaultError("WORKSPACE_READ_ONLY", "This workspace is read-only.", 403);
  }
  const segments = resolved.relativePath.split("/");
  let parent = resolved.workspace.realRoot;
  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment);
    const stat = await fs.lstat(parent).catch(() => null);
    if (!stat) {
      throw new VaultError("WORKSPACE_PARENT_MISSING", "The destination directory does not exist.", 404);
    }
    if (stat.isSymbolicLink()) {
      throw new VaultError("WORKSPACE_SYMLINK_ESCAPE", "Workspace source tools do not follow symlinks.", 403);
    }
    if (!stat.isDirectory()) {
      throw new VaultError("WORKSPACE_PARENT_NOT_DIRECTORY", "The destination parent is not a directory.");
    }
  }
  const realParent = await fs.realpath(parent);
  const parentCheck = path.relative(resolved.workspace.realRoot, realParent);
  if (parentCheck.startsWith("..") || path.isAbsolute(parentCheck)) {
    throw new VaultError("WORKSPACE_SYMLINK_ESCAPE", "Workspace source tools do not follow paths outside the root.", 403);
  }
  return resolved;
}

/**
 * SN-270: announce a Deep Work workspace write so an embedded Jupyter surface
 * rooted at the same folder can refresh the affected document in place.
 *
 * Only the server-resolved real root, the root-relative path, and the new
 * revision travel; the capability that authorized the write never does. The
 * event is advisory - a missing listener changes nothing about the write.
 */
function announceWorkspaceSourceWrite(rootPath: string, result: WorkspaceSourceRead): void {
  emitVaultSideEffects({
    workspaceSourceUpdated: { rootPath, path: result.path, revision: result.revision },
  });
}

export async function createWorkspaceSource(
  request: ProjectWorkspaceRequest,
  relativePath: unknown,
  source: unknown
): Promise<WorkspaceSourceRead> {
  const resolved = await resolveCreateTarget(request, relativePath);
  const bytes = validateCreateSource(resolved.relativePath, source);

  const created = await withFileMutation(resolved.absolutePath, async () => {
    const existing = await fs.lstat(resolved.absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) {
      throw new VaultError("WORKSPACE_FILE_EXISTS", "Workspace source creation never overwrites an existing path.", 409);
    }

    const temporaryPath = path.join(
      path.dirname(resolved.absolutePath),
      `.${path.basename(resolved.absolutePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      const handle = await fs.open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        // Linking a fully-written temporary file publishes the destination in
        // one create-only filesystem operation and cannot replace an existing path.
        await fs.link(temporaryPath, resolved.absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new VaultError("WORKSPACE_FILE_EXISTS", "Workspace source creation never overwrites an existing path.", 409);
        }
        throw error;
      }
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }

    return {
      path: resolved.relativePath,
      source: source as string,
      revision: revision(bytes),
      size: bytes.length,
      truncated: false,
    };
  });
  announceWorkspaceSourceWrite(resolved.workspace.realRoot, created);
  return created;
}

function validateEdits(edits: unknown, sourceLength: number): WorkspaceSourceEdit[] {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > WORKSPACE_EDIT_MAX_COUNT) {
    throw new VaultError("INVALID_WORKSPACE_EDITS", `Supply 1-${WORKSPACE_EDIT_MAX_COUNT} bounded edits.`);
  }
  const parsed = edits.map((value): WorkspaceSourceEdit => {
    if (!value || typeof value !== "object") {
      throw new VaultError("INVALID_WORKSPACE_EDIT", "Every workspace edit must be an object.");
    }
    const edit = value as Record<string, unknown>;
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      (edit.start as number) < 0 ||
      (edit.end as number) < (edit.start as number) ||
      (edit.end as number) > sourceLength ||
      typeof edit.text !== "string"
    ) {
      throw new VaultError("INVALID_WORKSPACE_EDIT", "Workspace edit ranges are out of bounds.");
    }
    return { start: edit.start as number, end: edit.end as number, text: edit.text };
  }).sort((a, b) => a.start - b.start || a.end - b.end);

  const replacementBytes = parsed.reduce((sum, edit) => sum + Buffer.byteLength(edit.text, "utf8"), 0);
  if (replacementBytes > WORKSPACE_REPLACEMENT_MAX_BYTES) {
    throw new VaultError("WORKSPACE_EDITS_TOO_LARGE", "Workspace replacement text exceeds 64 KiB.", 413);
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index]!.start < parsed[index - 1]!.end) {
      throw new VaultError("WORKSPACE_EDITS_OVERLAP", "Workspace edit ranges must not overlap.");
    }
  }
  return parsed;
}

export async function writeWorkspaceSource(
  request: ProjectWorkspaceRequest,
  relativePath: unknown,
  expectedRevision: unknown,
  edits: unknown
): Promise<WorkspaceSourceRead> {
  if (typeof expectedRevision !== "string" || !/^sha256:[a-f0-9]{64}$/.test(expectedRevision)) {
    throw new VaultError("INVALID_WORKSPACE_REVISION", "A strong expectedRevision is required.");
  }
  const resolved = await resolveFile(request, relativePath);
  if (resolved.workspace.accessMode !== "editable") {
    throw new VaultError("WORKSPACE_READ_ONLY", "This workspace is read-only.", 403);
  }

  const written = await withFileMutation(resolved.absolutePath, async () => {
    // The final revision check and replacement are serialized for this server
    // process. External writers can still race the filesystem after the check.
    const currentBytes = await fs.readFile(resolved.absolutePath);
    const currentRevision = revision(currentBytes);
    if (currentRevision !== expectedRevision) {
      throw new VaultError("WORKSPACE_REVISION_CONFLICT", "Workspace file changed after it was read.", 409);
    }
    const source = decodeText(currentBytes);
    const parsed = validateEdits(edits, source.length);
    for (const edit of parsed) {
      if (!isUtf16Boundary(source, edit.start) || !isUtf16Boundary(source, edit.end)) {
        throw new VaultError(
          "INVALID_WORKSPACE_EDIT",
          "Workspace edit offsets are UTF-16 code units and may not split a surrogate pair."
        );
      }
    }
    let next = source;
    for (const edit of [...parsed].sort((a, b) => b.start - a.start)) {
      next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    }
    const nextBytes = Buffer.from(next, "utf8");
    if (nextBytes.length > WORKSPACE_FILE_MAX_BYTES) {
      throw new VaultError("WORKSPACE_FILE_TOO_LARGE", "The edited workspace file would exceed 1 MiB.", 413);
    }
    const originalStat = await fs.stat(resolved.absolutePath);
    if (typeof originalStat.nlink === "number" && originalStat.nlink > 1) {
      throw new VaultError("WORKSPACE_HARD_LINK_BLOCKED", "Workspace source tools do not replace multiply-linked files.", 403);
    }
    await atomicReplaceFile(resolved.absolutePath, nextBytes, {
      mode: originalStat.mode,
      beforeReplace: async () => {
        const beforeRename = await fs.readFile(resolved.absolutePath);
        if (revision(beforeRename) !== expectedRevision) {
          throw new VaultError("WORKSPACE_REVISION_CONFLICT", "Workspace file changed while the edit was being applied.", 409);
        }
      },
    });

    return {
      path: resolved.relativePath,
      source: nextBytes.length > WORKSPACE_READ_MAX_BYTES
        ? new TextDecoder().decode(nextBytes.subarray(0, WORKSPACE_READ_MAX_BYTES)).replace(/\uFFFD$/, "")
        : next,
      revision: revision(nextBytes),
      size: nextBytes.length,
      truncated: nextBytes.length > WORKSPACE_READ_MAX_BYTES,
    };
  });
  announceWorkspaceSourceWrite(resolved.workspace.realRoot, written);
  return written;
}
