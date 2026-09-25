import { NextResponse } from "next/server";

import {
  readWorkspaceAnnotations,
  writeWorkspaceAnnotations,
} from "@/server/jupyter/workspace-state";
import {
  workspaceRequestFromValue,
  workspaceStorePathFromRequest,
} from "@/server/jupyter/workspace-request";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const relativePath = new URL(request.url).searchParams.get("path");
    if (!relativePath) throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
    const workspace = workspaceRequestFromValue(workspaceStorePathFromRequest(request));
    return NextResponse.json(await readWorkspaceAnnotations(workspace, relativePath));
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workspace?: unknown;
      path?: unknown;
      annotations?: unknown;
    };
    await writeWorkspaceAnnotations(
      workspaceRequestFromValue(body.workspace),
      body.path,
      body.annotations ?? []
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
