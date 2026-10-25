import { NextResponse } from "next/server";

import {
  mutateWorkspaceNotebook,
  readWorkspaceNotebookContext,
} from "@/server/jupyter/workspace-notebook";
import {
  workspaceRequestFromValue,
  workspaceStorePathFromRequest,
} from "@/server/jupyter/workspace-request";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

function optionalNumberParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  return value === null ? undefined : Number(value);
}

/** SN-359 workspace_notebook_context: bounded cell read of one capability-scoped .ipynb. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = workspaceRequestFromValue(workspaceStorePathFromRequest(request));
    const relativePath = url.searchParams.get("path");
    if (!relativePath) throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
    return NextResponse.json(await readWorkspaceNotebookContext(workspace, relativePath, {
      index: optionalNumberParam(url, "index"),
      cellId: url.searchParams.get("cellId") ?? undefined,
      startIndex: optionalNumberParam(url, "startIndex"),
    }));
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** SN-359 workspace_cell_create/edit/reorder/delete: one revision-checked cell mutation. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { workspace, path, expectedRevision, operation, ...args } = body;
    return NextResponse.json(
      await mutateWorkspaceNotebook(
        workspaceRequestFromValue(workspace),
        path,
        expectedRevision,
        operation,
        args
      )
    );
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
