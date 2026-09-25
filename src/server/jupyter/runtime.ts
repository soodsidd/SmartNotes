import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { getAppStateDir } from "@/server/app-state";
import { VaultError } from "@/server/vault/errors";
import { JUPYTER_NOTEBOOK_FILE_NAME } from "@/server/vault/page-format";
import { resolveVaultPath } from "@/server/vault/paths";
import {
  resolveProjectWorkspace,
  type ProjectWorkspaceRequest,
  type WorkspaceAccessMode,
} from "@/server/jupyter/workspace-root";

// ---------------------------------------------------------------------------
// Embedded JupyterLab runtime (SN-101)
//
// Smart Notes owns the *lifecycle* of a local JupyterLab/Jupyter Server session
// scoped to a note's `.jupyter/` working directory. Jupyter owns everything
// inside the frame: code execution, autocomplete, terminals, output rendering.
//
// A session is keyed by the absolute notebook-folder path so opening the same
// note twice (or from two tabs) reuses one server. Sessions live on a
// process-global registry so they survive Next.js route-module reloads, exactly
// like the Socket.IO singleton in server.js.
// ---------------------------------------------------------------------------

export type JupyterSessionStatus = "starting" | "ready" | "error" | "stopped";

/** Typed failure codes surfaced to the client for clear, actionable messaging. */
export type JupyterErrorCode =
  | "JUPYTER_MISSING"
  | "NOTEBOOK_UNAVAILABLE"
  | "SERVER_LAUNCH_FAILED"
  | "PORT_CONFLICT"
  | "SERVER_DOWN"
  | "PROXY_UNAVAILABLE"
  | "MOBILE_BROWSER_UNSUPPORTED";

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_INTERVAL_MS = 500;
const STDERR_BUFFER_LIMIT = 8_000;
const AVAILABILITY_TTL_MS = 30_000;

/** "note" is the original note-owned `.jupyter` sibling folder; "project" is an AV worktree/project root (SN-256). */
export type WorkspaceKind = "note" | "project";

export interface ProjectWorkspaceMeta {
  rootPath: string;
  branch?: string;
  projectId?: string;
  repoId?: string;
}

interface JupyterSession {
  /** Registry key: normalized `.jupyter/` folder path (note) or `project:<realpath>` (project). */
  key: string;
  pagePath: string;
  folder: string;
  /** Absent for project-backed workspaces, which open the root rather than a canonical notebook. */
  notebookFile?: string;
  proxyId: string;
  proxyBasePath: string;
  port: number;
  token: string;
  /** Loopback URL used by the server process for health checks. */
  baseUrl: string;
  /** Browser origins allowed to embed this Jupyter server. */
  frameOrigins: string[];
  status: JupyterSessionStatus;
  errorCode?: JupyterErrorCode;
  errorMessage?: string;
  startedAt: string;
  proc?: ChildProcess;
  configPath?: string;
  artifactDir?: string;
  logTail: string;
  /** Set if the child process could not be spawned (e.g. executable vanished). */
  spawnError?: NodeJS.ErrnoException;
  /** In-flight launch, so concurrent callers await one startup. */
  startPromise?: Promise<void>;
  kind: WorkspaceKind;
  /** Project-backed sessions only; read-only blocks Contents/terminal writes at the proxy (see server/jupyter-proxy.js). */
  accessMode?: WorkspaceAccessMode;
  workspaceMeta?: ProjectWorkspaceMeta;
}

/** Client-safe projection of a session (never leaks the child process handle). */
export interface JupyterSessionView {
  status: JupyterSessionStatus;
  /** Same-origin JupyterLab proxy URL (with token) to embed. Present when status === "ready". */
  url?: string;
  port?: number;
  pagePath: string;
  errorCode?: JupyterErrorCode;
  errorMessage?: string;
  /** Present only for project-backed workspaces (SN-256). */
  accessMode?: WorkspaceAccessMode;
  resolvedAccessMode?: WorkspaceAccessMode;
  rootPath?: string;
  branch?: string;
  projectId?: string;
  repoId?: string;
}

const REGISTRY_KEY = "__smartNotesJupyterSessions__";
const AVAILABILITY_KEY = "__smartNotesJupyterAvailability__";
const PROFILE_STATUS_KEY = "__smartNotesJupyterProfileStatus__";
const PROFILE_STATUS_TTL_MS = 30_000;

export interface JupyterProfileStatus {
  profileInstalled: boolean;
  source: "override" | "profile" | "path" | "missing";
  jupyterExecutable: string | null;
  jupyterLabVersion: string | null;
  lspInstalled: boolean;
  pylspReachable: boolean;
  pylspVersion: string | null;
}

function registry(): Map<string, JupyterSession> {
  const g = globalThis as Record<string, unknown>;
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = new Map<string, JupyterSession>();
  }
  return g[REGISTRY_KEY] as Map<string, JupyterSession>;
}

// ---------------------------------------------------------------------------
// Jupyter executable resolution / availability
// ---------------------------------------------------------------------------

interface AvailabilityCache {
  executable: string | null;
  checkedAt: number;
  inFlight?: Promise<string | null>;
}

interface ProfileStatusCache {
  status?: JupyterProfileStatus;
  checkedAt?: number;
  selectionKey: string;
  inFlight?: Promise<JupyterProfileStatus>;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface JupyterExecutableSelection {
  executable: string | null;
  profileInstalled: boolean;
  source: JupyterProfileStatus["source"];
}

function profileExecutablePath(): string {
  const profileRoot = process.env.SMART_NOTES_JUPYTER_PROFILE_DIR?.trim()
    ? path.resolve(process.env.SMART_NOTES_JUPYTER_PROFILE_DIR.trim())
    : path.resolve(process.cwd(), "profiles", "jupyter", ".venv");
  return process.platform === "win32"
    ? path.join(profileRoot, "Scripts", "jupyter.exe")
    : path.join(profileRoot, "bin", "jupyter");
}

function resolveProfileExecutable(): string | null {
  const candidate = profileExecutablePath();
  return fsSync.existsSync(candidate) ? candidate : null;
}

function runCommand(
  executable: string,
  args: string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let proc: ChildProcess;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    try {
      proc = spawn(executable, args, {
        env: options.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ status: null, stdout, stderr: (error as Error).message });
      return;
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-STDERR_BUFFER_LIMIT);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_BUFFER_LIMIT);
    });
    proc.once("error", (error) => finish({ status: null, stdout, stderr: error.message }));
    proc.once("close", (status) => finish({ status, stdout, stderr }));

    timer = setTimeout(() => {
      proc.kill();
      finish({ status: null, stdout, stderr });
    }, options.timeoutMs);
    timer.unref?.();
  });
}

async function locateExecutable(command: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const locator = process.platform === "win32" ? "where" : "which";
  const result = await runCommand(locator, [command], { timeoutMs: 5_000, env });
  return result.status === 0 && result.stdout
    ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
    : null;
}

/**
 * Locate the `jupyter` executable. Node's spawn does not apply PATHEXT on
 * Windows, so we resolve the absolute path via `where`/`command -v` and spawn
 * that directly (avoids shell-quoting issues with spaces in vault paths).
 * Result is cached briefly so status polls stay cheap.
 */
export async function resolveJupyterExecutable(): Promise<string | null> {
  // An explicit override always wins and bypasses the cache so the operator can
  // point at a specific interpreter without restarting the server.
  const override = process.env.SMART_NOTES_JUPYTER_CMD;
  if (override && override.trim()) {
    return override.trim();
  }

  const profileExecutable = resolveProfileExecutable();
  if (profileExecutable) {
    return profileExecutable;
  }

  const g = globalThis as Record<string, unknown>;
  const cached = g[AVAILABILITY_KEY] as AvailabilityCache | undefined;
  if (cached && Date.now() - cached.checkedAt < AVAILABILITY_TTL_MS) {
    return cached.executable;
  }
  if (cached?.inFlight) return cached.inFlight;

  const inFlight = locateExecutable("jupyter").then((executable) => {
    g[AVAILABILITY_KEY] = { executable, checkedAt: Date.now() } satisfies AvailabilityCache;
    return executable;
  });
  g[AVAILABILITY_KEY] = {
    executable: cached?.executable ?? null,
    checkedAt: cached?.checkedAt ?? 0,
    inFlight,
  } satisfies AvailabilityCache;
  return inFlight;
}

function siblingProfileExecutable(jupyterExecutable: string, command: string): string {
  const extension = process.platform === "win32" ? ".exe" : "";
  return path.join(path.dirname(jupyterExecutable), `${command}${extension}`);
}

async function resolvePylspExecutable(jupyterExecutable: string | null): Promise<string | null> {
  const sibling = jupyterExecutable && path.dirname(jupyterExecutable) !== "."
    ? siblingProfileExecutable(jupyterExecutable, "pylsp")
    : null;
  if (sibling && fsSync.existsSync(sibling)) return sibling;
  return jupyterExecutable ? locateExecutable("pylsp", executableEnv(jupyterExecutable)) : null;
}

function executableEnv(executable: string): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH || process.env.Path || "";
  return {
    ...process.env,
    PATH: [path.dirname(executable), currentPath].filter(Boolean).join(path.delimiter),
  };
}

async function runVersion(executable: string, args: string[]): Promise<string | null> {
  const result = await runCommand(executable, args, {
    timeoutMs: 10_000,
    env: executableEnv(executable),
  });
  if (result.status !== 0) return null;
  return `${result.stdout || result.stderr || ""}`.trim().split(/\r?\n/).find(Boolean) ?? null;
}

function jupyterSelectionKey(): string {
  const override = process.env.SMART_NOTES_JUPYTER_CMD?.trim();
  if (override) return `override:${override}`;
  const profileExecutable = resolveProfileExecutable();
  if (profileExecutable) return `profile:${profileExecutable}`;
  return `path:${process.env.PATH || process.env.Path || ""}`;
}

async function resolveJupyterSelection(): Promise<JupyterExecutableSelection> {
  const override = process.env.SMART_NOTES_JUPYTER_CMD?.trim();
  const profileExecutable = resolveProfileExecutable();
  if (override) {
    return { executable: override, profileInstalled: Boolean(profileExecutable), source: "override" };
  }
  if (profileExecutable) {
    return { executable: profileExecutable, profileInstalled: true, source: "profile" };
  }
  const executable = await resolveJupyterExecutable();
  return { executable, profileInstalled: false, source: executable ? "path" : "missing" };
}

function isJupyterLspEnabled(output: string): boolean {
  return /^\s*jupyter_lsp\b[^\r\n]*\benabled\b/im.test(output);
}

async function probeJupyterProfile(): Promise<JupyterProfileStatus> {
  const selection = await resolveJupyterSelection();
  const { executable: jupyterExecutable } = selection;
  let lspInstalled = false;
  let jupyterLabVersion: string | null = null;
  if (jupyterExecutable) {
    const [labVersion, extensionList] = await Promise.all([
      runVersion(jupyterExecutable, ["lab", "--version"]),
      runCommand(jupyterExecutable, ["server", "extension", "list"], {
        timeoutMs: 10_000,
        env: executableEnv(jupyterExecutable),
      }),
    ]);
    jupyterLabVersion = labVersion;
    const output = `${extensionList.stdout}\n${extensionList.stderr}`;
    lspInstalled = extensionList.status === 0 && isJupyterLspEnabled(output);
  }

  const pylspExecutable = await resolvePylspExecutable(jupyterExecutable);
  const pylspVersion = pylspExecutable ? await runVersion(pylspExecutable, ["--version"]) : null;
  return {
    profileInstalled: selection.profileInstalled,
    source: selection.source,
    jupyterExecutable,
    jupyterLabVersion,
    lspInstalled,
    pylspReachable: Boolean(pylspVersion),
    pylspVersion,
  };
}

/** Read-only capability probe used by Settings and launch-time graceful degradation. */
export async function getJupyterProfileStatus(
  options: { refresh?: boolean; staleOk?: boolean } = {}
): Promise<JupyterProfileStatus> {
  const g = globalThis as Record<string, unknown>;
  const selectionKey = jupyterSelectionKey();
  const cached = g[PROFILE_STATUS_KEY] as ProfileStatusCache | undefined;
  const sameSelection = cached?.selectionKey === selectionKey;
  const isFresh = sameSelection && cached?.status && cached.checkedAt != null
    && Date.now() - cached.checkedAt < PROFILE_STATUS_TTL_MS;
  if (!options.refresh && isFresh) {
    return cached!.status!;
  }
  if (sameSelection && cached?.inFlight) {
    if (!options.refresh && options.staleOk !== false && cached.status) return cached.status;
    return cached.inFlight;
  }

  const inFlight = probeJupyterProfile().then((status) => {
    g[PROFILE_STATUS_KEY] = { status, checkedAt: Date.now(), selectionKey } satisfies ProfileStatusCache;
    return status;
  });
  g[PROFILE_STATUS_KEY] = {
    status: sameSelection ? cached?.status : undefined,
    checkedAt: sameSelection ? cached?.checkedAt : undefined,
    selectionKey,
    inFlight,
  } satisfies ProfileStatusCache;
  if (!options.refresh && options.staleOk !== false && sameSelection && cached?.status) {
    void inFlight.catch(() => undefined);
    return cached.status;
  }
  return inFlight;
}

async function requireJupyter(): Promise<string> {
  const executable = await resolveJupyterExecutable();
  if (!executable) {
    throw new VaultError(
      "JUPYTER_MISSING",
      "Jupyter is not installed or not on PATH. Install JupyterLab (pip install jupyterlab) and reopen this notebook.",
      503
    );
  }
  return executable;
}

// ---------------------------------------------------------------------------
// Folder / notebook-file resolution
// ---------------------------------------------------------------------------

/** Common shape spawnServer needs, regardless of whether the target is a note or a project root. */
interface ResolvedWorkspaceTarget {
  folder: string;
  notebookFile?: string;
  key: string;
  hideGlobs?: string[];
}

interface ResolvedNotebook extends ResolvedWorkspaceTarget {
  notebookFile: string;
}

async function resolveNotebook(pagePath: string): Promise<ResolvedNotebook> {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  const folder = absolutePath.replace(/\.html$/i, ".jupyter");

  const folderStat = await fs.stat(folder).catch(() => null);
  if (!folderStat?.isDirectory()) {
    throw new VaultError(
      "NOTEBOOK_UNAVAILABLE",
      "This notebook's working folder is missing. It may have been moved or deleted outside Smart Notes.",
      404
    );
  }

  const notebookAbsolute = path.join(folder, JUPYTER_NOTEBOOK_FILE_NAME);
  const notebookStat = await fs.stat(notebookAbsolute).catch(() => null);
  if (!notebookStat?.isFile()) {
    throw new VaultError(
      "NOTEBOOK_UNAVAILABLE",
      `The notebook file (${JUPYTER_NOTEBOOK_FILE_NAME}) is missing from this note's folder.`,
      404
    );
  }

  return {
    folder,
    notebookFile: JUPYTER_NOTEBOOK_FILE_NAME,
    key: path.resolve(folder).toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// Launch helpers
// ---------------------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not determine a free port.")));
      }
    });
  });
}

/** Origins permitted to embed the Jupyter iframe (CSP frame-ancestors). */
function normalizeFrameOrigin(origin: string | undefined | null): string | null {
  if (!origin?.trim()) return null;
  const trimmed = origin.trim();
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\*$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function uniqueOrigins(origins: Array<string | null | undefined>): string[] {
  return Array.from(new Set(origins.map(normalizeFrameOrigin).filter((origin): origin is string => Boolean(origin))));
}

function publicLoopbackHost(frameOrigins: string[] = []): string {
  for (const origin of frameOrigins) {
    try {
      const { hostname } = new URL(origin);
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        return hostname;
      }
    } catch {
      // Already normalized, but keep this helper defensive.
    }
  }
  return "127.0.0.1";
}

function proxyBasePath(proxyId: string): string {
  return `/api/jupyter/proxy/${encodeURIComponent(proxyId)}/`;
}

function frameAncestors(frameOrigins: string[] = []): string {
  const appPort = process.env.PORT || "3002";
  const defaults = [
    `http://localhost:${appPort}`,
    `http://127.0.0.1:${appPort}`,
    "http://localhost:*",
    "http://127.0.0.1:*",
  ];
  const extra = (process.env.SMART_NOTES_JUPYTER_FRAME_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return ["'self'", ...uniqueOrigins([...defaults, ...frameOrigins, ...extra])].join(" ");
}

/**
 * Python config for the spawned server. Forward-slash paths are used because
 * Windows Python accepts them and they avoid backslash-escaping in the raw
 * string literal. The token protects the loopback-bound server; the CSP header
 * whitelists the Smart Notes origin so the notebook can be framed in-app.
 */
function buildConfig(
  folder: string,
  port: number,
  token: string,
  frameOrigins: string[] = [],
  basePath = "/",
  lsp?: {
    enabled: boolean;
    pylspExecutable: string | null;
    userSettingsDir: string | null;
    workspacesDir?: string | null;
  },
  hideGlobs?: string[]
): string {
  const posixFolder = folder.replace(/\\/g, "/");
  const csp = `frame-ancestors ${frameAncestors(frameOrigins)}`;
  const config = [
    `c.ServerApp.ip = "127.0.0.1"`,
    `c.ServerApp.port = ${port}`,
    `c.ServerApp.port_retries = 0`,
    `c.ServerApp.open_browser = False`,
    `c.ServerApp.allow_remote_access = True`,
    `c.ServerApp.trust_xheaders = True`,
    `c.ServerApp.root_dir = r"${posixFolder}"`,
    `c.ServerApp.base_url = "${basePath}"`,
    // Smart Notes injects a same-origin bridge that reads public JupyterLab
    // application signals. Exposing the app is the supported LabApp switch and
    // does not grant the host kernel or notebook-content ownership.
    `c.LabApp.expose_app_in_browser = True`,
    `c.IdentityProvider.token = "${token}"`,
    `c.ServerApp.allow_origin = "*"`,
    `c.ServerApp.tornado_settings = {"headers": {"Content-Security-Policy": ${JSON.stringify(csp)}}}`,
  ];
  if (hideGlobs?.length) {
    // Project-backed workspaces only (SN-256): keep dependency/build/VCS/secret
    // paths out of the JupyterLab file browser and contents listing by default.
    config.push(`c.ContentsManager.hide_globs = ${JSON.stringify(hideGlobs)}`);
  }
  if (lsp?.userSettingsDir) {
    config.push(`c.LabApp.user_settings_dir = r"${lsp.userSettingsDir.replace(/\\/g, "/")}"`);
  }
  if (lsp?.workspacesDir) {
    config.push(`c.LabApp.workspaces_dir = r"${lsp.workspacesDir.replace(/\\/g, "/")}"`);
  }
  if (lsp?.enabled && lsp.pylspExecutable) {
    const pylspExecutable = lsp.pylspExecutable.replace(/\\/g, "/");
    config.push(
      `c.ServerApp.jpserver_extensions = {"jupyter_lsp": True}`,
      `c.LanguageServerManager.language_servers = {"pylsp": {"version": 2, "argv": [r"${pylspExecutable}"], "languages": ["python"], "mime_types": ["text/x-python", "text/x-ipython"], "display_name": "pylsp"}}`
    );
  }
  return [...config, ""].join("\n");
}

const COMPLETER_SETTINGS = {
  autoCompletion: true,
};

const LSP_SETTINGS = {
  language_servers: {
    pylsp: {
      priority: 100,
      serverSettings: {
        "pylsp.plugins.jedi_completion.enabled": true,
        "pylsp.plugins.jedi_completion.eager": false,
        "pylsp.plugins.jedi_completion.fuzzy": false,
        "pylsp.plugins.jedi_completion.include_params": true,
        "pylsp.plugins.jedi_signature_help.enabled": true,
        "pylsp.plugins.jedi_definition.enabled": true,
        "pylsp.plugins.jedi_hover.enabled": true,
        "pylsp.plugins.jedi_references.enabled": true,
        "pylsp.plugins.rope_rename.enabled": true,
        "pylsp.plugins.autopep8.enabled": true,
      },
    },
  },
};

const CODE_FONT_FAMILY = "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const THEME_SETTINGS = {
  "adaptive-theme": true,
  "preferred-light-theme": "JupyterLab Light",
  "preferred-dark-theme": "JupyterLab Dark",
  "theme-scrollbars": true,
  overrides: {
    "code-font-family": CODE_FONT_FAMILY,
    "code-font-size": "13px",
    "content-font-family": "Hanken Grotesk, system-ui, sans-serif",
    "content-font-size1": "13px",
    "ui-font-family": "Hanken Grotesk, system-ui, sans-serif",
    "ui-font-size1": "13px",
  },
};

const EDITOR_CONFIG = {
  autoClosingBrackets: true,
  codeFolding: true,
  fontFamily: CODE_FONT_FAMILY,
  fontSize: 13,
  highlightActiveLine: true,
  lineHeight: 1.5,
  lineNumbers: true,
  lineWrap: false,
  matchBrackets: true,
  insertSpaces: true,
  tabSize: 4,
};

const FILE_EDITOR_SETTINGS = {
  editorConfig: EDITOR_CONFIG,
  scrollPastEnd: true,
};

const NOTEBOOK_SETTINGS = {
  codeCellConfig: EDITOR_CONFIG,
  markdownCellConfig: {
    autoClosingBrackets: true,
    fontFamily: CODE_FONT_FAMILY,
    fontSize: 13,
    lineHeight: 1.5,
    lineNumbers: false,
    lineWrap: true,
    matchBrackets: true,
  },
  rawCellConfig: EDITOR_CONFIG,
  autoStartDefaultKernel: false,
  recordTiming: true,
  scrollPastEnd: true,
};

const TERMINAL_SETTINGS = {
  fontFamily: CODE_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.2,
  theme: "inherit",
  scrollback: 10_000,
  shutdownOnClose: false,
  closeOnExit: true,
  cursorBlink: true,
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Recursively add curated defaults while treating every existing owner value as authoritative. */
function mergeMissingDefaults(defaults: JsonObject, existing: JsonObject): JsonObject {
  const merged: JsonObject = { ...defaults };
  for (const [key, value] of Object.entries(existing)) {
    merged[key] = isJsonObject(value) && isJsonObject(defaults[key])
      ? mergeMissingDefaults(defaults[key] as JsonObject, value)
      : value;
  }
  return merged;
}

async function writeSettingDefaults(filePath: string, defaults: JsonObject): Promise<void> {
  let existing: JsonObject = {};
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    // Jupyter also accepts JSON5-like settings. If an owner used comments or
    // otherwise non-JSON syntax, leave the file byte-for-byte untouched.
    if (!isJsonObject(parsed)) return;
    existing = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
  const merged = mergeMissingDefaults(defaults, existing);
  if (JSON.stringify(merged) === JSON.stringify(existing)) return;
  await fs.writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

async function writeLabUserSettings(userSettingsDir: string): Promise<void> {
  const completerDir = path.join(userSettingsDir, "@jupyterlab", "completer-extension");
  const lspDir = path.join(userSettingsDir, "@jupyter-lsp", "jupyterlab-lsp");
  const appUtilsDir = path.join(userSettingsDir, "@jupyterlab", "apputils-extension");
  const fileEditorDir = path.join(userSettingsDir, "@jupyterlab", "fileeditor-extension");
  const notebookDir = path.join(userSettingsDir, "@jupyterlab", "notebook-extension");
  const terminalDir = path.join(userSettingsDir, "@jupyterlab", "terminal-extension");
  await Promise.all([
    fs.mkdir(completerDir, { recursive: true }),
    fs.mkdir(lspDir, { recursive: true }),
    fs.mkdir(appUtilsDir, { recursive: true }),
    fs.mkdir(fileEditorDir, { recursive: true }),
    fs.mkdir(notebookDir, { recursive: true }),
    fs.mkdir(terminalDir, { recursive: true }),
  ]);
  await Promise.all([
    writeSettingDefaults(
      path.join(completerDir, "manager.jupyterlab-settings"),
      COMPLETER_SETTINGS
    ),
    writeSettingDefaults(
      path.join(lspDir, "plugin.jupyterlab-settings"),
      LSP_SETTINGS
    ),
    writeSettingDefaults(
      path.join(lspDir, "completion.jupyterlab-settings"),
      { continuousHinting: false }
    ),
    writeSettingDefaults(
      path.join(lspDir, "signature.jupyterlab-settings"),
      { disable: false }
    ),
    writeSettingDefaults(path.join(appUtilsDir, "themes.jupyterlab-settings"), THEME_SETTINGS),
    writeSettingDefaults(path.join(fileEditorDir, "plugin.jupyterlab-settings"), FILE_EDITOR_SETTINGS),
    writeSettingDefaults(path.join(notebookDir, "tracker.jupyterlab-settings"), NOTEBOOK_SETTINGS),
    writeSettingDefaults(path.join(terminalDir, "plugin.jupyterlab-settings"), TERMINAL_SETTINGS),
  ]);
}

function jupyterLabStatePaths(): { userSettingsDir: string; workspacesDir: string } {
  const labStateDir = path.join(getAppStateDir(), "jupyter", "lab");
  return {
    userSettingsDir: path.join(labStateDir, "user-settings"),
    workspacesDir: path.join(labStateDir, "workspaces"),
  };
}

/** Project-backed workspaces (no canonical notebook, SN-256) open the root `/lab` view instead of a `/lab/tree/<file>`. */
function labUrl(baseUrl: string, notebookFile: string | undefined, token: string): string {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  if (!notebookFile) {
    return `${trimmedBase}/lab?token=${encodeURIComponent(token)}`;
  }
  return `${trimmedBase}/lab/tree/${encodeURIComponent(notebookFile)}?token=${encodeURIComponent(token)}`;
}

async function pingReady(baseUrl: string, token: string, basePath = "/"): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    const statusUrl = `${baseUrl}${basePath.replace(/\/$/, "")}/api/status?token=${encodeURIComponent(token)}`;
    const response = await fetch(statusUrl, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait until the server answers /api/status or the process dies / times out.
 * Distinguishes a port conflict (from the child's stderr) from a generic
 * launch failure so the UI can advise the user precisely.
 */
async function waitForReady(session: JupyterSession): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited = false;

  const proc = session.proc;
  if (proc) {
    proc.once("exit", () => {
      exited = true;
    });
  }

  while (Date.now() < deadline) {
    if (session.spawnError) {
      // The executable could not be launched at all — most often it is missing.
      const missing = session.spawnError.code === "ENOENT";
      throw new VaultError(
        missing ? "JUPYTER_MISSING" : "SERVER_LAUNCH_FAILED",
        missing
          ? "Jupyter could not be launched (executable not found). Install JupyterLab (pip install jupyterlab) and retry."
          : `Jupyter could not be launched: ${session.spawnError.message}`,
        missing ? 503 : 500
      );
    }
    if (exited) {
      const conflict = /address already in use|EADDRINUSE|port .* is already in use/i.test(session.logTail);
      throw new VaultError(
        conflict ? "PORT_CONFLICT" : "SERVER_LAUNCH_FAILED",
        conflict
          ? "The chosen port was taken before Jupyter could bind it. Try opening the notebook again."
          : `The Jupyter server exited before it became ready.${tailHint(session.logTail)}`,
        conflict ? 409 : 500
      );
    }
    if (await pingReady(session.baseUrl, session.token, session.proxyBasePath)) {
      return;
    }
    await delay(READY_POLL_INTERVAL_MS);
  }

  throw new VaultError(
    "SERVER_LAUNCH_FAILED",
    `Jupyter did not become ready within ${Math.round(READY_TIMEOUT_MS / 1000)}s.${tailHint(session.logTail)}`,
    500
  );
}

function tailHint(logTail: string): string {
  const trimmed = logTail.trim();
  if (!trimmed) return "";
  const lastLine = trimmed.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "";
  return lastLine ? ` (${lastLine.slice(0, 200)})` : "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLog(session: JupyterSession, chunk: string): void {
  session.logTail = (session.logTail + chunk).slice(-STDERR_BUFFER_LIMIT);
}

async function spawnServer(
  resolved: ResolvedWorkspaceTarget,
  pagePath: string,
  frameOrigins: string[],
  kind: WorkspaceKind = "note",
  accessMode?: WorkspaceAccessMode,
  workspaceMeta?: ProjectWorkspaceMeta
): Promise<JupyterSession> {
  const executable = await requireJupyter();
  const port = await findFreePort();
  const proxyId = crypto.randomBytes(16).toString("hex");
  const basePath = proxyBasePath(proxyId);
  const token = crypto.randomBytes(24).toString("hex");
  const baseUrl = `http://127.0.0.1:${port}`;

  const configDir = path.join(os.tmpdir(), "smart-notes-jupyter");
  await fs.mkdir(configDir, { recursive: true });
  const artifactDir = path.join(configDir, `session-${proxyId}`);
  const { userSettingsDir, workspacesDir } = jupyterLabStatePaths();
  const configPath = path.join(artifactDir, "jupyter_server_config.py");
  await Promise.all([
    fs.mkdir(artifactDir, { recursive: true }),
    fs.mkdir(workspacesDir, { recursive: true }),
  ]);
  await writeLabUserSettings(userSettingsDir);

  const capabilities = await getJupyterProfileStatus({ staleOk: false });
  const pylspExecutable = capabilities.pylspReachable
    ? await resolvePylspExecutable(executable)
    : null;
  await fs.writeFile(
    configPath,
    buildConfig(resolved.folder, port, token, frameOrigins, basePath, {
      enabled: capabilities.lspInstalled && capabilities.pylspReachable,
      pylspExecutable,
      userSettingsDir,
      workspacesDir,
    }, resolved.hideGlobs),
    "utf8"
  );

  const session: JupyterSession = {
    key: resolved.key,
    pagePath,
    folder: resolved.folder,
    notebookFile: resolved.notebookFile,
    proxyId,
    proxyBasePath: basePath,
    port,
    token,
    baseUrl,
    frameOrigins,
    status: "starting",
    startedAt: new Date().toISOString(),
    configPath,
    artifactDir,
    logTail: "",
    kind,
    accessMode,
    workspaceMeta,
  };

  let proc: ChildProcess;
  try {
    proc = spawn(executable, ["lab", "--config", configPath, "--no-browser"], {
      cwd: resolved.folder,
      env: executableEnv(executable),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    await fs.rm(artifactDir, { recursive: true, force: true }).catch(() => undefined);
    throw new VaultError(
      "SERVER_LAUNCH_FAILED",
      `Could not start Jupyter: ${(error as Error).message}`,
      500
    );
  }

  session.proc = proc;
  proc.stdout?.on("data", (chunk: Buffer) => appendLog(session, chunk.toString("utf8")));
  proc.stderr?.on("data", (chunk: Buffer) => appendLog(session, chunk.toString("utf8")));
  proc.once("error", (error) => {
    session.spawnError = error as NodeJS.ErrnoException;
    appendLog(session, `\n[spawn error] ${error.message}\n`);
  });
  proc.once("exit", (code, signal) => {
    if (session.status !== "stopped") {
      session.status = "error";
      session.errorCode = session.errorCode ?? "SERVER_DOWN";
      session.errorMessage =
        session.errorMessage ?? `Jupyter server stopped unexpectedly (code=${code ?? "?"}, signal=${signal ?? "?"}).`;
    }
    void fs.rm(session.artifactDir ?? session.configPath ?? "", { recursive: true, force: true }).catch(() => undefined);
  });

  return session;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function toView(session: JupyterSession): JupyterSessionView {
  const base: JupyterSessionView = {
    status: session.status,
    url: session.status === "ready" ? labUrl(session.proxyBasePath, session.notebookFile, session.token) : undefined,
    port: session.port,
    pagePath: session.pagePath,
    errorCode: session.errorCode,
    errorMessage: session.errorMessage,
  };
  if (session.kind === "project") {
    return {
      ...base,
      accessMode: session.accessMode,
      rootPath: session.workspaceMeta?.rootPath,
      branch: session.workspaceMeta?.branch,
      projectId: session.workspaceMeta?.projectId,
      repoId: session.workspaceMeta?.repoId,
    };
  }
  return base;
}

/**
 * Launch a new session or connect to an existing healthy one for the given
 * resolved target (a note's `.jupyter` folder or a project/worktree root).
 * Concurrent callers share a single in-flight launch. Returns a client-safe
 * view; throws VaultError with a JupyterErrorCode on failure.
 */
async function ensureSessionForTarget(
  resolved: ResolvedWorkspaceTarget,
  identityPath: string,
  frameOrigin: string | null | undefined,
  kind: WorkspaceKind,
  accessMode?: WorkspaceAccessMode,
  workspaceMeta?: ProjectWorkspaceMeta
): Promise<JupyterSessionView> {
  const sessions = registry();
  const existing = sessions.get(resolved.key);
  const requestedOrigins = uniqueOrigins([frameOrigin]);

  if (existing) {
    if (
      requestedOrigins.length > 0 &&
      !requestedOrigins.every((origin) => existing.frameOrigins?.includes(origin))
    ) {
      // Jupyter's frame-ancestor header is static config. If the app is now
      // running from a different preview/dev origin, relaunch with that exact
      // origin included rather than returning an iframe the browser will block.
      await stopByKey(resolved.key);
    } else if (existing.status === "starting" && existing.startPromise) {
      try {
        await existing.startPromise;
        return toView(existing);
      } catch {
        // fall through and relaunch below
      }
    } else if (existing.status === "ready") {
      if (await pingReady(existing.baseUrl, existing.token, existing.proxyBasePath)) {
        const widensAccess = accessMode === "editable" && existing.accessMode === "read-only";
        if (widensAccess) {
          // Never trust a resume to escalate a live session's access mode
          // from read-only to editable in place. A forged/replayed request
          // (or a legitimately re-resolved one) must go through a full
          // relaunch so root containment/access mode are
          // revalidated end-to-end, rather than flipping a flag on an
          // already-running server. Fall through to the relaunch path below.
          await stopByKey(resolved.key);
        } else {
          existing.pagePath = identityPath;
          // Narrowing (editable -> read-only) or an unchanged access mode is
          // safe to apply to the live session without a relaunch.
          existing.accessMode = accessMode ?? existing.accessMode;
          existing.workspaceMeta = workspaceMeta ?? existing.workspaceMeta;
          return toView(existing);
        }
      } else {
        // Server died silently — tear down and relaunch.
        await stopByKey(resolved.key);
      }
    }
  }

  const session = await spawnServer(resolved, identityPath, requestedOrigins, kind, accessMode, workspaceMeta);
  sessions.set(resolved.key, session);

  const startPromise = waitForReady(session)
    .then(() => {
      session.status = "ready";
      session.errorCode = undefined;
      session.errorMessage = undefined;
    })
    .catch((error: unknown) => {
      session.status = "error";
      if (error instanceof VaultError) {
        session.errorCode = error.code as JupyterErrorCode;
        session.errorMessage = error.message;
      } else {
        session.errorCode = "SERVER_LAUNCH_FAILED";
        session.errorMessage = (error as Error).message;
      }
      killProcess(session);
      throw error;
    });

  session.startPromise = startPromise;
  await startPromise;
  return toView(session);
}

/**
 * Launch a new session or connect to an existing healthy one for the given
 * note. Concurrent callers share a single in-flight launch. Returns a
 * client-safe view; throws VaultError with a JupyterErrorCode on failure.
 */
export async function ensureSession(
  pagePath: string,
  options: { frameOrigin?: string | null } = {}
): Promise<JupyterSessionView> {
  const resolved = await resolveNotebook(pagePath);
  return ensureSessionForTarget(resolved, pagePath, options.frameOrigin, "note");
}

/**
 * Open (or resume) a project-backed Deep Work workspace rooted at an explicit,
 * owner-selected project/worktree folder (SN-256/SN-259). No files are
 * copied into the vault and no canonical notebook is required. See
 * `resolveProjectWorkspace` for the root containment/access-mode
 * validation performed before any server is spawned.
 */
export async function ensureProjectWorkspaceSession(
  request: ProjectWorkspaceRequest,
  options: { frameOrigin?: string | null } = {}
): Promise<JupyterSessionView> {
  const resolved = await resolveProjectWorkspace(request);
  const target: ResolvedWorkspaceTarget = {
    key: resolved.key,
    folder: resolved.realRoot,
    hideGlobs: resolved.hideGlobs,
  };
  return ensureSessionForTarget(target, resolved.realRoot, options.frameOrigin, "project", resolved.accessMode, {
    rootPath: resolved.realRoot,
    branch: resolved.branch,
    projectId: resolved.projectId,
    repoId: resolved.repoId,
  });
}

/** Return the current status for a note's session without launching one. */
export async function getSessionStatus(pagePath: string): Promise<JupyterSessionView> {
  let key: string;
  try {
    const resolved = await resolveNotebook(pagePath);
    key = resolved.key;
  } catch (error) {
    if (error instanceof VaultError && error.code === "NOTEBOOK_UNAVAILABLE") {
      return { status: "error", pagePath, errorCode: "NOTEBOOK_UNAVAILABLE", errorMessage: error.message };
    }
    throw error;
  }

  const session = registry().get(key);
  if (!session) {
    return { status: "stopped", pagePath };
  }
  if (session.status === "ready" && !(await pingReady(session.baseUrl, session.token, session.proxyBasePath))) {
    session.status = "error";
    session.errorCode = "SERVER_DOWN";
    session.errorMessage = "The Jupyter server is no longer responding.";
  }
  session.pagePath = pagePath;
  return toView(session);
}

/** Return the current status for a project workspace without launching one. */
export async function getProjectWorkspaceStatus(request: ProjectWorkspaceRequest): Promise<JupyterSessionView> {
  const resolved = await resolveProjectWorkspace(request);
  const session = registry().get(resolved.key);
  if (!session) {
    return {
      status: "stopped",
      pagePath: resolved.realRoot,
      rootPath: resolved.realRoot,
      accessMode: resolved.accessMode,
      resolvedAccessMode: resolved.accessMode,
      branch: resolved.branch,
    };
  }
  if (session.status === "ready" && !(await pingReady(session.baseUrl, session.token, session.proxyBasePath))) {
    session.status = "error";
    session.errorCode = "SERVER_DOWN";
    session.errorMessage = "The Jupyter server is no longer responding.";
  }
  return {
    ...toView(session),
    resolvedAccessMode: resolved.accessMode,
    branch: resolved.branch ?? session.workspaceMeta?.branch,
  };
}

/** Stop and dispose of a note's session (best-effort process-tree kill). */
export async function stopSession(pagePath: string): Promise<{ stopped: boolean }> {
  const resolved = await resolveNotebook(pagePath).catch(() => null);
  if (!resolved) {
    return { stopped: false };
  }
  return { stopped: await stopByKey(resolved.key) };
}

/** Stop and dispose of a project workspace session (best-effort process-tree kill). */
export async function stopProjectWorkspaceSession(request: ProjectWorkspaceRequest): Promise<{ stopped: boolean }> {
  const resolved = await resolveProjectWorkspace(request).catch(() => null);
  if (!resolved) {
    return { stopped: false };
  }
  return { stopped: await stopByKey(resolved.key) };
}

/** Stop every running/starting Jupyter session owned by this app process. */
export async function stopAllSessions(): Promise<{ stopped: number }> {
  const keys = Array.from(registry().keys());
  let stopped = 0;
  for (const key of keys) {
    if (await stopByKey(key)) {
      stopped += 1;
    }
  }
  return { stopped };
}

async function stopByKey(key: string): Promise<boolean> {
  const sessions = registry();
  const session = sessions.get(key);
  if (!session) {
    return false;
  }
  session.status = "stopped";
  killProcess(session);
  if (session.artifactDir || session.configPath) {
    await fs.rm(session.artifactDir ?? session.configPath ?? "", { recursive: true, force: true }).catch(() => undefined);
  }
  sessions.delete(key);
  return true;
}

function killProcess(session: JupyterSession): void {
  const proc = session.proc;
  if (!proc || proc.killed || proc.pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      // Kill the whole tree so spawned kernels do not linger.
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    // best-effort
  }
}

/** Test hook: clear the in-memory registry between unit tests. */
export function __resetForTesting(): void {
  const g = globalThis as Record<string, unknown>;
  g[REGISTRY_KEY] = new Map<string, JupyterSession>();
  g[AVAILABILITY_KEY] = undefined;
  g[PROFILE_STATUS_KEY] = undefined;
}

export const __testInternals = {
  buildConfig,
  executableEnv,
  frameAncestors,
  findFreePort,
  labUrl,
  normalizeFrameOrigin,
  profileExecutablePath,
  proxyBasePath,
  publicLoopbackHost,
  resolvePylspExecutable,
  resolveProfileExecutable,
  resolveJupyterSelection,
  siblingProfileExecutable,
  uniqueOrigins,
  isJupyterLspEnabled,
  jupyterLabStatePaths,
  runCommand,
  writeLabUserSettings,
};
