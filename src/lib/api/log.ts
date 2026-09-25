import { ApiError } from "./pages";
import type { LogDocument, LogField, LogRow, LogValue } from "@/lib/log-contract";
import type { LogFormDefinition } from "@/lib/log-form-contract";
import { logHistoryUrls } from "@/lib/log-history";

async function readJson<T>(response: Response): Promise<T> {
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

export interface LogDocumentResponse extends LogDocument {
  path: string;
  form: LogFormDefinition;
}

export interface LogRowResponse extends LogDocumentResponse {
  row: LogRow;
}

/** Read a log page's schema, rows, and JSON Forms script. */
export async function fetchLogDocument(path: string): Promise<LogDocumentResponse> {
  const response = await fetch(`/api/page/log?path=${encodeURIComponent(path)}`, {
    cache: "no-store",
  });
  return readJson<LogDocumentResponse>(response);
}

/** Replace the JSON Forms script (Source tab). Rows are reshaped to projected fields. */
export async function saveLogForm(
  path: string,
  form: LogFormDefinition
): Promise<LogDocumentResponse> {
  const response = await fetch("/api/page/log", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, form }),
  });
  return readJson<LogDocumentResponse>(response);
}

/** Replace the flat schema (legacy). Also regenerates `.form.json`. */
export async function saveLogSchema(path: string, fields: LogField[]): Promise<LogDocumentResponse> {
  const response = await fetch("/api/page/log", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, fields }),
  });
  return readJson<LogDocumentResponse>(response);
}

/** Append a row (Form submit). */
export async function appendLogRow(
  path: string,
  values: Record<string, LogValue>,
  localRow?: Pick<LogRow, "id" | "createdAt">
): Promise<LogRowResponse> {
  const response = await fetch("/api/page/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path,
      values,
      ...(localRow ? { rowId: localRow.id, createdAt: localRow.createdAt } : {}),
    }),
  });
  return readJson<LogRowResponse>(response);
}

/** Update an existing row (Table correction). */
export async function updateLogRow(
  path: string,
  rowId: string,
  values: Record<string, LogValue>
): Promise<LogRowResponse> {
  const response = await fetch("/api/page/log", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, rowId, values }),
  });
  return readJson<LogRowResponse>(response);
}

/** Delete a row. */
export async function deleteLogRow(path: string, rowId: string): Promise<LogDocumentResponse> {
  const response = await fetch(
    `/api/page/log?path=${encodeURIComponent(path)}&rowId=${encodeURIComponent(rowId)}`,
    { method: "DELETE" }
  );
  return readJson<LogDocumentResponse>(response);
}

/** Same-origin URL of a log page's per-page installable manifest. */
export function logManifestUrl(path: string): string {
  return `/api/page/log/manifest?path=${encodeURIComponent(path)}`;
}

/** Focused-shell URL for a log page (start_url target for installs). */
export function focusedLogUrl(path: string): string {
  return `/log?path=${encodeURIComponent(path)}`;
}

/** Stable focused-shell URL for the default History chronology or one named view. */
export function focusedLogHistoryUrl(path: string, view?: string): string {
  return logHistoryUrls(path, view).liveUrl;
}
