import { NextResponse } from "next/server";

import {
  createWorkspaceSource,
  listWorkspaceSources,
  readWorkspaceSource,
  writeWorkspaceSource,
} from "@/server/jupyter/workspace-files";
import {
  workspaceRequestFromValue,
  workspaceStorePathFromRequest,
} from "@/server/jupyter/workspace-request";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = workspaceRequestFromValue(workspaceStorePathFromRequest(request));
    if (url.searchParams.get("operation") === "list") {
      const maxCountValue = url.searchParams.get("maxCount");
      const maxCount = maxCountValue === null ? undefined : Number(maxCountValue);
      return NextResponse.json(await listWorkspaceSources(workspace, maxCount));
    }
    const relativePath = url.searchParams.get("path");
    if (!relativePath) throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
    const maxBytesValue = url.searchParams.get("maxBytes");
    const maxBytes = maxBytesValue === null ? undefined : Number(maxBytesValue);
    return NextResponse.json(await readWorkspaceSource(workspace, relativePath, maxBytes));
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workspace?: unknown;
      path?: unknown;
      source?: unknown;
    };
    const workspace = workspaceRequestFromValue(body.workspace);
    return NextResponse.json(
      await createWorkspaceSource(workspace, body.path, body.source),
      { status: 201 }
    );
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
      expectedRevision?: unknown;
      edits?: unknown;
    };
    const workspace = workspaceRequestFromValue(body.workspace);
    return NextResponse.json(
      await writeWorkspaceSource(workspace, body.path, body.expectedRevision, body.edits)
    );
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
