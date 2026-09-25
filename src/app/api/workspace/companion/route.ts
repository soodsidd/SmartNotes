import { NextResponse } from "next/server";

import {
  deleteWorkspaceCompanion,
  readWorkspaceCompanion,
  writeWorkspaceCompanion,
} from "@/server/jupyter/workspace-state";
import {
  workspaceRequestFromValue,
  workspaceStorePathFromRequest,
} from "@/server/jupyter/workspace-request";
import { toErrorResponse } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await readWorkspaceCompanion(
        workspaceRequestFromValue(workspaceStorePathFromRequest(request))
      )
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
      scopes?: unknown;
    };
    await writeWorkspaceCompanion(workspaceRequestFromValue(body.workspace), body.scopes ?? {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(request: Request) {
  try {
    await deleteWorkspaceCompanion(
      workspaceRequestFromValue(workspaceStorePathFromRequest(request))
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
