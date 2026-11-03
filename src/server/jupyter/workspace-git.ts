import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { isSecretShapedWorkspacePath, normalizeDeepWorkRelativePath } from "@/lib/deep-work";
import {
  resolveWorkspaceCapability,
  type WorkspaceCapabilityRecord,
} from "@/server/jupyter/workspace-capability";
import { resolveAccessMode, resolveProjectWorkspace } from "@/server/jupyter/workspace-root";
import { VaultError } from "@/server/vault/errors";

// ---------------------------------------------------------------------------
// SN-409 capability-bound Git for Deep Work Companion turns.
//
// This is NOT a shell. Each operation below maps to a fixed git argv built
// here; the caller only supplies validated data (repository-relative paths,
// a commit message on stdin, an existing remote name). Hard boundaries:
//   - The capability's realRoot must be the repository top level, and git's
//     upward discovery is ceilinged at its parent, so a folder nested inside
//     another repository (or an unrelated repository) is never touched.
//   - Inherited GIT_* environment (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...)
//     is dropped so the server environment cannot redirect the repository.
//   - Repository hooks are skipped (core.hooksPath=/dev/null plus --no-verify)
//     so Companion-edited files can never become executed hook code, and no
//     external diff/textconv/fsmonitor/ext:: transport runs.
//   - Stage/unstage take named literal file paths only (no directories, no
//     pathspec magic, no .git, no secret-shaped files). Commit requires the
//     caller to restate the exact staged set, so an owner's unrelated staged
//     change is never swept into a Companion commit.
//   - Push is two-phase: a preview records remote, ref, and HEAD sha for the
//     calling turn; only a later owner-initiated turn on the same capability
//     thread may confirm it by restating remote and ref. Force, delete, tags,
//     hard reset, branch deletion, and rebases have no code path here.
// ---------------------------------------------------------------------------

export type WorkspaceGitOperation =
  | "status"
  | "diff"
  | "log"
  | "stage"
  | "unstage"
  | "commit"
  | "fetch"
  | "pull"
  | "push";

export const WORKSPACE_GIT_OPERATIONS: readonly WorkspaceGitOperation[] = [
  "status", "diff", "log", "stage", "unstage", "commit", "fetch", "pull", "push",
];
const READ_OPERATIONS = new Set<WorkspaceGitOperation>(["status", "diff", "log"]);

export const GIT_OUTPUT_MAX_CHARS = 16 * 1024;
export const GIT_DIFF_MAX_CHARS = 64 * 1024;
export const GIT_PATHS_MAX = 200;
export const GIT_LOG_MAX = 100;
export const GIT_COMMIT_MESSAGE_MAX = 8_000;
const LOCAL_TIMEOUT_MS = 30_000;
// Stays under the 90s Codex MCP bridge wait so a slow remote still returns a result.
const NETWORK_TIMEOUT_MS = 75_000;
const CAPTURE_MAX_BYTES = 4 * 1024 * 1024;
export const PUSH_CONFIRMATION_TTL_MS = 30 * 60 * 1000;
const PUSH_REGISTRY_KEY = "__smartNotesDeepWorkGitPushPreviews__";
const LOCK_REGISTRY_KEY = "__smartNotesDeepWorkGitLocks__";
const REMOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TURN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hooks resolve from a path that never holds hooks. Git for Windows warns on
// a bare /dev/null config path and expects its prefix-relative form.
export const NO_HOOKS_PATH = process.platform === "win32" ? "%(prefix)//dev/null" : "/dev/null";

/** Fixed hardening applied before every subcommand. */
const HARDENING_CONFIG = [
  `core.hooksPath=${NO_HOOKS_PATH}`,
  "core.fsmonitor=false",
  "core.quotePath=false",
  "core.pager=cat",
  "color.ui=false",
  "protocol.ext.allow=never",
  "submodule.recurse=false",
  "credential.interactive=never",
];

export interface GitCommandResult {
  /** Display form of the argv that ran (no shell). */
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export interface GitRunner {
  (args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; input?: string }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    spawnError?: NodeJS.ErrnoException;
  }>;
}

export interface CompanionTurnView {
  turnId: string;
  status: string;
  threadKey: string;
  appContext: string;
  ownerInitiated?: boolean;
  /** The owner's own text for this turn (empty for host-started turns). */
  ownerMessage?: string;
}

export interface WorkspaceGitDeps {
  runGit?: GitRunner;
  getTurn?: (turnId: string) => CompanionTurnView | null;
  now?: () => number;
}

export class WorkspaceGitError extends VaultError {
  readonly hint?: string;
  readonly result?: GitCommandResult;

  constructor(code: string, message: string, status: number, extra: { hint?: string; result?: GitCommandResult } = {}) {
    super(code, message, status);
    this.hint = extra.hint;
    this.result = extra.result;
  }
}

// ---------------------------------------------------------------------------
// Process execution
// ---------------------------------------------------------------------------

export const defaultRunGit: GitRunner = (args, options) =>
  new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    const child = spawn("git", args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes < CAPTURE_MAX_BYTES) stdout.push(chunk);
      stdoutBytes += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < CAPTURE_MAX_BYTES) stderr.push(chunk);
      stderrBytes += chunk.length;
    });
    const finish = (exitCode: number | null, spawnError?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        spawnError,
      });
    };
    child.on("error", (error: NodeJS.ErrnoException) => finish(null, error));
    child.on("close", (code) => finish(code));
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });

export function gitEnvironment(realRoot: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(base)) {
    // GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_CONFIG_* etc. could
    // redirect the command to another repository or inject config.
    if (/^GIT_/i.test(key)) continue;
    env[key] = value;
  }
  env.GIT_CEILING_DIRECTORIES = path.dirname(realRoot);
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GCM_INTERACTIVE = "never";
  env.LC_ALL = "C";
  env.LANG = "C";
  return env;
}

function bound(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

function displayCommand(args: string[]): string {
  // Hide the fixed hardening prefix; show what the operation ran.
  const visible: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-c" && HARDENING_CONFIG.includes(args[index + 1])) {
      index += 1;
      continue;
    }
    visible.push(/\s/.test(args[index]) ? JSON.stringify(args[index]) : args[index]);
  }
  return ["git", ...visible].join(" ");
}

interface GitContext {
  record: WorkspaceCapabilityRecord;
  realRoot: string;
  env: NodeJS.ProcessEnv;
  runGit: GitRunner;
}

async function git(
  context: GitContext,
  args: string[],
  options: { input?: string; network?: boolean; maxChars?: number } = {}
): Promise<GitCommandResult> {
  const fullArgs = [...HARDENING_CONFIG.flatMap((entry) => ["-c", entry]), ...args];
  const raw = await context.runGit(fullArgs, {
    cwd: context.realRoot,
    env: context.env,
    timeoutMs: options.network ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS,
    input: options.input,
  });
  if (raw.spawnError) {
    if (raw.spawnError.code === "ENOENT") {
      throw new WorkspaceGitError("GIT_NOT_FOUND", "Git is not installed or not on the Smart Notes server's PATH.", 503, {
        hint: "Install Git for the account that runs Smart Notes, make sure `git --version` works in a new terminal, then restart Smart Notes.",
      });
    }
    throw new WorkspaceGitError("GIT_SPAWN_FAILED", `Git could not start: ${raw.spawnError.message}`, 500);
  }
  const max = options.maxChars ?? GIT_OUTPUT_MAX_CHARS;
  const stdout = bound(raw.stdout, max);
  const stderr = bound(raw.stderr, GIT_OUTPUT_MAX_CHARS);
  return {
    command: displayCommand(fullArgs),
    exitCode: raw.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    timedOut: raw.timedOut,
  };
}

/** Map a failed git result onto an actionable error code. */
export function classifyGitFailure(operation: WorkspaceGitOperation, result: GitCommandResult): WorkspaceGitError {
  const text = `${result.stderr}\n${result.stdout}`;
  const make = (code: string, message: string, status: number, hint: string) =>
    new WorkspaceGitError(code, message, status, { hint, result });
  if (result.timedOut) {
    return make("GIT_TIMEOUT", `git ${operation} timed out.`, 504,
      "The command was stopped. For network operations check connectivity; if credentials are not cached, authenticate once in a terminal.");
  }
  if (/Authentication failed|could not read (?:Username|Password)|terminal prompts disabled|Permission denied \(publickey|Host key verification failed|returned error: 40[13]|Invalid username or (?:password|token)|cannot prompt|credential.*interactive/i.test(text)) {
    return make("GIT_AUTH_FAILED", `git ${operation} could not authenticate with the remote.`, 401,
      "Smart Notes never prompts for credentials. Ask the owner to authenticate once from a terminal (for example `git fetch` in this repository) so the credential helper or SSH agent has a cached login, then retry.");
  }
  if (/Could not resolve host|unable to access|Connection (?:refused|timed out|reset)|Could not read from remote repository|does not appear to be a git repository|repository .* not found/i.test(text)) {
    return make("GIT_REMOTE_UNREACHABLE", `git ${operation} could not reach the remote.`, 502,
      "Check the remote name/URL and network access. Smart Notes will not change remote configuration.");
  }
  if (operation === "push" && /\[rejected\]|\[remote rejected\]|non-fast-forward|fetch first|failed to push|protected branch|pre-receive hook declined/i.test(text)) {
    return make("GIT_PUSH_REJECTED", "The remote rejected the push.", 409,
      "The remote has commits this branch does not, or a server rule refused it. Run workspace_git_fetch and workspace_git_pull (fast-forward only) and retry, or ask the owner to integrate it. Force-push is never available.");
  }
  if (/would be overwritten by merge|Your local changes to the following files would be overwritten|untracked working tree files would be overwritten/i.test(text)) {
    return make("GIT_LOCAL_CHANGES_BLOCK", `git ${operation} would overwrite uncommitted local changes, so it stopped.`, 409,
      "Nothing was changed. Ask the owner how to handle their uncommitted changes (commit them, or let them stash manually) before pulling.");
  }
  if (/Not possible to fast-forward|not possible to fast-forward|diverg|Need to specify how to reconcile/i.test(text)) {
    return make("GIT_NOT_FAST_FORWARD", "The branch has diverged from the remote; a fast-forward pull is not possible.", 409,
      "Companion only fast-forwards. Ask the owner to merge or rebase manually.");
  }
  if (/CONFLICT|unmerged|Unmerged paths|fix conflicts|you need to resolve your current index first|merge is in progress|MERGE_HEAD exists/i.test(text)) {
    return make("GIT_CONFLICT", `The repository has unresolved conflicts or an in-progress merge; git ${operation} stopped.`, 409,
      "Ask the owner to resolve or abort the in-progress merge before continuing.");
  }
  if (/Please tell me who you are|empty ident|unable to auto-detect email address/i.test(text)) {
    return make("GIT_IDENTITY_MISSING", "Git has no commit identity configured.", 409,
      "Ask the owner to set user.name and user.email (git config) for this repository or globally.");
  }
  if (/index\.lock|Unable to create .*\.lock|another git process/i.test(text)) {
    return make("GIT_LOCKED", "Another Git process holds the repository lock.", 409,
      "Wait for the other Git operation to finish (or ask the owner to remove a stale index.lock) and retry.");
  }
  if (/nothing to commit|no changes added to commit/i.test(text)) {
    return make("GIT_NOTHING_TO_COMMIT", "There is nothing staged to commit.", 409, "Stage named paths with workspace_git_stage first.");
  }
  if (/did not match any file|pathspec .* did not match|The following paths are ignored/i.test(text)) {
    return make("GIT_PATH_NOT_FOUND", `git ${operation} did not match the named path(s).`, 400,
      "Check each path with workspace_git_status; ignored files are never force-added.");
  }
  return make("GIT_COMMAND_FAILED", `git ${operation} failed (exit ${result.exitCode ?? "unknown"}).`, 500,
    "Read stderr in the result and report it to the owner.");
}

function ensureSuccess(operation: WorkspaceGitOperation, result: GitCommandResult): GitCommandResult {
  if (result.exitCode !== 0 || result.timedOut) throw classifyGitFailure(operation, result);
  return result;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function gitPathBlockReason(relativePath: string): string | null {
  for (const segment of relativePath.split("/")) {
    if (segment.toLowerCase() === ".git") return "The .git directory is never addressable through Companion Git.";
  }
  if (isSecretShapedWorkspacePath(relativePath)) return "Secret-shaped paths are never staged, unstaged, or diffed by Companion.";
  return null;
}

/** Validate a list of named repository-relative file paths. */
export function parseGitPaths(value: unknown, options: { required: boolean }): string[] {
  if (value === undefined || value === null) {
    if (options.required) throw new VaultError("INVALID_INPUT", '"paths" must name at least one repository-relative file.');
    return [];
  }
  if (!Array.isArray(value)) throw new VaultError("INVALID_INPUT", '"paths" must be an array of repository-relative file paths.');
  if (options.required && value.length === 0) {
    throw new VaultError("INVALID_INPUT", '"paths" must name at least one repository-relative file.');
  }
  if (value.length > GIT_PATHS_MAX) throw new VaultError("INVALID_INPUT", `"paths" may name at most ${GIT_PATHS_MAX} files.`);
  const out: string[] = [];
  for (const entry of value) {
    const normalized = normalizeDeepWorkRelativePath(entry);
    if (!normalized) {
      throw new VaultError("WORKSPACE_PATH_BLOCKED", `Not a safe repository-relative path: ${JSON.stringify(entry)}.`, 403);
    }
    const blocked = gitPathBlockReason(normalized);
    if (blocked) throw new VaultError("WORKSPACE_PATH_BLOCKED", `${blocked} (${normalized})`, 403);
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

const literal = (relativePath: string) => `:(literal)${relativePath}`;

function parseRemoteName(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !REMOTE_NAME_PATTERN.test(value) || value.includes("..")) {
    throw new VaultError("INVALID_INPUT", '"remote" must be the name of a configured remote (for example "origin").');
  }
  return value;
}

function parseCount(value: unknown, fallback: number, max: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new VaultError("INVALID_INPUT", `"${label}" must be an integer between 1 and ${max}.`);
  }
  return value as number;
}

function parseCommitMessage(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new VaultError("INVALID_INPUT", '"message" must be a non-empty commit message.');
  }
  if (value.length > GIT_COMMIT_MESSAGE_MAX || value.includes("\u0000")) {
    throw new VaultError("INVALID_INPUT", `"message" must be at most ${GIT_COMMIT_MESSAGE_MAX} characters with no NUL bytes.`);
  }
  return value.trim();
}

function splitZ(text: string): string[] {
  return text.split("\u0000").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Repository binding
// ---------------------------------------------------------------------------

async function bindRepository(record: WorkspaceCapabilityRecord, runGit: GitRunner): Promise<GitContext> {
  // Re-validate the root on every call (missing, junction, symlink swap).
  const resolved = await resolveProjectWorkspace({
    rootPath: record.realRoot,
    projectId: record.projectId,
    repoId: record.repoId,
    branch: record.branch,
    requestedAccess: record.accessMode,
    ownerOpen: record.ownerOpen,
    defaultBranchEditConfirmed: record.defaultBranchEditConfirmed,
  });
  const context: GitContext = { record, realRoot: resolved.realRoot, env: gitEnvironment(resolved.realRoot), runGit };
  const top = await git(context, ["rev-parse", "--show-toplevel"]);
  if (top.exitCode !== 0) {
    if (/not a git repository/i.test(top.stderr)) {
      throw new WorkspaceGitError("GIT_NOT_REPOSITORY", "This Deep Work folder is not a Git repository.", 409, {
        hint: "Companion Git only works when the Deep Work root is a repository (or worktree) top level; a folder nested inside a repository is never treated as that repository.",
        result: top,
      });
    }
    throw classifyGitFailure("status", top);
  }
  const reported = top.stdout.trim();
  const reportedReal = reported ? await fs.realpath(reported).catch(() => reported) : "";
  if (!reportedReal || !samePath(reportedReal, resolved.realRoot)) {
    throw new WorkspaceGitError(
      "GIT_ROOT_MISMATCH",
      "The Deep Work root is not its repository's top level, so Companion Git is unavailable here.",
      403,
      { hint: "Open the repository (or worktree) root itself as the Deep Work folder to use Git from Companion." }
    );
  }
  return context;
}

async function currentBranch(context: GitContext): Promise<string | null> {
  const result = await git(context, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = result.exitCode === 0 ? result.stdout.trim() : "";
  return branch || null;
}

async function hasHead(context: GitContext): Promise<boolean> {
  const result = await git(context, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  return result.exitCode === 0;
}

async function headSha(context: GitContext): Promise<string> {
  const result = ensureSuccess("push", await git(context, ["rev-parse", "--verify", "HEAD"]));
  return result.stdout.trim();
}

/** Writes require an editable capability and the branch it was granted for. */
async function requireWritableBranch(context: GitContext, operation: WorkspaceGitOperation): Promise<string> {
  const { record } = context;
  if (record.accessMode !== "editable") {
    throw new WorkspaceGitError("WORKSPACE_READ_ONLY", `git ${operation} requires an editable Deep Work workspace.`, 403, {
      hint: "Read-only workspaces may use workspace_git_status, workspace_git_diff, and workspace_git_log only.",
    });
  }
  const branch = await currentBranch(context);
  if (!branch) {
    throw new WorkspaceGitError("GIT_DETACHED_HEAD", `git ${operation} requires a checked-out branch (HEAD is detached).`, 409, {
      hint: "Ask the owner to check out a branch.",
    });
  }
  if (record.branch && record.branch !== branch) {
    throw new WorkspaceGitError(
      "GIT_BRANCH_MISMATCH",
      `This workspace was opened for branch ${record.branch}, but ${branch} is checked out now.`,
      409,
      { hint: "Ask the owner to switch back or relaunch Deep Work for the current branch." }
    );
  }
  const access = resolveAccessMode({
    branch,
    requestedAccess: record.accessMode,
    ownerOpen: record.ownerOpen,
    defaultBranchEditConfirmed: record.defaultBranchEditConfirmed,
  });
  if (access !== "editable") {
    throw new WorkspaceGitError("WORKSPACE_READ_ONLY", `Branch ${branch} is read-only for this Deep Work workspace.`, 403);
  }
  return branch;
}

async function upstreamOf(context: GitContext, branch: string): Promise<{ remote: string; branch: string } | null> {
  const remote = await git(context, ["config", "--get", `branch.${branch}.remote`]);
  const merge = await git(context, ["config", "--get", `branch.${branch}.merge`]);
  const remoteName = remote.stdout.trim();
  const mergeRef = merge.stdout.trim();
  if (remote.exitCode !== 0 || merge.exitCode !== 0 || !remoteName || remoteName === "." || !mergeRef.startsWith("refs/heads/")) {
    return null;
  }
  return { remote: remoteName, branch: mergeRef.slice("refs/heads/".length) };
}

async function listRemotes(context: GitContext): Promise<string[]> {
  const result = ensureSuccess("fetch", await git(context, ["remote"]));
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function chooseRemote(context: GitContext, requested: string | undefined, upstream: { remote: string } | null): Promise<string> {
  const remotes = await listRemotes(context);
  if (!remotes.length) {
    throw new WorkspaceGitError("GIT_NO_REMOTE", "This repository has no configured remote.", 409, {
      hint: "Ask the owner to add a remote; Companion does not change remote configuration.",
    });
  }
  const remote = requested ?? upstream?.remote ?? (remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : undefined);
  if (!remote) {
    throw new WorkspaceGitError("GIT_REMOTE_AMBIGUOUS", `Several remotes exist (${remotes.join(", ")}); name one with "remote".`, 400);
  }
  if (!remotes.includes(remote)) {
    throw new WorkspaceGitError("GIT_REMOTE_UNKNOWN", `Remote ${remote} is not configured in this repository.`, 400, {
      hint: `Configured remotes: ${remotes.join(", ")}.`,
    });
  }
  return remote;
}

async function validateBranchName(context: GitContext, name: string): Promise<void> {
  const check = await git(context, ["check-ref-format", "--branch", name]);
  if (check.exitCode !== 0 || name.startsWith("-")) {
    throw new WorkspaceGitError("GIT_INVALID_REF", `Branch name ${JSON.stringify(name)} is not valid.`, 400);
  }
}

// ---------------------------------------------------------------------------
// Serialisation per repository root
// ---------------------------------------------------------------------------

function lockRegistry(): Map<string, Promise<unknown>> {
  const host = globalThis as typeof globalThis & { [LOCK_REGISTRY_KEY]?: Map<string, Promise<unknown>> };
  if (!host[LOCK_REGISTRY_KEY]) host[LOCK_REGISTRY_KEY] = new Map();
  return host[LOCK_REGISTRY_KEY]!;
}

async function withRepositoryLock<T>(root: string, task: () => Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? root.toLowerCase() : root;
  const locks = lockRegistry();
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Push confirmation registry
// ---------------------------------------------------------------------------

interface PushPreview {
  confirmationId: string;
  capability: string;
  remote: string;
  ref: string;
  branch: string;
  sha: string;
  turnId: string;
  expiresAt: number;
}

function pushRegistry(): Map<string, PushPreview> {
  const host = globalThis as typeof globalThis & { [PUSH_REGISTRY_KEY]?: Map<string, PushPreview> };
  if (!host[PUSH_REGISTRY_KEY]) host[PUSH_REGISTRY_KEY] = new Map();
  return host[PUSH_REGISTRY_KEY]!;
}

function defaultGetTurn(turnId: string): CompanionTurnView | null {
  const host = (globalThis as Record<string, unknown>)._smartNotesCompanionHost as
    | { getTurn?: (id: string) => CompanionTurnView | null }
    | undefined;
  return host?.getTurn?.(turnId) ?? null;
}

/** The calling turn must be live and bound to this capability's thread. */
function requireCallingTurn(
  capability: string,
  turnIdValue: unknown,
  getTurn: (turnId: string) => CompanionTurnView | null
): CompanionTurnView {
  const turnId = typeof turnIdValue === "string" ? turnIdValue.trim() : "";
  const turn = TURN_ID_PATTERN.test(turnId) ? getTurn(turnId) : null;
  if (
    !turn || turn.status !== "running" || !turn.threadKey.startsWith(`${capability}::`) ||
    !turn.appContext.includes(`- workspaceCapability: ${capability}`) ||
    !turn.appContext.includes(`- companionTurnId: ${turnId}`)
  ) {
    throw new WorkspaceGitError(
      "GIT_PUSH_TURN_REQUIRED",
      "Push needs turnId: the companionTurnId of the running Deep Work turn for this workspace.",
      403,
      { hint: "Pass turnId exactly as companionTurnId from the host connection block." }
    );
  }
  return turn;
}

/**
 * True only for a turn the owner started (describeTurn sets ownerInitiated
 * explicitly; a missing flag never counts as the owner).
 */
function isOwnerTurn(turn: CompanionTurnView): boolean {
  return turn.ownerInitiated === true;
}

// Quotes, brackets and sentence punctuation around a word ("origin," `main`.)
const TOKEN_EDGE_PUNCTUATION = /^["'`\u2018\u2019\u201c\u201d([{<*_]+|["'`\u2018\u2019\u201c\u201d)\]}>*_,.;:!?]+$/g;

/**
 * SN-409 review: the owner's own message in the confirming turn must name the
 * previewed remote and its ref (branch or refs/heads/<branch>, or the combined
 * <remote>/<branch>) as whole tokens, case-insensitive. The model cannot
 * confirm a push on the owner's behalf from an unrelated reply.
 */
export function ownerMessageConfirmsPush(message: unknown, remote: string, ref: string): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  const tokens = new Set(
    message
      .split(/\s+/)
      .map((token) => token.replace(TOKEN_EDGE_PUNCTUATION, "").toLowerCase())
      .filter(Boolean)
  );
  const remoteName = remote.toLowerCase();
  const fullRef = ref.toLowerCase();
  const branchName = fullRef.startsWith("refs/heads/") ? fullRef.slice("refs/heads/".length) : fullRef;
  const combined = `${remoteName}/${branchName}`;
  const namesRemote = tokens.has(remoteName) || tokens.has(combined);
  const namesRef = tokens.has(branchName) || tokens.has(fullRef) || tokens.has(combined);
  return namesRemote && namesRef;
}

function normalizeConfirmRef(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.startsWith("refs/heads/") ? trimmed : `refs/heads/${trimmed}`;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface WorkspaceGitResponse {
  ok: true;
  operation: WorkspaceGitOperation;
  branch?: string | null;
  results: GitCommandResult[];
  [key: string]: unknown;
}

async function runStatus(context: GitContext): Promise<WorkspaceGitResponse> {
  const result = ensureSuccess("status", await git(context, ["status", "--short", "--branch", "--untracked-files=all"]));
  return { ok: true, operation: "status", branch: await currentBranch(context), results: [result] };
}

async function secretExcludes(context: GitContext, staged: boolean, paths: string[]): Promise<string[]> {
  const names = await git(context, [
    "diff", ...(staged ? ["--cached"] : []), "--name-only", "-z", "--no-renames", "--",
    ...(paths.length ? paths.map(literal) : []),
  ], { maxChars: 1024 * 1024 });
  return splitZ(names.stdout)
    .filter((name) => isSecretShapedWorkspacePath(name))
    .map((name) => `:(exclude,literal)${name}`);
}

async function runDiff(context: GitContext, args: Record<string, unknown>): Promise<WorkspaceGitResponse> {
  const staged = args.staged === true;
  const stat = args.stat === true;
  const paths = parseGitPaths(args.paths, { required: false });
  const excludes = await secretExcludes(context, staged, paths);
  const pathspec = paths.length ? paths.map(literal) : excludes.length ? ["."] : [];
  const result = ensureSuccess("diff", await git(context, [
    "diff", ...(staged ? ["--cached"] : []), "--no-ext-diff", "--no-textconv", "--no-color",
    ...(stat ? ["--stat"] : []), "--", ...pathspec, ...excludes,
  ], { maxChars: GIT_DIFF_MAX_CHARS }));
  return {
    ok: true,
    operation: "diff",
    branch: await currentBranch(context),
    staged,
    omittedSecretPaths: excludes.length,
    results: [result],
  };
}

async function runLog(context: GitContext, args: Record<string, unknown>): Promise<WorkspaceGitResponse> {
  const maxCount = parseCount(args.maxCount, 20, GIT_LOG_MAX, "maxCount");
  const paths = parseGitPaths(args.paths, { required: false });
  if (!(await hasHead(context))) {
    return { ok: true, operation: "log", branch: await currentBranch(context), results: [], note: "No commits yet." };
  }
  const result = ensureSuccess("log", await git(context, [
    "log", `--max-count=${maxCount}`, "--no-color", "--date=iso-strict", "--format=%H%x09%an%x09%ad%x09%s", "HEAD",
    "--", ...paths.map(literal),
  ]));
  return { ok: true, operation: "log", branch: await currentBranch(context), results: [result] };
}

async function changedPaths(context: GitContext, paths: string[]): Promise<Set<string>> {
  const result = ensureSuccess("status", await git(context, [
    "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--", ...paths.map(literal),
  ], { maxChars: 1024 * 1024 }));
  const changed = new Set<string>();
  for (const entry of splitZ(result.stdout)) {
    if (entry.length > 3) changed.add(entry.slice(3));
  }
  return changed;
}

async function runStage(context: GitContext, args: Record<string, unknown>): Promise<WorkspaceGitResponse> {
  const branch = await requireWritableBranch(context, "stage");
  const paths = parseGitPaths(args.paths, { required: true });
  for (const relativePath of paths) {
    const stat = await fs.lstat(path.join(context.realRoot, ...relativePath.split("/"))).catch(() => null);
    if (stat?.isDirectory()) {
      throw new WorkspaceGitError("GIT_PATH_IS_DIRECTORY", `${relativePath} is a directory; stage named files only.`, 400, {
        hint: "List the individual changed files from workspace_git_status.",
      });
    }
  }
  const changed = await changedPaths(context, paths);
  const unchanged = paths.filter((relativePath) => !changed.has(relativePath));
  if (unchanged.length) {
    throw new WorkspaceGitError("GIT_PATH_UNCHANGED", `No change to stage for: ${unchanged.join(", ")}.`, 400, {
      hint: "Use exact repository-relative file paths from workspace_git_status (ignored files are never force-added).",
    });
  }
  const result = ensureSuccess("stage", await git(context, ["add", "--", ...paths.map(literal)]));
  const status = await git(context, ["status", "--short", "--branch", "--untracked-files=all"]);
  return { ok: true, operation: "stage", branch, staged: paths, results: [result, status] };
}

async function runUnstage(context: GitContext, args: Record<string, unknown>): Promise<WorkspaceGitResponse> {
  const branch = await requireWritableBranch(context, "unstage");
  const paths = parseGitPaths(args.paths, { required: true });
  const argv = (await hasHead(context))
    ? ["restore", "--staged", "--", ...paths.map(literal)]
    : ["rm", "--cached", "--quiet", "--", ...paths.map(literal)];
  const result = ensureSuccess("unstage", await git(context, argv));
  const status = await git(context, ["status", "--short", "--branch", "--untracked-files=all"]);
  return { ok: true, operation: "unstage", branch, unstaged: paths, results: [result, status] };
}

async function stagedPaths(context: GitContext): Promise<string[]> {
  const result = ensureSuccess("commit", await git(context, ["diff", "--cached", "--name-only", "-z", "--no-renames"], {
    maxChars: 1024 * 1024,
  }));
  return splitZ(result.stdout);
}

async function runCommit(context: GitContext, args: Record<string, unknown>): Promise<WorkspaceGitResponse> {
  const branch = await requireWritableBranch(context, "commit");
  const message = parseCommitMessage(args.message);
  const declared = parseGitPaths(args.paths, { required: true });
  const staged = await stagedPaths(context);
  if (!staged.length) {
    throw new WorkspaceGitError("GIT_NOTHING_TO_COMMIT", "There is nothing staged to commit.", 409, {
      hint: "Stage named paths with workspace_git_stage first.",
    });
  }
  const unexpected = staged.filter((entry) => !declared.includes(entry));
  const missing = declared.filter((entry) => !staged.includes(entry));
  if (unexpected.length || missing.length) {
    throw new WorkspaceGitError(
      "GIT_STAGED_SET_MISMATCH",
      "The staged set does not match the declared paths, so nothing was committed.",
      409,
      {
        hint: [
          unexpected.length ? `Also staged (possibly the owner's changes): ${unexpected.join(", ")}.` : "",
          missing.length ? `Declared but not staged: ${missing.join(", ")}.` : "",
          "Ask the owner before including or unstaging changes you did not make.",
        ].filter(Boolean).join(" "),
      }
    );
  }
  const result = ensureSuccess("commit", await git(context, [
    "commit", "--no-verify", "--cleanup=strip", "--file=-",
  ], { input: `${message}\n` }));
  const head = await git(context, ["log", "-1", "--no-color", "--format=%H%x09%s"]);
  return { ok: true, operation: "commit", branch, committed: staged, commit: head.stdout.trim().split("\t")[0], results: [result, head] };
}

async function runFetch(context: GitContext, args: Record<string, unknown>): Promise<WorkspaceGitResponse> {
  const branch = await requireWritableBranch(context, "fetch");
  const upstream = await upstreamOf(context, branch);
  const remote = await chooseRemote(context, parseRemoteName(args.remote), upstream);
  const result = ensureSuccess("fetch", await git(context, [
    "fetch", "--no-recurse-submodules", "--no-write-fetch-head", remote,
  ], { network: true }));
  const status = await git(context, ["status", "--short", "--branch", "--untracked-files=no"]);
  return { ok: true, operation: "fetch", branch, remote, results: [result, status] };
}

async function runPull(context: GitContext, args: Record<string, unknown>): Promise<WorkspaceGitResponse> {
  const branch = await requireWritableBranch(context, "pull");
  const upstream = await upstreamOf(context, branch);
  const requestedRemote = parseRemoteName(args.remote);
  const remote = await chooseRemote(context, requestedRemote, upstream);
  const remoteBranch = upstream && upstream.remote === remote ? upstream.branch : branch;
  await validateBranchName(context, remoteBranch);
  const before = (await hasHead(context)) ? await headSha(context) : null;
  const result = ensureSuccess("pull", await git(context, [
    "pull", "--ff-only", "--no-rebase", "--no-autostash", "--no-recurse-submodules", "--no-edit",
    remote, `refs/heads/${remoteBranch}`,
  ], { network: true }));
  const after = (await hasHead(context)) ? await headSha(context) : null;
  return { ok: true, operation: "pull", branch, remote, remoteBranch, before, after, results: [result] };
}

async function runPush(
  context: GitContext,
  args: Record<string, unknown>,
  deps: Required<Pick<WorkspaceGitDeps, "getTurn" | "now">>
): Promise<WorkspaceGitResponse> {
  const capability = context.record.token;
  const branch = await requireWritableBranch(context, "push");
  const turn = requireCallingTurn(capability, args.turnId, deps.getTurn);
  const registry = pushRegistry();
  const now = deps.now();
  for (const [id, preview] of registry) if (preview.expiresAt <= now) registry.delete(id);

  const present = (value: unknown) => value !== undefined && value !== null && value !== "";
  const confirming = present(args.confirmationId) || present(args.confirmRemote) || present(args.confirmRef);
  if (!confirming) {
    if (!(await hasHead(context))) {
      throw new WorkspaceGitError("GIT_NOTHING_TO_PUSH", "This branch has no commits to push.", 409);
    }
    const upstream = await upstreamOf(context, branch);
    const remote = await chooseRemote(context, parseRemoteName(args.remote), upstream);
    const remoteBranch = upstream && upstream.remote === remote ? upstream.branch : branch;
    await validateBranchName(context, remoteBranch);
    const sha = await headSha(context);
    const tracking = `refs/remotes/${remote}/${remoteBranch}`;
    const known = (await git(context, ["rev-parse", "--verify", "--quiet", tracking])).exitCode === 0;
    const commits = await git(context, [
      "log", "--max-count=20", "--no-color", "--format=%h%x09%s", known ? `${tracking}..${sha}` : sha,
    ]);
    const ref = `refs/heads/${remoteBranch}`;
    // Re-previewing the same target keeps the preview the owner already saw
    // (and its original turn), so a confirming turn that re-checks first can
    // still complete. A different target replaces it.
    const existing = [...registry.values()].find((entry) =>
      entry.capability === capability && entry.remote === remote && entry.ref === ref && entry.sha === sha && entry.branch === branch
    );
    if (!existing) {
      for (const [id, entry] of registry) if (entry.capability === capability) registry.delete(id);
    }
    const preview: PushPreview = existing ?? {
      confirmationId: `gpc_${crypto.randomBytes(18).toString("base64url")}`,
      capability,
      remote,
      ref,
      branch,
      sha,
      turnId: turn.turnId,
      expiresAt: now + PUSH_CONFIRMATION_TTL_MS,
    };
    registry.set(preview.confirmationId, preview);
    const confirmable = preview.turnId !== turn.turnId && isOwnerTurn(turn) &&
      ownerMessageConfirmsPush(turn.ownerMessage, preview.remote, preview.ref);
    return {
      ok: true,
      operation: "push",
      status: "confirmation_required",
      branch,
      remote,
      ref: preview.ref,
      sha,
      remoteTrackingKnown: known,
      confirmationId: preview.confirmationId,
      expiresAt: new Date(preview.expiresAt).toISOString(),
      // True when this preview was shown to the owner in an earlier turn, so
      // the owner's current message may confirm it.
      confirmableInThisTurn: confirmable,
      hint: confirmable
        ? `Nothing was pushed. This is the same pending preview the owner saw in an earlier turn (${remote} ${preview.ref}, ${sha.slice(0, 12)}), ` +
          "and the owner's message in THIS turn names that remote and branch. If it confirms the push, call workspace_git_push now with confirmRemote and confirmRef " +
          "restating them and this turn's companionTurnId as turnId. Otherwise ask the owner."
        : `Nothing was pushed. Show the owner: push ${branch} (${sha.slice(0, 12)}) to ${remote} ${preview.ref}, with the commits listed, then end your turn. ` +
          `Ask the owner to reply naming the remote and branch (for example "push to ${remote} ${preview.ref.slice("refs/heads/".length)}"); the server checks the owner's own message for both. ` +
          "When they do, call workspace_git_push directly (no new preview needed) " +
          "with confirmRemote and confirmRef restating them and that turn's companionTurnId as turnId.",
      results: [commits],
    };
  }

  const preview = present(args.confirmationId)
    ? (typeof args.confirmationId === "string" ? registry.get(args.confirmationId) : undefined)
    : [...registry.values()].filter((entry) => entry.capability === capability).sort((a, b) => b.expiresAt - a.expiresAt)[0];
  if (!preview || preview.capability !== capability) {
    throw new WorkspaceGitError("GIT_PUSH_CONFIRMATION_INVALID", "There is no pending push preview for this workspace (or it expired).", 409, {
      hint: "Call workspace_git_push with only workspace and turnId to preview, show it to the owner, and end your turn.",
    });
  }
  if (preview.turnId === turn.turnId || !isOwnerTurn(turn)) {
    throw new WorkspaceGitError(
      "GIT_PUSH_OWNER_CONFIRMATION_REQUIRED",
      "A push must be confirmed by the owner in a later message than the preview.",
      403,
      { hint: "End your turn after the preview; continue only when the owner replies with an explicit confirmation." }
    );
  }
  if (args.confirmRemote !== preview.remote || normalizeConfirmRef(args.confirmRef) !== preview.ref) {
    throw new WorkspaceGitError(
      "GIT_PUSH_CONFIRMATION_MISMATCH",
      `Confirmation must restate remote ${preview.remote} and ref ${preview.ref} exactly.`,
      409
    );
  }
  if (!ownerMessageConfirmsPush(turn.ownerMessage, preview.remote, preview.ref)) {
    const branchName = preview.ref.slice("refs/heads/".length);
    throw new WorkspaceGitError(
      "GIT_PUSH_CONFIRMATION_REQUIRED",
      `The owner's message in this turn does not name remote ${preview.remote} and branch ${branchName}; nothing was pushed.`,
      403,
      { hint: `Ask the owner to confirm by naming both, for example "push to ${preview.remote} ${branchName}", then end your turn.` }
    );
  }
  if (preview.branch !== branch) {
    registry.delete(preview.confirmationId);
    throw new WorkspaceGitError("GIT_PUSH_STALE", "The checked-out branch changed since the preview.", 409, {
      hint: "Preview again and ask the owner.",
    });
  }
  const sha = await headSha(context);
  if (sha !== preview.sha) {
    registry.delete(preview.confirmationId);
    throw new WorkspaceGitError("GIT_PUSH_STALE", "HEAD moved since the owner confirmed the preview; nothing was pushed.", 409, {
      hint: "Preview again so the owner confirms the exact commits.",
    });
  }
  registry.delete(preview.confirmationId);
  const result = ensureSuccess("push", await git(context, [
    "push", "--porcelain", "--no-verify", "--no-follow-tags", preview.remote, `${preview.sha}:${preview.ref}`,
  ], { network: true }));
  const results = [result];
  const upstream = await upstreamOf(context, branch);
  if (!upstream) {
    const tracking = `${preview.remote}/${preview.ref.slice("refs/heads/".length)}`;
    const setUpstream = await git(context, ["branch", `--set-upstream-to=${tracking}`, branch]);
    results.push(setUpstream);
  }
  return {
    ok: true,
    operation: "push",
    status: "pushed",
    branch,
    remote: preview.remote,
    ref: preview.ref,
    sha: preview.sha,
    results,
  };
}

/**
 * Run one capability-bound Git operation. Throws VaultError/WorkspaceGitError
 * for refused or failed operations; failures carry the bounded git result.
 */
export async function runWorkspaceGit(
  capabilityValue: unknown,
  operationValue: unknown,
  args: Record<string, unknown> = {},
  deps: WorkspaceGitDeps = {}
): Promise<WorkspaceGitResponse> {
  const record = resolveWorkspaceCapability(capabilityValue);
  if (typeof operationValue !== "string" || !WORKSPACE_GIT_OPERATIONS.includes(operationValue as WorkspaceGitOperation)) {
    throw new VaultError(
      "GIT_OPERATION_NOT_ALLOWED",
      `Companion Git supports only: ${WORKSPACE_GIT_OPERATIONS.join(", ")}. Force-push, reset, branch deletion, rebase, and arbitrary commands are unavailable.`,
      403
    );
  }
  const operation = operationValue as WorkspaceGitOperation;
  const runGit = deps.runGit ?? defaultRunGit;
  const getTurn = deps.getTurn ?? defaultGetTurn;
  const now = deps.now ?? Date.now;
  return withRepositoryLock(record.realRoot, async () => {
    const context = await bindRepository(record, runGit);
    if (!READ_OPERATIONS.has(operation) && record.accessMode !== "editable") {
      throw new WorkspaceGitError("WORKSPACE_READ_ONLY", `git ${operation} requires an editable Deep Work workspace.`, 403);
    }
    switch (operation) {
      case "status": return runStatus(context);
      case "diff": return runDiff(context, args);
      case "log": return runLog(context, args);
      case "stage": return runStage(context, args);
      case "unstage": return runUnstage(context, args);
      case "commit": return runCommit(context, args);
      case "fetch": return runFetch(context, args);
      case "pull": return runPull(context, args);
      case "push": return runPush(context, args, { getTurn, now });
    }
  });
}

export function workspaceGitErrorBody(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (!(error instanceof WorkspaceGitError)) return null;
  return {
    status: error.status,
    body: {
      ok: false,
      error: error.message,
      code: error.code,
      ...(error.hint ? { hint: error.hint } : {}),
      ...(error.result ? { result: error.result } : {}),
    },
  };
}

export function resetWorkspaceGitForTesting(): void {
  pushRegistry().clear();
  lockRegistry().clear();
}
