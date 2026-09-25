import fs from "node:fs/promises";
import path from "node:path";

import { VaultError } from "@/server/vault/errors";

// ---------------------------------------------------------------------------
// Project-backed JupyterLab workspace roots (SN-256)
//
// A project workspace points an embedded JupyterLab server directly at an
// Ascent Vector project or worktree folder instead of a note-owned `.jupyter`
// folder. Because this opens a host directory *in place* (no copy into the
// vault), every request is validated against two independent boundaries before
// a server is ever spawned:
//
//   1. Root validity  — the owner-selected root must be an absolute, existing
//      directory. The root itself cannot be a symlink/junction and its resolved
//      real path must equal the requested path. Nested paths are independently
//      contained by the Contents API and workspace-source guards.
//   2. Access mode    — the default branch (main/master, or an explicit
//      isDefaultBranch flag) always resolves to "read-only" regardless of
//      what the caller requested; only an explicit non-default worktree can
//      be opened "editable". A default-name branch wins even over a forged
//      `isDefaultBranch: false`, and editable additionally requires a
//      present branch name — see resolveAccessMode for the exact bypasses
//      this closes.
//
// This module intentionally does not attempt to sandbox code executed by a
// spawned kernel or terminal — those run with host-user privileges by design
// (see docs/plans/project-backed-jupyterlab-deep-work.md, "Runtime
// ownership"). Read-only enforcement here covers the JupyterLab-mediated
// surfaces Smart Notes proxies: Contents API writes and terminal creation
// (see server/jupyter-proxy.js).
// ---------------------------------------------------------------------------

export type WorkspaceAccessMode = "read-only" | "editable";

export interface ProjectWorkspaceRequest {
  /** Absolute host path to the project or worktree root. */
  rootPath: string;
  projectId?: string;
  repoId?: string;
  branch?: string;
  /** Explicit override; when omitted, derived from `branch` name. */
  isDefaultBranch?: boolean;
  requestedAccess?: WorkspaceAccessMode;
  /** True only for a folder the owner explicitly selected inside Smart Notes. */
  ownerOpen?: boolean;
  /** Explicit owner confirmation allowing edits on a detected default branch. */
  defaultBranchEditConfirmed?: boolean;
}

export interface ResolvedProjectWorkspace {
  /** Registry key — distinct namespace from note-owned `.jupyter` sessions. */
  key: string;
  /** Symlink-resolved, absolute workspace root. */
  realRoot: string;
  accessMode: WorkspaceAccessMode;
  hideGlobs: string[];
  branch?: string;
  projectId?: string;
  repoId?: string;
}

/**
 * Dependency, build, VCS, and secret-shaped paths hidden from the JupyterLab
 * contents API/file browser by default. This reduces accidental exposure and
 * keeps the file browser focused on source; it is not a security sandbox
 * against a kernel or terminal deliberately reading these paths.
 */
export const PROJECT_WORKSPACE_HIDE_GLOBS = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__",
  "*.pyc",
  "*.pyo",
  ".venv",
  "venv",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  ".ipynb_checkpoints",
];

function defaultBranchNames(): Set<string> {
  const raw = process.env.SMART_NOTES_AV_DEFAULT_BRANCH_NAMES?.trim();
  const names = (raw ? raw.split(",") : ["main", "master"])
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return new Set(names);
}

function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function readGitHeadBranch(rootPath: string): Promise<string | undefined> {
  const dotGitPath = path.join(rootPath, ".git");
  const dotGitStat = await fs.lstat(dotGitPath).catch(() => null);
  if (!dotGitStat || dotGitStat.isSymbolicLink()) return undefined;

  let headPath = path.join(dotGitPath, "HEAD");
  if (dotGitStat.isFile()) {
    const pointer = await fs.readFile(dotGitPath, "utf8").catch(() => "");
    const match = /^gitdir:\s*(.+)\s*$/i.exec(pointer.trim());
    if (!match) return undefined;
    const gitDir = path.resolve(rootPath, match[1]);
    headPath = path.join(gitDir, "HEAD");
  } else if (!dotGitStat.isDirectory()) {
    return undefined;
  }

  const head = (await fs.readFile(headPath, "utf8").catch(() => "")).trim();
  const match = /^ref:\s+refs\/heads\/(.+)$/.exec(head);
  const branch = match?.[1]?.trim();
  return branch && !/[\u0000-\u001f\u007f]/.test(branch) ? branch : undefined;
}

/**
 * Validate the selected root directly. Nested files are checked separately by
 * the Jupyter Contents API proxy and workspace-source access helpers.
 */
async function resolveWorkspaceRealRoot(absoluteRequested: string): Promise<string> {
  const rootStat = await fs.lstat(absoluteRequested).catch(() => null);
  if (!rootStat) {
    throw new VaultError("WORKSPACE_ROOT_MISSING", `Workspace path does not exist: ${absoluteRequested}`, 404);
  }
  if (rootStat.isSymbolicLink()) {
    throw new VaultError(
      "WORKSPACE_SYMLINK_ESCAPE",
      "Refusing to open a workspace root that is a symlink or junction.",
      403
    );
  }
  if (!rootStat.isDirectory()) {
    throw new VaultError("WORKSPACE_ROOT_MISSING", `Workspace root is not a directory: ${absoluteRequested}`, 404);
  }

  const real = await fs.realpath(absoluteRequested);
  if (!samePath(path.resolve(real), absoluteRequested)) {
    throw new VaultError(
      "WORKSPACE_SYMLINK_ESCAPE",
      "The resolved real path does not match the requested workspace root.",
      403
    );
  }

  return real;
}

/**
 * Default-branch worktrees are always read-only; only an explicit,
 * non-default worktree may be editable.
 *
 * This is a security boundary, not a convenience default, so it is written
 * defense-in-depth against a spoofed/forged request body:
 *   - A branch name matching the default set (main/master, or the operator's
 *     configured list) is *always* treated as default, even if the caller
 *     also sends `isDefaultBranch: false`. `??` only falls through on
 *     null/undefined, so an explicit `false` used to bypass the branch-name
 *     check entirely — never let the branch name lose to a boolean claim.
 *   - Editable requires BOTH `requestedAccess === "editable"` AND a present,
 *     non-default branch name. Omitting `branch`/`isDefaultBranch` entirely
 *     must not fall through to editable just because there was no default
 *     name to match against.
 */
export function resolveAccessMode(input: {
  branch?: string;
  isDefaultBranch?: boolean;
  requestedAccess?: WorkspaceAccessMode;
  ownerOpen?: boolean;
  defaultBranchEditConfirmed?: boolean;
}): WorkspaceAccessMode {
  const trimmedBranch = input.branch?.trim();
  const branchIsDefaultName = trimmedBranch ? defaultBranchNames().has(trimmedBranch.toLowerCase()) : false;
  const isDefault = input.isDefaultBranch === true || branchIsDefaultName;
  if (isDefault) {
    return input.ownerOpen === true &&
      input.defaultBranchEditConfirmed === true &&
      input.requestedAccess === "editable"
      ? "editable"
      : "read-only";
  }
  if (input.requestedAccess === "editable" && (trimmedBranch || input.ownerOpen === true)) {
    return "editable";
  }
  return "read-only";
}

export async function resolveProjectWorkspace(
  request: ProjectWorkspaceRequest
): Promise<ResolvedProjectWorkspace> {
  const rootPath = request.rootPath?.trim();
  if (!rootPath) {
    throw new VaultError("INVALID_PATH", "A workspace rootPath is required.");
  }
  if (!path.isAbsolute(rootPath)) {
    throw new VaultError("INVALID_PATH", "Workspace rootPath must be an absolute path.");
  }

  const absoluteRequested = path.resolve(rootPath);
  const realRoot = await resolveWorkspaceRealRoot(absoluteRequested);
  const branch = request.branch?.trim() || (request.ownerOpen ? await readGitHeadBranch(realRoot) : undefined);
  const accessMode = resolveAccessMode({ ...request, branch });

  return {
    key: `project:${process.platform === "win32" ? realRoot.toLowerCase() : realRoot}`,
    realRoot,
    accessMode,
    hideGlobs: PROJECT_WORKSPACE_HIDE_GLOBS,
    branch,
    projectId: request.projectId,
    repoId: request.repoId,
  };
}

export const __testInternals = {
  defaultBranchNames,
  resolveWorkspaceRealRoot,
  readGitHeadBranch,
};
