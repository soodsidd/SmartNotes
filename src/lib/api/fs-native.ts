import { vaultWriteFetch } from "@/lib/connection-status";

interface ApiErrorShape {
  error?: string;
  code?: string;
}

export class FsNativeApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code = "API_ERROR") {
    super(message);
    this.name = "FsNativeApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ServerFolderEntry {
  name: string;
  path: string;
}

export interface ServerFolderRoot {
  label: string;
  path: string;
}

export interface ServerFolderListing {
  path: string;
  parentPath: string | null;
  roots: ServerFolderRoot[];
  entries: ServerFolderEntry[];
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorShape;
  if (!response.ok) {
    throw new FsNativeApiError(
      payload.error ?? response.statusText,
      response.status,
      payload.code ?? "API_ERROR"
    );
  }
  return payload as T;
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

function serverFolderTimeoutError() {
  return new FsNativeApiError(
    "The server folder request timed out. Your phone can browse only folders visible to the Smart Notes backend host.",
    408,
    "TIMEOUT"
  );
}

async function fetchWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  write = false
) {
  const { controller, timeoutId } = timeoutSignal(timeoutMs);
  try {
    const response = write
      ? await vaultWriteFetch(input, { ...init, signal: controller.signal })
      : await fetch(input, { ...init, signal: controller.signal });
    return await readJson<T>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw serverFolderTimeoutError();
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function pickNativeFolder(input?: { initialPath?: string; title?: string }) {
  const response = await vaultWriteFetch("/api/fs/pick-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  return readJson<{ available: boolean; cancelled: boolean; path: string | null }>(response);
}

export async function pickNativeFile(input?: {
  initialPath?: string;
  title?: string;
  filter?: string;
}) {
  const response = await vaultWriteFetch("/api/fs/pick-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  return readJson<{ available: boolean; cancelled: boolean; path: string | null }>(response);
}

export async function listServerFolders(path?: string, timeoutMs = 12000) {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return fetchWithTimeout<ServerFolderListing>(`/api/fs/server-folders${query}`, undefined, timeoutMs);
}

export interface PortableHtmlRoot {
  id: string;
  label: string;
  path: string;
}

export interface PortableHtmlEntry {
  name: string;
  path: string;
}

export interface PortableHtmlListing {
  path: string;
  parentPath: string | null;
  portableRoot: string;
  portableNotebookId: string;
  roots: PortableHtmlRoot[];
  folders: PortableHtmlEntry[];
  files: PortableHtmlEntry[];
}

/** Browse `.html` files inside registered portable-notebook roots (SN-168). */
export async function listPortableHtml(path?: string, timeoutMs = 12000) {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return fetchWithTimeout<PortableHtmlListing>(`/api/fs/portable-html${query}`, undefined, timeoutMs);
}

export async function createServerFolder(input: { parentPath: string; folderName: string }, timeoutMs = 12000) {
  return fetchWithTimeout<ServerFolderListing>(
    "/api/fs/server-folders",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", ...input }),
    },
    timeoutMs,
    true
  );
}

export async function validateServerFolder(path: string, timeoutMs = 12000) {
  return fetchWithTimeout<{ valid: true; path: string }>(
    "/api/fs/server-folders",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "validate", path }),
    },
    timeoutMs
  );
}

export async function revealNotebookInExplorer(notebookPath: string) {
  const response = await vaultWriteFetch("/api/fs/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notebookPath }),
  });
  return readJson<{ path: string }>(response);
}

export async function revealPageInExplorer(pagePath: string) {
  const response = await vaultWriteFetch("/api/fs/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagePath }),
  });
  return readJson<{ path: string; pagePath?: string }>(response);
}

export async function revealAbsolutePathInExplorer(absolutePath: string) {
  const response = await vaultWriteFetch("/api/fs/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ absolutePath }),
  });
  return readJson<{ path: string }>(response);
}
