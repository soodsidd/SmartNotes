import * as React from "react";
import Link from "next/link";
import type { LogValue } from "@/lib/log-contract";
import type { LogViewSummary } from "@/lib/log-form-contract";
import type { NamedLogQueryResult } from "@/server/vault/log-query";

function displayValue(value: LogValue | number | null, unit?: string): string {
  const text = value === null || value === undefined
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return unit && value !== null && value !== undefined ? `${text} ${unit}` : text;
}

function summaryKey(summary: LogViewSummary): string {
  return summary.as ?? `${summary.operator}${summary.field ? `_${summary.field}` : ""}`;
}

export function NamedLogView({
  pageTitle,
  result,
}: {
  pageTitle: string;
  result: NamedLogQueryResult;
}) {
  return (
    <main className="min-h-[100dvh] bg-background text-foreground" data-testid="named-log-view">
      <header className="border-b border-border bg-surface/40 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{pageTitle}</p>
            <h1 className="text-lg font-semibold">{result.view.name}</h1>
          </div>
          <nav className="flex items-center gap-2 text-sm" aria-label="Saved view actions">
            <Link
              href={result.jsonUrl}
              className="rounded-md border border-border px-3 py-1.5 transition hover:bg-surface"
            >
              JSON
            </Link>
            <Link
              href={result.csvUrl}
              className="rounded-md border border-border px-3 py-1.5 transition hover:bg-surface"
            >
              CSV
            </Link>
            <Link
              href={`/log?path=${encodeURIComponent(result.path)}`}
              className="rounded-md border border-border px-3 py-1.5 transition hover:bg-surface"
            >
              Form
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
        <p className="text-sm text-muted-foreground">
          Showing {result.returnedCount} of {result.matchedCount} matching rows
          {result.truncated ? ` (limited to ${result.limit})` : ""}.
        </p>

        {result.view.summaries?.length ? (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Summaries">
            {result.view.summaries.map((summary) => {
              const key = summaryKey(summary);
              return (
                <div key={key} className="rounded-lg border border-border bg-surface/30 p-3">
                  <p className="text-xs text-muted-foreground">
                    {summary.label ?? key}
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {displayValue(result.aggregates[key], summary.unit)}
                  </p>
                </div>
              );
            })}
          </section>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface/60">
              <tr>
                {result.view.columns.map((column) => (
                  <th key={column.field} scope="col" className="border-b border-border px-3 py-2 font-medium">
                    {column.label ?? column.field}
                    {column.unit ? ` (${column.unit})` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                  {result.view.columns.map((column) => (
                    <td key={column.field} className="px-3 py-2 align-top">
                      {displayValue(row.values[column.field])}
                    </td>
                  ))}
                </tr>
              ))}
              {!result.rows.length ? (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={result.view.columns.length}>
                    No rows match this saved view.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
