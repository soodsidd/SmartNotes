import type { AppManifest, AppRpcOperation, AppTableSnapshot } from "@/lib/app-contract";
import { ApiError } from "@/lib/api/pages";
import { vaultWriteFetch } from "@/lib/connection-status";

export interface AppBootstrapResponse {
  page: { path: string; title: string; body: string };
  manifest: AppManifest;
  tables: AppTableSnapshot[];
  revision: string;
  etag: string | null;
  sessionToken: string;
  sessionExpiresAt: string;
}

export type AppDataSnapshotResponse = Omit<AppBootstrapResponse, "sessionToken" | "sessionExpiresAt">;

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) throw new ApiError(body.error ?? response.statusText, response.status, body.code);
  return body;
}

async function readAppSnapshot<T extends { revision: string }>(response: Response): Promise<T & { etag: string | null }> {
  const snapshot = await readJson<T>(response);
  return { ...snapshot, etag: response.headers.get("ETag") };
}

export async function fetchAppBootstrap(path: string, replacementToken?: string, signal?: AbortSignal): Promise<AppBootstrapResponse> {
  return readAppSnapshot(await fetch(`/api/page/app?path=${encodeURIComponent(path)}`, {
    cache: "no-store",
    signal,
    ...(replacementToken ? { headers: { "X-Smart-Notes-App-Session": replacementToken } } : {}),
  }));
}

export async function fetchAppDataSnapshot(path: string, signal?: AbortSignal): Promise<AppDataSnapshotResponse> {
  return readAppSnapshot(await fetch(`/api/page/app/data?path=${encodeURIComponent(path)}`, { cache: "no-store", signal }));
}

export async function setAppEnabled(path: string, enabled: boolean): Promise<AppManifest> {
  const result = await readJson<{ manifest: AppManifest }>(await vaultWriteFetch("/api/page/app", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, enabled }),
  }));
  return result.manifest;
}

export async function runAppRpc(input: {
  path: string;
  sessionToken: string;
  tableId: string;
  operation: AppRpcOperation;
  rowId?: string;
  values?: unknown;
  query?: unknown;
  clientMutationId?: string;
  acceptedAt?: string;
  upsertKey?: string;
}): Promise<unknown> {
  const result = await readJson<{ data: unknown }>(await vaultWriteFetch("/api/page/app/rpc", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }));
  return result.data;
}

export async function runOwnerAppDataMutation(input: {
  path: string;
  sessionToken: string;
  tableId: string;
  operation: Exclude<AppRpcOperation, "query" | "upsert">;
  rowId?: string;
  values?: unknown;
}): Promise<unknown> {
  const result = await readJson<{ data: unknown }>(await vaultWriteFetch("/api/page/app/data", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }));
  return result.data;
}

export async function saveAppSource(path: string, title: string, content: string) {
  const result = await readJson<{ page: { path: string; title: string; body: string } }>(await vaultWriteFetch("/api/page", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, title, content }),
  }));
  return result.page;
}

export async function reloadAppSource(path: string) {
  const result = await readJson<{ page: { path: string; title: string; body: string } }>(
    await fetch(`/api/page?path=${encodeURIComponent(path)}`, { cache: "no-store" })
  );
  return result.page;
}

/** Same-origin URL of an App page's per-page installable manifest (SN-187). */
export function appManifestUrl(path: string): string {
  return `/api/page/app/manifest?path=${encodeURIComponent(path)}`;
}

/** Focused-shell URL for an App page (start_url target for per-page installs, SN-187). */
export function focusedAppUrl(path: string): string {
  return `/app?path=${encodeURIComponent(path)}`;
}
