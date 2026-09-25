import { NextResponse } from "next/server";

import { toErrorResponse, VaultError } from "@/server/vault/errors";
import {
  closeAllJupyterFastLaneSessions,
  closeJupyterFastLaneSession,
  ensureJupyterFastLaneWarm,
  getJupyterFastLaneSettings,
  updateJupyterFastLaneSettings,
} from "@/server/ai/jupyter-fast-lane";
import { resolveJupyterOwnerPath } from "@/server/jupyter/workspace-request";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getJupyterFastLaneSettings());
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const update: Record<string, string> = {};
    if (typeof body.fastLaneProvider === "string") update.fastLaneProvider = body.fastLaneProvider;
    if (typeof body.fastLaneModel === "string") update.fastLaneModel = body.fastLaneModel;
    if (typeof body.fastLaneEffort === "string") update.fastLaneEffort = body.fastLaneEffort;
    return NextResponse.json(updateJupyterFastLaneSettings(update));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save fast-lane settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function optionalSearchParamPath(request: Request) {
  const url = new URL(request.url);
  const value = url.searchParams.get("path");
  return value === null ? null : resolveJupyterOwnerPath(value);
}

/**
 * SN-247: warm the no-tools, low-latency fast-lane Claude session for an open
 * Jupyter page. Called when the page opens (see jupyter-notebook-view.tsx),
 * off the request path of any real companion turn — this route awaits full
 * warm-up completion itself, but the client call site does not await it.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { path?: string };
    const path = await resolveJupyterOwnerPath(body.path);
    if (!path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" must identify a Jupyter note or validated Deep Work workspace.');
    }
    const result = await ensureJupyterFastLaneWarm(path);
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** Tear down the fast-lane session for one page, or every session when no path is supplied. */
export async function DELETE(request: Request) {
  try {
    const rawPath = new URL(request.url).searchParams.get("path");
    const path = await optionalSearchParamPath(request);
    if (rawPath !== null && !path) {
      throw new VaultError("INVALID_PATH", 'Query field "path" must identify a Jupyter note or validated Deep Work workspace.');
    }
    const result = path ? closeJupyterFastLaneSession(path) : closeAllJupyterFastLaneSessions();
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
