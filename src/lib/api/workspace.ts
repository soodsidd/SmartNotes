import { ApiError } from "@/lib/api/pages";
import type {
  LoadedWorkspaceAnnotation,
  WorkspaceAnnotation,
} from "@/server/jupyter/workspace-state";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(payload.error ?? response.statusText, response.status, payload.code ?? "API_ERROR");
  }
  return payload;
}

export interface WorkspaceSourceView {
  path: string;
  source: string;
  revision: string;
  size: number;
  truncated: boolean;
}

export interface WorkspaceSourceListView {
  files: Array<{ path: string; size: number }>;
  count: number;
  limit: number;
  truncated: boolean;
}

export async function listWorkspaceSources(
  workspace: string,
  maxCount?: number
): Promise<WorkspaceSourceListView> {
  const params = new URLSearchParams({ workspace, operation: "list" });
  if (maxCount !== undefined) params.set("maxCount", String(maxCount));
  return readJson(await fetch(`/api/workspace/source?${params}`, { cache: "no-store" }));
}

export async function fetchWorkspaceSource(
  workspace: string,
  path: string,
  maxBytes?: number
): Promise<WorkspaceSourceView> {
  const params = new URLSearchParams({ workspace, path });
  if (maxBytes !== undefined) params.set("maxBytes", String(maxBytes));
  return readJson(await fetch(`/api/workspace/source?${params}`, { cache: "no-store" }));
}

export async function editWorkspaceSource(
  workspace: string,
  path: string,
  expectedRevision: string,
  edits: Array<{ start: number; end: number; text: string }>
): Promise<WorkspaceSourceView> {
  return readJson(await fetch("/api/workspace/source", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, path, expectedRevision, edits }),
  }));
}

export async function createWorkspaceSource(
  workspace: string,
  path: string,
  source: string
): Promise<WorkspaceSourceView> {
  return readJson(await fetch("/api/workspace/source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, path, source }),
  }));
}

export async function fetchWorkspaceAnnotations(
  workspace: string,
  path: string
): Promise<{ path: string; revision: string; annotations: LoadedWorkspaceAnnotation[] }> {
  const params = new URLSearchParams({ workspace, path });
  return readJson(await fetch(`/api/workspace/annotations?${params}`, { cache: "no-store" }));
}

export async function saveWorkspaceAnnotations(
  workspace: string,
  path: string,
  annotations: WorkspaceAnnotation[]
): Promise<void> {
  await readJson(await fetch("/api/workspace/annotations", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, path, annotations }),
  }));
}
