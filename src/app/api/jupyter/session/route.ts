import { NextResponse } from "next/server";

import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { ensureSession, getSessionStatus, stopAllSessions, stopSession } from "@/server/jupyter/runtime";

export const dynamic = "force-dynamic";

function searchParamPath(request: Request) {
  const url = new URL(request.url);
  const pagePath = url.searchParams.get("path");
  if (!pagePath) {
    throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
  }
  return pagePath;
}

function optionalSearchParamPath(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get("path");
}

function frameOriginFromRequest(request: Request): string {
  return request.headers.get("origin") || new URL(request.url).origin;
}

/** Status of the session for a note (does not launch a server). */
export async function GET(request: Request) {
  try {
    const view = await getSessionStatus(searchParamPath(request));
    return NextResponse.json(view);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** Launch or connect to the session for a note. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { path?: string };
    if (!body.path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" is required.');
    }
    const view = await ensureSession(body.path, { frameOrigin: frameOriginFromRequest(request) });
    return NextResponse.json(view);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** Stop the session for one note, or every running Jupyter session when no path is supplied. */
export async function DELETE(request: Request) {
  try {
    const pagePath = optionalSearchParamPath(request);
    const result = pagePath ? await stopSession(pagePath) : await stopAllSessions();
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
