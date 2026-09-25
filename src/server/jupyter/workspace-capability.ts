import crypto from "node:crypto";
import path from "node:path";

import { validateDeepWorkReturnUrl } from "@/lib/deep-work";
import type {
  ProjectWorkspaceRequest,
  ResolvedProjectWorkspace,
  WorkspaceAccessMode,
} from "@/server/jupyter/workspace-root";
import { VaultError } from "@/server/vault/errors";

const CAPABILITY_PREFIX = "dwc_";
const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;
const CAPABILITY_MAX_COUNT = 256;
const EXECUTION_CONTEXT_MAX_BYTES = 8 * 1024;
const META_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/;
const REGISTRY_KEY = "__smartNotesDeepWorkCapabilities__";

export interface WorkspaceCapabilityRecord {
  token: string;
  realRoot: string;
  accessMode: WorkspaceAccessMode;
  projectId?: string;
  repoId?: string;
  workItemId?: string;
  branch?: string;
  worktreeLabel?: string;
  projectName: string;
  ownerOpen?: boolean;
  defaultBranchEditConfirmed?: boolean;
  returnUrl?: string;
  executionContext?: string;
  issuedAt: number;
  expiresAt: number;
}

export interface WorkspaceCapabilityView {
  capability: string;
  accessMode: WorkspaceAccessMode;
  projectId?: string;
  repoId?: string;
  workItemId?: string;
  branch?: string;
  worktreeLabel?: string;
  projectName: string;
  returnUrl?: string;
  executionContext?: string;
  expiresAt: number;
}

type CapabilityRegistry = Map<string, WorkspaceCapabilityRecord>;

function registry(): CapabilityRegistry {
  const host = globalThis as typeof globalThis & { [REGISTRY_KEY]?: CapabilityRegistry };
  if (!host[REGISTRY_KEY]) host[REGISTRY_KEY] = new Map();
  return host[REGISTRY_KEY]!;
}

function boundedMetadata(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new VaultError("INVALID_WORKSPACE_IDENTITY", `${label} is required.`);
  }
  const trimmed = value.trim();
  if (!META_PATTERN.test(trimmed)) {
    throw new VaultError("INVALID_WORKSPACE_IDENTITY", `${label} is malformed.`);
  }
  return trimmed;
}

function boundedOptionalMetadata(value: unknown, label: string): string | undefined {
  return value === undefined || value === null || value === ""
    ? undefined
    : boundedMetadata(value, label);
}

export function sanitizeExecutionContext(value: string): string {
  // Prevent untrusted output from closing or imitating the explicit delimiter
  // used in provider context. JSON-style escapes remain readable as data.
  return value
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
}

function executionContextFromIssuance(input: {
  executionApproved?: unknown;
  executionContext?: unknown;
}): string | undefined {
  if (input.executionContext === undefined || input.executionContext === null || input.executionContext === "") {
    return undefined;
  }
  if (input.executionApproved !== true || typeof input.executionContext !== "string") {
    throw new VaultError(
      "EXECUTION_CONTEXT_NOT_APPROVED",
      "Execution context requires an explicit executionApproved boolean in the capability issuance POST.",
      403
    );
  }
  if (
    input.executionContext.includes("\u0000") ||
    Buffer.byteLength(input.executionContext, "utf8") > EXECUTION_CONTEXT_MAX_BYTES
  ) {
    throw new VaultError("EXECUTION_CONTEXT_TOO_LARGE", "Execution context exceeds the 8 KiB UTF-8 limit.", 413);
  }
  return sanitizeExecutionContext(input.executionContext);
}

function pruneCapabilities(now: number): void {
  const entries = registry();
  for (const [token, record] of entries) {
    if (record.expiresAt <= now) entries.delete(token);
  }
  while (entries.size >= CAPABILITY_MAX_COUNT) {
    const oldest = [...entries.values()].sort((a, b) => a.issuedAt - b.issuedAt)[0];
    if (!oldest) break;
    entries.delete(oldest.token);
  }
}

export function issueWorkspaceCapability(
  request: ProjectWorkspaceRequest & {
    projectName?: unknown;
    workItemId?: unknown;
    worktreeLabel?: unknown;
    returnUrl?: unknown;
    executionApproved?: unknown;
    executionContext?: unknown;
  },
  resolved: ResolvedProjectWorkspace
): WorkspaceCapabilityView {
  const projectId = boundedOptionalMetadata(request.projectId, "projectId");
  const repoId = boundedOptionalMetadata(request.repoId, "repoId");
  const workItemId = boundedOptionalMetadata(request.workItemId, "workItemId");
  const branch = boundedOptionalMetadata(resolved.branch, "branch");
  const worktreeLabel = boundedOptionalMetadata(request.worktreeLabel, "worktreeLabel");
  const projectName =
    typeof request.projectName === "string" && request.projectName.trim() && request.projectName.length <= 200
      ? request.projectName.trim()
      : path.basename(resolved.realRoot) || "Deep Work workspace";
  const returnUrl = request.returnUrl === undefined
    ? undefined
    : validateDeepWorkReturnUrl(request.returnUrl) ?? undefined;
  if (request.returnUrl !== undefined && !returnUrl) {
    throw new VaultError("INVALID_RETURN_URL", "Return URL origin is not an allowed Ascent Vector origin.", 400);
  }
  const executionContext = executionContextFromIssuance(request);
  const now = Date.now();
  pruneCapabilities(now);
  const token = `${CAPABILITY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const record: WorkspaceCapabilityRecord = {
    token,
    realRoot: resolved.realRoot,
    accessMode: resolved.accessMode,
    projectId,
    repoId,
    workItemId,
    branch,
    worktreeLabel,
    projectName,
    ownerOpen: request.ownerOpen === true || undefined,
    defaultBranchEditConfirmed: request.defaultBranchEditConfirmed === true || undefined,
    returnUrl,
    executionContext,
    issuedAt: now,
    expiresAt: now + CAPABILITY_TTL_MS,
  };
  registry().set(token, record);
  return capabilityView(record);
}

function capabilityView(record: WorkspaceCapabilityRecord): WorkspaceCapabilityView {
  return {
    capability: record.token,
    accessMode: record.accessMode,
    projectId: record.projectId,
    repoId: record.repoId,
    workItemId: record.workItemId,
    branch: record.branch,
    worktreeLabel: record.worktreeLabel,
    projectName: record.projectName,
    returnUrl: record.returnUrl,
    executionContext: record.executionContext,
    expiresAt: record.expiresAt,
  };
}

export function resolveWorkspaceCapability(value: unknown): WorkspaceCapabilityRecord {
  if (
    typeof value !== "string" ||
    !new RegExp(`^${CAPABILITY_PREFIX}[A-Za-z0-9_-]{43}$`).test(value)
  ) {
    throw new VaultError("INVALID_WORKSPACE_CAPABILITY", "A server-issued Deep Work capability is required.", 403);
  }
  const record = registry().get(value);
  if (!record || record.expiresAt <= Date.now()) {
    registry().delete(value);
    throw new VaultError("INVALID_WORKSPACE_CAPABILITY", "Deep Work capability is invalid or expired; relaunch the workspace.", 403);
  }
  return record;
}

export function capabilityProjectRequest(record: WorkspaceCapabilityRecord): ProjectWorkspaceRequest {
  return {
    rootPath: record.realRoot,
    projectId: record.projectId,
    repoId: record.repoId,
    branch: record.branch,
    requestedAccess: record.accessMode,
    ownerOpen: record.ownerOpen,
    defaultBranchEditConfirmed: record.defaultBranchEditConfirmed,
  };
}

export function resetWorkspaceCapabilitiesForTesting(): void {
  registry().clear();
}

export const __testInternals = {
  CAPABILITY_TTL_MS,
  EXECUTION_CONTEXT_MAX_BYTES,
  executionContextFromIssuance,
};
