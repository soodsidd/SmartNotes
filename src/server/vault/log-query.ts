import {
  executeLogQuery,
  type LogQueryResult,
} from "@/lib/log-query-contract";
import type { LogViewDefinition } from "@/lib/log-form-contract";
import {
  defaultLogHistoryView,
  logHistoryUrls,
  logQueryFromView,
} from "@/lib/log-history";
import { VaultError } from "./errors";
import { readLogDocument, readLogFormDefinition, readPage } from "./pages";

export interface LogHistoryQueryResult extends LogQueryResult {
  path: string;
  view: LogViewDefinition;
  isDefault: boolean;
  liveUrl: string;
  jsonUrl: string;
  csvUrl: string;
}

export type NamedLogQueryResult = LogHistoryQueryResult;

function requireLogViewId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(value)) {
    throw new VaultError("INVALID_LOG_VIEW", 'A valid saved view "id" is required.', 400);
  }
  return value;
}

async function resolveLogDocument(pagePath: string) {
  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "log") {
    throw new VaultError("INVALID_INPUT", "Log queries require a log page.", 400);
  }
  const document = await readLogDocument(page.path);
  return { page, document };
}

export function namedLogViewUrls(path: string, viewId: string) {
  return logHistoryUrls(path, viewId);
}

/** One resolved page path is the complete scope; queries cannot name another source. */
export async function queryLogPage(pagePath: string, query: unknown): Promise<LogQueryResult & { path: string }> {
  const { page, document } = await resolveLogDocument(pagePath);
  try {
    return { path: page.path, ...executeLogQuery(document, query) };
  } catch (error) {
    throw new VaultError(
      "INVALID_LOG_QUERY",
      error instanceof Error ? error.message : "The log query is invalid.",
      400
    );
  }
}

export async function queryNamedLogView(pagePath: string, rawViewId: unknown): Promise<NamedLogQueryResult> {
  const viewId = requireLogViewId(rawViewId);
  return queryLogHistoryView(pagePath, viewId);
}

/** Resolve the current default chronology or one validated named History view. */
export async function queryLogHistoryView(
  pagePath: string,
  rawViewId?: unknown
): Promise<LogHistoryQueryResult> {
  const { page, document } = await resolveLogDocument(pagePath);
  const isDefault = rawViewId === undefined || rawViewId === null || rawViewId === "";
  const viewId = isDefault ? null : requireLogViewId(rawViewId);
  const form = isDefault ? null : await readLogFormDefinition(page.path);
  const view = isDefault
    ? defaultLogHistoryView(document.schema.fields)
    : form?.views?.find((candidate) => candidate.id === viewId);
  if (!view) throw new VaultError("LOG_VIEW_NOT_FOUND", `Saved log view not found: ${viewId}`, 404);
  try {
    return {
      path: page.path,
      view,
      isDefault,
      ...executeLogQuery(document, logQueryFromView(view)),
      ...logHistoryUrls(page.path, isDefault ? null : view.id),
    };
  } catch (error) {
    throw new VaultError(
      "INVALID_LOG_VIEW",
      error instanceof Error ? error.message : "The saved log view is invalid.",
      400
    );
  }
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function namedLogQueryToCsv(result: LogHistoryQueryResult): string {
  const columns = result.view.columns;
  const header = columns.map((column) => csvCell(column.label ?? column.field)).join(",");
  const rows = result.rows.map((row) =>
    columns.map((column) => csvCell(row.values[column.field])).join(",")
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}
