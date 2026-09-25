import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeDeepWorkRelativePath } from "@/lib/deep-work";
import { atomicReplaceFile, isUtf16Boundary, withFileMutation } from "@/server/atomic-file";
import { getAppStateDir } from "@/server/app-state";
import { readWorkspaceSource } from "@/server/jupyter/workspace-files";
import {
  resolveProjectWorkspace,
  type ProjectWorkspaceRequest,
} from "@/server/jupyter/workspace-root";
import { VaultError } from "@/server/vault/errors";

const COMPANION_MAX_BYTES = 512 * 1024;
const COMPANION_MAX_SCOPES = 32;
const ANNOTATION_MAX_BYTES = 1024 * 1024;
const ANNOTATION_MAX_COUNT = 500;
const ANCHOR_TEXT_MAX = 16 * 1024;

export interface WorkspaceStateRequest extends ProjectWorkspaceRequest {
  workItemId?: string;
}

export interface WorkspaceAnnotationAnchor {
  revision: string;
  start: number;
  end: number;
  selectedText: string;
  quotedText: string;
}

export interface WorkspaceAnnotation {
  id: string;
  anchor: WorkspaceAnnotationAnchor;
  data?: unknown;
}

export interface LoadedWorkspaceAnnotation extends WorkspaceAnnotation {
  status: "current" | "relocated" | "stale";
  currentRange?: { start: number; end: number };
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function workspaceDirectory(request: WorkspaceStateRequest): Promise<string> {
  const resolved = await resolveProjectWorkspace(request);
  const identity = JSON.stringify({
    root: process.platform === "win32" ? resolved.realRoot.toLowerCase() : resolved.realRoot,
    projectId: request.projectId ?? "",
    repoId: request.repoId ?? "",
    workItemId: request.workItemId ?? "",
    branch: request.branch ?? "",
  });
  return path.join(getAppStateDir(), "deep-work", hash(identity));
}

async function atomicJsonWrite(filePath: string, value: unknown, maxBytes: number): Promise<void> {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new VaultError("WORKSPACE_STATE_TOO_LARGE", "Workspace collaboration state exceeds its size limit.", 413);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await withFileMutation(filePath, () =>
    atomicReplaceFile(filePath, serialized, { encoding: "utf8" })
  );
}

async function readJson(filePath: string, maxBytes: number): Promise<unknown> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return null;
  if (!stat.isFile() || stat.size > maxBytes) {
    throw new VaultError("WORKSPACE_STATE_INVALID", "Stored workspace collaboration state is invalid.", 500);
  }
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw new VaultError("WORKSPACE_STATE_INVALID", "Stored workspace collaboration state is unreadable.", 500);
  }
}

export async function readWorkspaceCompanion(request: WorkspaceStateRequest): Promise<{ scopes: Record<string, unknown> }> {
  const filePath = path.join(await workspaceDirectory(request), "companion.json");
  const value = await readJson(filePath, COMPANION_MAX_BYTES);
  if (!value) return { scopes: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VaultError("WORKSPACE_STATE_INVALID", "Stored companion state is invalid.", 500);
  }
  const scopes = (value as { scopes?: unknown }).scopes;
  return scopes && typeof scopes === "object" && !Array.isArray(scopes)
    ? { scopes: scopes as Record<string, unknown> }
    : { scopes: {} };
}

export async function writeWorkspaceCompanion(
  request: WorkspaceStateRequest,
  scopes: unknown
): Promise<void> {
  if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) {
    throw new VaultError("INVALID_COMPANION_STATE", "Companion scopes must be an object.");
  }
  if (Object.keys(scopes as object).length > COMPANION_MAX_SCOPES) {
    throw new VaultError("INVALID_COMPANION_STATE", `Companion state may contain at most ${COMPANION_MAX_SCOPES} scopes.`);
  }
  const filePath = path.join(await workspaceDirectory(request), "companion.json");
  await atomicJsonWrite(filePath, { version: 1, scopes }, COMPANION_MAX_BYTES);
}

export async function deleteWorkspaceCompanion(request: WorkspaceStateRequest): Promise<void> {
  const filePath = path.join(await workspaceDirectory(request), "companion.json");
  await withFileMutation(filePath, () => fs.rm(filePath, { force: true }));
}

function annotationFile(directory: string, relativePath: string): string {
  return path.join(directory, "annotations", `${hash(relativePath)}.json`);
}

function parseAnnotations(value: unknown): WorkspaceAnnotation[] {
  const list = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { annotations?: unknown }).annotations
    : null;
  if (!Array.isArray(list) || list.length > ANNOTATION_MAX_COUNT) {
    if (list === null) return [];
    throw new VaultError("INVALID_WORKSPACE_ANNOTATIONS", "Workspace annotations exceed the count limit.");
  }
  return list.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new VaultError("INVALID_WORKSPACE_ANNOTATION", "Every workspace annotation must be an object.");
    }
    const item = entry as Record<string, unknown>;
    const anchor = item.anchor as Record<string, unknown> | undefined;
    if (
      typeof item.id !== "string" || !item.id.trim() || item.id.length > 200 ||
      !anchor ||
      typeof anchor.revision !== "string" || !/^sha256:[a-f0-9]{64}$/.test(anchor.revision) ||
      !Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) ||
      (anchor.start as number) < 0 || (anchor.end as number) < (anchor.start as number) ||
      typeof anchor.selectedText !== "string" || typeof anchor.quotedText !== "string" ||
      Buffer.byteLength(anchor.selectedText, "utf8") > ANCHOR_TEXT_MAX ||
      Buffer.byteLength(anchor.quotedText, "utf8") > ANCHOR_TEXT_MAX
    ) {
      throw new VaultError("INVALID_WORKSPACE_ANNOTATION", "Workspace annotation anchors require revision, range, and bounded selected/quoted text.");
    }
    return {
      id: item.id,
      anchor: {
        revision: anchor.revision,
        start: anchor.start as number,
        end: anchor.end as number,
        selectedText: anchor.selectedText,
        quotedText: anchor.quotedText,
      },
      ...(Object.prototype.hasOwnProperty.call(item, "data") ? { data: item.data } : {}),
    };
  });
}

export async function writeWorkspaceAnnotations(
  request: WorkspaceStateRequest,
  relativePathValue: unknown,
  annotationsValue: unknown
): Promise<void> {
  const relativePath = normalizeDeepWorkRelativePath(relativePathValue);
  if (!relativePath) throw new VaultError("INVALID_PATH", "A safe repository-relative annotation path is required.");
  // Authentication/path policy and file existence are checked on every state operation.
  const current = await readWorkspaceSource(request, relativePath);
  const annotations = parseAnnotations({ annotations: annotationsValue });
  for (const annotation of annotations) {
    if (
      annotation.anchor.revision !== current.revision ||
      annotation.anchor.end > current.source.length ||
      !isUtf16Boundary(current.source, annotation.anchor.start) ||
      !isUtf16Boundary(current.source, annotation.anchor.end) ||
      current.truncated ||
      current.source.slice(annotation.anchor.start, annotation.anchor.end) !== annotation.anchor.selectedText
    ) {
      throw new VaultError(
        "WORKSPACE_ANNOTATION_CONFLICT",
        "Annotation anchors must target the current bounded source revision and exact selected text.",
        409
      );
    }
  }
  const directory = await workspaceDirectory(request);
  await atomicJsonWrite(
    annotationFile(directory, relativePath),
    { version: 1, path: relativePath, annotations },
    ANNOTATION_MAX_BYTES
  );
}

export async function readWorkspaceAnnotations(
  request: WorkspaceStateRequest,
  relativePathValue: unknown
): Promise<{ path: string; revision: string; annotations: LoadedWorkspaceAnnotation[] }> {
  const relativePath = normalizeDeepWorkRelativePath(relativePathValue);
  if (!relativePath) throw new VaultError("INVALID_PATH", "A safe repository-relative annotation path is required.");
  const source = await readWorkspaceSource(request, relativePath);
  if (source.truncated) {
    // Large files may still carry annotations, but relocation outside the
    // bounded source window cannot be claimed as exact.
  }
  const directory = await workspaceDirectory(request);
  const stored = await readJson(annotationFile(directory, relativePath), ANNOTATION_MAX_BYTES);
  const annotations = stored ? parseAnnotations(stored) : [];
  const loaded = annotations.map((annotation): LoadedWorkspaceAnnotation => {
    const anchor = annotation.anchor;
    if (
      anchor.revision === source.revision &&
      anchor.end <= source.source.length &&
      source.source.slice(anchor.start, anchor.end) === anchor.selectedText
    ) {
      return { ...annotation, status: "current", currentRange: { start: anchor.start, end: anchor.end } };
    }
    const needle = anchor.selectedText || anchor.quotedText;
    if (needle && !source.truncated) {
      const first = source.source.indexOf(needle);
      if (first >= 0 && source.source.indexOf(needle, first + 1) === -1) {
        return { ...annotation, status: "relocated", currentRange: { start: first, end: first + needle.length } };
      }
    }
    return { ...annotation, status: "stale" };
  });
  return { path: relativePath, revision: source.revision, annotations: loaded };
}

export const __testInternals = { workspaceDirectory, annotationFile };
