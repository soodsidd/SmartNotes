import { ApiError } from "./pages";
import { vaultWriteFetch } from "@/lib/connection-status";

export interface PageVersionEntry {
  id: string;
  ts: string;
  hash: string;
  size: number;
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(
      (payload as { error?: string }).error ?? response.statusText,
      response.status,
      (payload as { code?: string }).code ?? "API_ERROR"
    );
  }
  return payload as T;
}

export async function fetchPageVersions(path: string) {
  const response = await fetch(`/api/page/versions?path=${encodeURIComponent(path)}`, {
    cache: "no-store",
  });
  return readJson<{ versions: PageVersionEntry[]; noteType: "text" | "ink" | "spreadsheet" }>(response);
}

export async function fetchPageVersionContent(path: string, versionId: string) {
  const response = await fetch(
    `/api/page/versions?path=${encodeURIComponent(path)}&versionId=${encodeURIComponent(versionId)}`,
    { cache: "no-store" }
  );
  return readJson<{
    content: string;
    annotationsContent?: string | null;
    noteType: "text" | "ink" | "spreadsheet";
    versionId: string;
  }>(response);
}

export async function snapshotPageVersion(path: string) {
  const response = await vaultWriteFetch("/api/page/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return readJson<{ created: boolean; entry: PageVersionEntry | null; noteType: "text" | "ink" | "spreadsheet" }>(response);
}

export async function restorePageVersion(
  path: string,
  versionId: string,
  origin?: { originSocketId?: string; originClientId?: string }
) {
  const response = await vaultWriteFetch("/api/page/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path,
      action: "restore",
      versionId,
      originSocketId: origin?.originSocketId,
      originClientId: origin?.originClientId,
    }),
  });
  return readJson<{ ok: boolean; path: string; kind: "page" | "ink" | "spreadsheet" }>(response);
}

export function formatVersionLabel(isoTimestamp: string) {
  const date = new Date(isoTimestamp);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
