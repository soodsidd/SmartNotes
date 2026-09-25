import { NextResponse } from "next/server";
import {
  namedLogQueryToCsv,
  queryLogHistoryView,
  queryLogPage,
  queryNamedLogView,
} from "@/server/vault/log-query";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

function requiredPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new VaultError("INVALID_PATH", 'A log page "path" is required.');
  }
  return value.trim();
}

function csvResponse(result: Awaited<ReturnType<typeof queryLogHistoryView>>) {
  return new NextResponse(namedLogQueryToCsv(result), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `inline; filename="${result.view.id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Stable named-view retrieval: JSON by default, CSV when format=csv. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const path = requiredPath(url.searchParams.get("path"));
    const format = url.searchParams.get("format");
    if (format !== null && format !== "json" && format !== "csv") {
      throw new VaultError("INVALID_LOG_QUERY", 'format must be "json" or "csv".');
    }
    const result = await queryLogHistoryView(path, url.searchParams.get("view"));
    return format === "csv"
      ? csvResponse(result)
      : NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** Ad-hoc bounded query, or named-view retrieval with `{ path, view }`. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      path?: unknown;
      query?: unknown;
      view?: unknown;
      format?: unknown;
    };
    const extras = Object.keys(body).filter((key) => !["path", "query", "view", "format"].includes(key));
    if (extras.length) {
      throw new VaultError("INVALID_LOG_QUERY", `Request contains unsupported key(s): ${extras.join(", ")}.`);
    }
    const path = requiredPath(body.path);
    if (body.view !== undefined && body.query !== undefined) {
      throw new VaultError("INVALID_LOG_QUERY", 'Provide either "view" or "query", not both.');
    }
    if (body.view !== undefined) {
      const result = await queryNamedLogView(path, body.view);
      if (body.format === "csv") return csvResponse(result);
      if (body.format !== undefined && body.format !== "json") {
        throw new VaultError("INVALID_LOG_QUERY", 'format must be "json" or "csv".');
      }
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.format !== undefined) {
      throw new VaultError("INVALID_LOG_QUERY", "CSV export is available only for a named saved view.");
    }
    return NextResponse.json(await queryLogPage(path, body.query ?? {}), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
