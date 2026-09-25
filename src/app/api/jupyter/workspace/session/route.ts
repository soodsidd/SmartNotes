import { NextResponse } from "next/server";

import { toErrorResponse, VaultError } from "@/server/vault/errors";
import {
  ensureProjectWorkspaceSession,
  getProjectWorkspaceStatus,
  stopProjectWorkspaceSession,
} from "@/server/jupyter/runtime";
import {
  resolveProjectWorkspace,
  type ProjectWorkspaceRequest,
  type WorkspaceAccessMode,
} from "@/server/jupyter/workspace-root";
import { issueWorkspaceCapability } from "@/server/jupyter/workspace-capability";

// ---------------------------------------------------------------------------
// Project-backed JupyterLab workspace session route (SN-256)
//
// Mirrors the shape of /api/jupyter/session (note-owned sessions) but targets
// an explicit, registered Ascent Vector project/worktree root instead of a
// note's sibling `.jupyter` folder. Kept as a separate route rather than
// overloading the existing one so note-owned session behavior (and its
// existing tests/clients) is untouched.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseAccessMode(value: string | null): WorkspaceAccessMode | undefined {
  return value === "editable" || value === "read-only" ? value : undefined;
}

function requestFromSearchParams(request: Request): ProjectWorkspaceRequest {
  const url = new URL(request.url);
  const rootPath = url.searchParams.get("root");
  if (!rootPath) {
    throw new VaultError("INVALID_PATH", 'Query parameter "root" is required.');
  }
  return {
    rootPath,
    projectId: url.searchParams.get("projectId") ?? undefined,
    repoId: url.searchParams.get("repoId") ?? undefined,
    branch: url.searchParams.get("branch") ?? undefined,
    isDefaultBranch: parseBoolean(url.searchParams.get("isDefaultBranch")),
    requestedAccess: parseAccessMode(url.searchParams.get("requestedAccess")),
    ownerOpen: parseBoolean(url.searchParams.get("ownerOpen")),
    defaultBranchEditConfirmed: parseBoolean(url.searchParams.get("defaultBranchEditConfirmed")),
  };
}

function frameOriginFromRequest(request: Request): string {
  return request.headers.get("origin") || new URL(request.url).origin;
}

/** Status of a project workspace session (does not launch a server). */
export async function GET(request: Request) {
  try {
    const view = await getProjectWorkspaceStatus(requestFromSearchParams(request));
    return NextResponse.json(view);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** Launch or resume the session for an explicit, registered project/worktree root. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<ProjectWorkspaceRequest> & {
      projectName?: unknown;
      workItemId?: unknown;
      worktreeLabel?: unknown;
      returnUrl?: unknown;
      executionApproved?: unknown;
      executionContext?: unknown;
    };
    if (!body.rootPath) {
      throw new VaultError("INVALID_PATH", 'Body field "rootPath" is required.');
    }
    const resolved = await resolveProjectWorkspace(body as ProjectWorkspaceRequest);
    const view = await ensureProjectWorkspaceSession(body as ProjectWorkspaceRequest, {
      frameOrigin: frameOriginFromRequest(request),
    });
    const capability = issueWorkspaceCapability(body as ProjectWorkspaceRequest & typeof body, {
      ...resolved,
      realRoot: view.rootPath ?? resolved.realRoot,
      accessMode: view.accessMode ?? resolved.accessMode,
      branch: view.branch ?? resolved.branch,
    });
    return NextResponse.json({ ...view, ...capability });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** Stop the session for one project workspace root. Unlike the note-owned route, "root" is always required here. */
export async function DELETE(request: Request) {
  try {
    const result = await stopProjectWorkspaceSession(requestFromSearchParams(request));
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
