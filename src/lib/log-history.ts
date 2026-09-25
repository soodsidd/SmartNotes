import type { LogDocument, LogField } from "@/lib/log-contract";
import {
  LOG_QUERY_MAX_FIELDS,
  LOG_QUERY_MAX_LIMIT,
  executeLogQuery,
  type LogQuery,
  type LogQueryResult,
} from "@/lib/log-query-contract";
import type {
  LogFormDefinition,
  LogViewDefinition,
  LogViewFormat,
} from "@/lib/log-form-contract";

export interface ResolvedLogHistoryView {
  view: LogViewDefinition;
  isDefault: boolean;
  requestedViewId: string | null;
  fellBack: boolean;
}

function defaultFieldFormat(field: LogField): LogViewFormat {
  if (field.type === "number") return "number";
  if (field.type === "date") return "date";
  if (field.type === "boolean") return "boolean";
  return "text";
}

/** Readable, newest-first History view derived only from the current row schema. */
export function defaultLogHistoryView(fields: LogField[]): LogViewDefinition {
  return {
    id: "history",
    name: "All entries",
    columns: fields.slice(0, LOG_QUERY_MAX_FIELDS).map((field) => ({
      field: field.id,
      label: field.name,
      format: defaultFieldFormat(field),
    })),
    sort: [{ field: "createdAt", direction: "desc" }],
    limit: LOG_QUERY_MAX_LIMIT,
    presentation: "timeline",
  };
}

/** Unknown or defensively-dropped presentation metadata always resolves to the default chronology. */
export function resolveLogHistoryView(
  form: LogFormDefinition,
  fields: LogField[],
  requestedViewId?: string | null
): ResolvedLogHistoryView {
  const requested = requestedViewId?.trim() || null;
  const named = requested
    ? form.views?.find((candidate) => candidate.id === requested)
    : undefined;
  return named
    ? { view: named, isDefault: false, requestedViewId: requested, fellBack: false }
    : {
        view: defaultLogHistoryView(fields),
        isDefault: true,
        requestedViewId: requested,
        fellBack: requested !== null,
      };
}

export function logQueryFromView(view: LogViewDefinition): LogQuery {
  return {
    fields: view.columns.map((column) => column.field),
    filters: view.filters,
    sort: view.sort,
    dateRange: view.dateRange,
    limit: view.limit,
    groupBy: view.grouping,
    aggregates: view.summaries?.map(({ operator, field, as }) => ({ operator, field, as })),
  };
}

export function executeLogHistoryView(
  document: LogDocument,
  view: LogViewDefinition
): LogQueryResult {
  return executeLogQuery(document, logQueryFromView(view));
}

/** Stable focused-shell and export URLs for either the default chronology or a named view. */
export function logHistoryUrls(path: string, viewId?: string | null) {
  const encodedPath = encodeURIComponent(path);
  const viewQuery = viewId ? `&view=${encodeURIComponent(viewId)}` : "";
  const jsonUrl = `/api/page/log/query?path=${encodedPath}${viewQuery}`;
  return {
    liveUrl: viewId
      ? `/log?path=${encodedPath}&view=${encodeURIComponent(viewId)}`
      : `/log?path=${encodedPath}&tab=history`,
    jsonUrl,
    csvUrl: `${jsonUrl}&format=csv`,
  };
}
