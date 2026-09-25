import { vaultWriteFetch } from "@/lib/connection-status";

export interface VaultPageSummary {
  path: string;
  title: string;
  preview: string;
  createdAt: string | null;
  updatedAt: string | null;
  hasFrontmatterError?: boolean;
}

export interface VaultSection {
  path: string;
  name: string;
  pages: VaultPageSummary[];
}

export interface VaultNotebook {
  path: string;
  name: string;
  pages: VaultPageSummary[];
  sections: VaultSection[];
}

export interface VaultTreeResponse {
  tree: VaultNotebook[];
  root: string;
}

export interface VaultPageDocument {
  path: string;
  title: string;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

interface ApiErrorShape {
  error?: string;
  code?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code = "API_ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorShape;
  if (!response.ok) {
    throw new ApiError(
      payload.error ?? response.statusText,
      response.status,
      payload.code ?? "API_ERROR"
    );
  }

  return payload as T;
}

export async function fetchVaultTree() {
  const response = await fetch("/api/vault", {
    cache: "no-store",
  });
  return readJson<VaultTreeResponse>(response);
}

export async function fetchPage(path: string) {
  const response = await fetch(`/api/page?path=${encodeURIComponent(path)}`, {
    cache: "no-store",
  });
  return readJson<VaultPageDocument>(response);
}

export async function savePage(path: string, title: string, body: string) {
  const response = await vaultWriteFetch("/api/page", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, title, body }),
  });
  return readJson<VaultPageDocument>(response);
}

export async function createPage(
  target: { sectionPath?: string | null; notebookPath?: string | null },
  title: string,
  noteType?: "text" | "ink" | "jupyter" | "log" | "design" | "app" | "spreadsheet",
  parentId?: string | null
) {
  const response = await vaultWriteFetch("/api/page", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...target, title, noteType, parentId }),
  });
  return readJson<VaultPageDocument>(response);
}

export async function renamePage(path: string, title: string) {
  const response = await vaultWriteFetch("/api/page", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, title }),
  });
  return readJson<VaultPageDocument>(response);
}

export async function deletePage(path: string) {
  const response = await vaultWriteFetch("/api/page", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path }),
  });
  return readJson<{ path: string }>(response);
}

/** SN-168: link an ordinary HTML file inside a portable-notebook root in place. */
export async function linkDesignPage(sourcePath: string, title?: string, replacePath?: string) {
  const response = await vaultWriteFetch("/api/page/design-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath, title, replacePath }),
  });
  return readJson<{ page: VaultPageDocument & { resolvedDiskPath?: string; designLinked?: boolean; sourceMissing?: boolean }; resolvedDiskPath?: string }>(
    response
  );
}

/** SN-168: point an existing linked design at a different HTML file. */
export async function relinkDesignPage(path: string, sourcePath: string, title?: string) {
  const response = await vaultWriteFetch("/api/page/design-link", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, sourcePath, title }),
  });
  return readJson<{ page: VaultPageDocument & { resolvedDiskPath?: string; designLinked?: boolean; sourceMissing?: boolean } }>(
    response
  );
}

/** SN-168: remove link metadata; leave the HTML ground truth on disk. */
export async function unlinkDesignPage(path: string) {
  const response = await vaultWriteFetch(`/api/page/design-link?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
  return readJson<{ path: string; sourcePath: string }>(response);
}
