import type { JupyterFocusState } from "@/lib/jupyter-focus";

export type DeepWorkAccess = "read-only" | "editable";

export interface DeepWorkDescriptor {
  rootPath: string;
  projectId?: string;
  repoId?: string;
  workItemId?: string;
  projectName: string;
  branch?: string;
  worktreeLabel?: string;
  requestedAccess: DeepWorkAccess;
  ownerOpen?: boolean;
  defaultBranchEditConfirmed?: boolean;
  activeFile?: string;
  activeLine?: number;
  returnUrl?: string;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const BLOCKED_SEGMENTS = new Set([
  ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
  "dist", "build", "out", ".next", ".turbo", ".cache", ".ipynb_checkpoints",
  "coverage", "vendor",
]);
const SECRET_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /^(?:id_rsa|id_ed25519)(?:\.pub)?$/i,
  /(?:^|[-_.])(?:secret|secrets|credential|credentials|token|private[-_.]?key)(?:[-_.]|$)/i,
];

function clean(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

export function normalizeDeepWorkRelativePath(value: unknown): string | null {
  const text = clean(typeof value === "string" ? value : null, 1024);
  if (!text) return null;
  const normalized = text.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

export function workspacePathBlockReason(value: unknown): string | null {
  const relativePath = normalizeDeepWorkRelativePath(value);
  if (!relativePath) return "Path must be a safe repository-relative path.";
  for (const segment of relativePath.split("/")) {
    if (segment.startsWith(".")) return "Hidden paths are not available to Deep Work source tools.";
    if (BLOCKED_SEGMENTS.has(segment.toLowerCase())) {
      return "Dependency, build, cache, and VCS paths are not available to Deep Work source tools.";
    }
    if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(segment))) {
      return "Secret-shaped paths never contribute source content.";
    }
  }
  return null;
}

function safeId(value: string | null, fallback: string): string {
  const candidate = clean(value, 200);
  return candidate && ID_PATTERN.test(candidate) ? candidate : fallback;
}

export function workspaceDisplayNameFromPath(value: string): string {
  const normalized = value.trim().replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || "Deep Work workspace";
}

export function configuredAscentVectorOrigins(): Set<string> {
  const configured =
    typeof process !== "undefined" ? process.env.SMART_NOTES_AV_ORIGINS?.trim() : "";
  const values = configured
    ? configured.split(",").map((value) => value.trim()).filter(Boolean)
    : [
        "http://localhost",
        "http://127.0.0.1",
        "https://localhost",
        "https://127.0.0.1",
      ];
  const origins = new Set<string>();
  for (const value of values) {
    try {
      const url = new URL(value);
      if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
        origins.add(url.origin);
      }
    } catch {
      // Invalid configured entries grant nothing.
    }
  }
  return origins;
}

export function validateDeepWorkReturnUrl(
  value: unknown,
  options: { serverValidated?: boolean } = {}
): string | null {
  const text = clean(typeof value === "string" ? value : null, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    if (!options.serverValidated && !configuredAscentVectorOrigins().has(url.origin)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function parseDeepWorkDescriptor(
  params: Pick<URLSearchParams, "get">
): DeepWorkDescriptor | null {
  if (params.get("deepWork") !== "1") return null;
  const rootPath = clean(params.get("root"), 2048);
  const projectId = params.get("projectId");
  const repoId = params.get("repoId");
  const workItemId = params.get("workItemId") ?? params.get("briefId");
  const projectName = clean(params.get("projectName"), 200) ?? (rootPath ? workspaceDisplayNameFromPath(rootPath) : null);
  const branch = clean(params.get("branch"), 300);
  const worktreeLabel = clean(params.get("worktree"), 300);
  const requestedAccess = params.get("access");
  if (
    !rootPath ||
    !projectName ||
    (requestedAccess !== "read-only" && requestedAccess !== "editable") ||
    (projectId !== null && !ID_PATTERN.test(projectId)) ||
    (repoId !== null && !ID_PATTERN.test(repoId)) ||
    (workItemId !== null && !ID_PATTERN.test(workItemId))
  ) {
    return null;
  }
  // The server performs the authoritative absolute/registered-root check.
  if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(rootPath)) return null;

  const activeFileValue = params.get("file");
  const activeFile = activeFileValue === null ? undefined : normalizeDeepWorkRelativePath(activeFileValue) ?? undefined;
  if (activeFileValue !== null && !activeFile) return null;
  const lineValue = params.get("line");
  const parsedLine = lineValue === null ? undefined : Number(lineValue);
  if (lineValue !== null && (!Number.isInteger(parsedLine) || parsedLine! < 1 || parsedLine! > 10_000_000)) {
    return null;
  }
  if (parsedLine !== undefined && !activeFile) return null;
  const rawReturnUrl = params.get("returnUrl");
  // The server capability exchange applies SMART_NOTES_AV_ORIGINS. The client
  // performs only syntax/scheme validation so configured non-local AV origins
  // are not accidentally rejected by a browser bundle that cannot read server env.
  const returnUrl = rawReturnUrl === null
    ? undefined
    : validateDeepWorkReturnUrl(rawReturnUrl, { serverValidated: true }) ?? undefined;
  if (rawReturnUrl !== null && !returnUrl) return null;
  // Execution output is intentionally never accepted from URL/history. It may
  // only be attached to the server-side capability exchange POST.
  if (params.get("executionContext") !== null || params.get("executionApproved") !== null) return null;

  return {
    rootPath,
    projectId: projectId ? safeId(projectId, "") : undefined,
    repoId: repoId ? safeId(repoId, "") : undefined,
    workItemId: workItemId ? safeId(workItemId, "") : undefined,
    projectName,
    branch: branch ?? undefined,
    worktreeLabel: worktreeLabel ?? undefined,
    requestedAccess,
    activeFile,
    activeLine: parsedLine,
    returnUrl,
  };
}

/** Non-authorizing UI key used before the server returns a capability. */
export function deepWorkPendingPath(descriptor: DeepWorkDescriptor): string {
  const identity = descriptor.projectId && descriptor.repoId && descriptor.workItemId
    ? `${descriptor.projectId}:${descriptor.repoId}:${descriptor.workItemId}`
    : encodeURIComponent(descriptor.rootPath);
  return `deep-work-pending:${identity}`;
}

export function buildAscentVectorReturnUrl(
  descriptor: DeepWorkDescriptor,
  surface: "workspace" | "diff",
  focus?: JupyterFocusState | null,
  options: { serverValidatedReturnUrl?: boolean } = {}
): string | null {
  if (!descriptor.returnUrl) return null;
  const validated = validateDeepWorkReturnUrl(descriptor.returnUrl, {
    serverValidated: options.serverValidatedReturnUrl,
  });
  if (!validated) return null;
  const url = new URL(validated);
  url.searchParams.set("surface", surface === "diff" ? "dirty-tree-diff" : "work-item");
  if (descriptor.projectId) url.searchParams.set("projectId", descriptor.projectId);
  if (descriptor.repoId) url.searchParams.set("repoId", descriptor.repoId);
  if (descriptor.workItemId) url.searchParams.set("workItemId", descriptor.workItemId);
  if (descriptor.branch) url.searchParams.set("branch", descriptor.branch);
  if (descriptor.worktreeLabel) url.searchParams.set("worktree", descriptor.worktreeLabel);
  const file = focus?.workspacePath ?? descriptor.activeFile;
  if (file && normalizeDeepWorkRelativePath(file)) url.searchParams.set("file", file);
  return url.toString();
}

export function projectFocusSource(focus: JupyterFocusState | null | undefined): {
  source: string | null;
  blocked: boolean;
  selectedText: string | null;
} {
  if (!focus?.workspacePath || workspacePathBlockReason(focus.workspacePath)) {
    return { source: null, blocked: Boolean(focus?.workspacePath), selectedText: null };
  }
  const source = focus.content?.activeCellSource ?? null;
  if (typeof source !== "string") return { source: null, blocked: false, selectedText: null };
  const sourceStart = focus.content?.activeCellSourceStart ?? 0;
  const selection = focus.selection;
  const start = selection ? Math.min(selection.start.offset, selection.end.offset) - sourceStart : 0;
  const end = selection ? Math.max(selection.start.offset, selection.end.offset) - sourceStart : 0;
  return {
    source,
    blocked: false,
    selectedText: selection && start >= 0 && end <= source.length ? source.slice(start, end) : null,
  };
}
