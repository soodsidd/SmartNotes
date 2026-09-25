"use client";

import * as React from "react";
import {
  BarChart3,
  CalendarDays,
  Check,
  Copy,
  Download,
  FileJson,
  Rows3,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LogDocument, LogRow, LogValue } from "@/lib/log-contract";
import type {
  LogFormDefinition,
  LogViewColumn,
  LogViewDefinition,
  LogViewFormat,
  LogViewSummary,
} from "@/lib/log-form-contract";
import {
  executeLogHistoryView,
  logHistoryUrls,
  resolveLogHistoryView,
} from "@/lib/log-history";
import type {
  LogQueryGroup,
  LogQueryResult,
  LogQueryResultRow,
} from "@/lib/log-query-contract";

export interface LogHistoryViewProps {
  pagePath: string;
  document: LogDocument;
  form: LogFormDefinition;
  requestedViewId?: string | null;
  onViewChange: (viewId: string | null) => void;
  onOpenForm: () => void;
}

function numberText(value: number, format: LogViewFormat | undefined, unit?: string): string {
  try {
    if (format === "currency" && unit && /^[a-z]{3}$/i.test(unit)) {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: unit.toUpperCase(),
        maximumFractionDigits: 2,
      }).format(value);
    }
    if (format === "percent") {
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    }
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: format === "integer" ? 0 : 2,
    }).format(value);
  } catch {
    return String(value);
  }
}

export function formatLogHistoryValue(
  value: LogValue | number | null | undefined,
  format?: LogViewFormat,
  unit?: string
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "boolean" || typeof value === "boolean") return value ? "Yes" : "No";
  if ((format === "date" || format === "datetime") && typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat(undefined, format === "date"
        ? { dateStyle: "medium" }
        : { dateStyle: "medium", timeStyle: "short" }).format(parsed);
    }
  }
  const text = typeof value === "number"
    ? numberText(value, format, unit)
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  const currencyAlreadyIncluded = format === "currency" && Boolean(unit && /^[a-z]{3}$/i.test(unit));
  return unit && !currencyAlreadyIncluded && format !== "percent" ? `${text} ${unit}` : text;
}

function summaryKey(summary: LogViewSummary): string {
  return summary.as ?? `${summary.operator}${summary.field ? `_${summary.field}` : ""}`;
}

function dateLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function ViewSummaryCards({
  view,
  result,
  compact = false,
}: {
  view: LogViewDefinition;
  result: Pick<LogQueryResult, "aggregates">;
  compact?: boolean;
}) {
  if (!view.summaries?.length) return null;
  return (
    <section
      className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", compact && "mt-3")}
      aria-label="View summaries"
      data-testid="log-history-summaries"
    >
      {view.summaries.map((summary) => {
        const key = summaryKey(summary);
        return (
          <article key={key} className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
            <p className="text-xs font-medium text-muted-foreground">{summary.label ?? key}</p>
            <p className="mt-1 break-words text-xl font-semibold text-foreground">
              {formatLogHistoryValue(result.aggregates[key], summary.format, summary.unit)}
            </p>
          </article>
        );
      })}
    </section>
  );
}

function RowFields({
  row,
  columns,
  layout = "grid",
}: {
  row: LogQueryResultRow;
  columns: LogViewColumn[];
  layout?: "grid" | "stack";
}) {
  return (
    <dl className={cn(layout === "grid" ? "grid gap-x-5 gap-y-3 sm:grid-cols-2" : "space-y-3")}>
      {columns.map((column) => (
        <div key={column.field} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">
            {column.label ?? column.field}
          </dt>
          <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
            {formatLogHistoryValue(row.values[column.field], column.format, column.unit)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CardsPresentation({
  rows,
  columns,
}: {
  rows: LogQueryResultRow[];
  columns: LogViewColumn[];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="log-history-cards">
      {rows.map((row) => (
        <article key={row.id} className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <time dateTime={row.createdAt} className="mb-3 block text-xs text-muted-foreground">
            {dateLabel(row.createdAt)}
          </time>
          <RowFields row={row} columns={columns} />
        </article>
      ))}
    </div>
  );
}

function TimelinePresentation({
  rows,
  columns,
}: {
  rows: LogQueryResultRow[];
  columns: LogViewColumn[];
}) {
  return (
    <ol className="relative ml-2 border-l border-border pl-5" data-testid="log-history-timeline">
      {rows.map((row) => (
        <li key={row.id} className="relative pb-5 last:pb-0">
          <span className="absolute -left-[1.55rem] top-1.5 size-2 rounded-full bg-accent ring-4 ring-background" aria-hidden="true" />
          <article className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
            <time dateTime={row.createdAt} className="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {dateLabel(row.createdAt)}
            </time>
            <RowFields row={row} columns={columns} />
          </article>
        </li>
      ))}
    </ol>
  );
}

function TablePresentation({
  rows,
  columns,
}: {
  rows: LogQueryResultRow[];
  columns: LogViewColumn[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface" data-testid="log-history-readonly-table">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {columns.map((column) => (
              <th key={column.field} scope="col" className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">
                {column.label ?? column.field}
                {column.unit && column.format !== "currency" ? ` (${column.unit})` : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border/60 last:border-0">
              {columns.map((column) => (
                <td key={column.field} className="max-w-sm whitespace-pre-wrap break-words px-3 py-2 align-top text-foreground">
                  {formatLogHistoryValue(row.values[column.field], column.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sourceValue(row: LogRow | undefined, field: string): LogValue {
  if (!row) return null;
  if (field === "id") return row.id;
  if (field === "createdAt") return row.createdAt;
  if (field === "updatedAt") return row.updatedAt ?? null;
  return row.values[field] ?? null;
}

function groupLabel(
  group: LogQueryGroup,
  view: LogViewDefinition,
  document: LogDocument
): string {
  const fields = new Map(document.schema.fields.map((field) => [field.id, field.name]));
  return Object.entries(group.key)
    .map(([field, value]) => {
      const column = view.columns.find((candidate) => candidate.field === field);
      return `${column?.label ?? fields.get(field) ?? field}: ${formatLogHistoryValue(value, column?.format, column?.unit)}`;
    })
    .join(" · ");
}

function GroupedPresentation({
  document,
  result,
  view,
}: {
  document: LogDocument;
  result: LogQueryResult;
  view: LogViewDefinition;
}) {
  const sourceRows = new Map(document.rows.map((row) => [row.id, row]));
  const rowsByGroup = new Map<string, LogQueryResultRow[]>();
  for (const row of result.rows) {
    const source = sourceRows.get(row.id);
    const key = Object.fromEntries(
      (view.grouping ?? []).map((field) => [field, sourceValue(source, field)])
    );
    const encoded = JSON.stringify(key);
    rowsByGroup.set(encoded, [...(rowsByGroup.get(encoded) ?? []), row]);
  }
  return (
    <div className="space-y-5" data-testid="log-history-grouped">
      {result.groups.map((group) => {
        const rows = rowsByGroup.get(JSON.stringify(group.key)) ?? [];
        return (
          <section key={JSON.stringify(group.key)} className="rounded-lg border border-border bg-muted/20 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="break-words text-sm font-semibold text-foreground">
                {groupLabel(group, view, document)}
              </h3>
              <span className="text-xs text-muted-foreground">
                {group.rowCount} {group.rowCount === 1 ? "entry" : "entries"}
              </span>
            </div>
            <CardsPresentation rows={rows} columns={view.columns} />
          </section>
        );
      })}
    </div>
  );
}

function HistoryPresentation({
  document,
  result,
  view,
}: {
  document: LogDocument;
  result: LogQueryResult;
  view: LogViewDefinition;
}) {
  if (view.presentation === "summary") {
    return <ViewSummaryCards view={view} result={result} />;
  }
  if (view.presentation === "grouped") {
    return <GroupedPresentation document={document} result={result} view={view} />;
  }
  if (view.presentation === "table") {
    return <TablePresentation rows={result.rows} columns={view.columns} />;
  }
  if (view.presentation === "cards") {
    return <CardsPresentation rows={result.rows} columns={view.columns} />;
  }
  return <TimelinePresentation rows={result.rows} columns={view.columns} />;
}

export function LogHistoryView({
  pagePath,
  document,
  form,
  requestedViewId,
  onViewChange,
  onOpenForm,
}: LogHistoryViewProps) {
  const resolved = React.useMemo(
    () => resolveLogHistoryView(form, document.schema.fields, requestedViewId),
    [document.schema.fields, form, requestedViewId]
  );
  const result = React.useMemo(
    () => executeLogHistoryView(document, resolved.view),
    [document, resolved.view]
  );
  const urls = React.useMemo(
    () => logHistoryUrls(pagePath, resolved.isDefault ? null : resolved.view.id),
    [pagePath, resolved.isDefault, resolved.view.id]
  );
  const [copied, setCopied] = React.useState(false);

  const copyLink = async () => {
    try {
      const absolute = new URL(urls.liveUrl, window.location.origin).toString();
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
      toast.success("History link copied");
    } catch {
      toast.error("Couldn’t copy the History link");
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-3 sm:p-5" data-testid="log-history">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="log-history-view" className="mb-1 block text-xs font-medium text-muted-foreground">
            History view
          </label>
          <select
            id="log-history-view"
            data-testid="log-history-view-select"
            value={resolved.isDefault ? "" : resolved.view.id}
            onChange={(event) => onViewChange(event.target.value || null)}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:max-w-xs"
          >
            <option value="">All entries</option>
            {form.views?.map((view) => (
              <option key={view.id} value={view.id}>{view.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex" aria-label="History actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => void copyLink()}
            data-testid="log-history-copy-link"
          >
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            <span className="hidden min-[390px]:inline">{copied ? "Copied" : "Copy link"}</span>
            <span className="min-[390px]:hidden">Link</span>
          </Button>
          <a
            href={urls.jsonUrl}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 sm:min-h-8")}
            data-testid="log-history-export-json"
          >
            <FileJson className="size-3.5" aria-hidden="true" />
            JSON
          </a>
          <a
            href={urls.csvUrl}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 sm:min-h-8")}
            data-testid="log-history-export-csv"
          >
            <Download className="size-3.5" aria-hidden="true" />
            CSV
          </a>
        </div>
      </div>

      {resolved.fellBack ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="log-history-fallback">
          That saved view is unavailable. Showing all entries instead.
        </div>
      ) : null}

      <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
            {resolved.isDefault ? <Rows3 className="size-3.5" aria-hidden="true" /> : <BarChart3 className="size-3.5" aria-hidden="true" />}
            {resolved.isDefault ? "Chronological history" : "Saved live view"}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{resolved.view.name}</h2>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="log-history-count">
          Showing {result.returnedCount} of {result.matchedCount} {result.matchedCount === 1 ? "entry" : "entries"}
          {result.truncated ? ` · limited to ${result.limit}` : ""}
        </p>
      </header>

      {resolved.view.presentation !== "summary" ? (
        <ViewSummaryCards view={resolved.view} result={result} />
      ) : null}

      {resolved.view.presentation === "summary" ? (
        <HistoryPresentation document={document} result={result} view={resolved.view} />
      ) : result.rows.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 text-center">
          <CalendarDays className="size-6 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {resolved.isDefault ? "No entries yet" : "No entries match this view"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {resolved.isDefault ? "Add an entry from the Form tab to begin the history." : "The view remains live and will update when matching rows are added."}
            </p>
          </div>
          {resolved.isDefault ? (
            <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={onOpenForm}>
              Open Form
            </Button>
          ) : null}
        </div>
      ) : (
        <HistoryPresentation document={document} result={result} view={resolved.view} />
      )}
    </section>
  );
}
