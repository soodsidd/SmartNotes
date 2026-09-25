import { vaultWriteFetch } from "@/lib/connection-status";

export interface PortableNotebookRecord {
  id: string;
  name: string;
  rootPath: string;
  path: string;
  addedAt: string;
}

export interface RegisterPortableNotebookPayload {
  rootPath?: string;
  parentPath?: string;
  folderName?: string;
  name?: string;
  createIfMissing?: boolean;
}

interface ApiErrorShape {
  error?: string;
  code?: string;
}

export class NotebookRegistryApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code = "API_ERROR") {
    super(message);
    this.name = "NotebookRegistryApiError";
    this.status = status;
    this.code = code;
  }
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorShape;
  if (!response.ok) {
    throw new NotebookRegistryApiError(
      payload.error ?? response.statusText,
      response.status,
      payload.code ?? "API_ERROR"
    );
  }
  return payload as T;
}

export async function fetchPortableNotebooks() {
  const response = await fetch("/api/notebook-registry", { cache: "no-store" });
  return readJson<{ notebooks: PortableNotebookRecord[] }>(response);
}

export async function registerPortableNotebook(
  payload: RegisterPortableNotebookPayload,
  options?: { signal?: AbortSignal }
) {
  const response = await vaultWriteFetch("/api/notebook-registry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options?.signal,
  });
  return readJson<{ notebook: PortableNotebookRecord }>(response);
}

export async function unregisterPortableNotebook(id: string) {
  const response = await vaultWriteFetch(`/api/notebook-registry?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return readJson<{ notebook: PortableNotebookRecord }>(response);
}
