import { NextResponse } from "next/server";

import { runWorkspaceGit, workspaceGitErrorBody } from "@/server/jupyter/workspace-git";
import { toErrorResponse } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

/**
 * SN-409 capability-bound Git for Deep Work Companion turns.
 * Body: { workspace: "dwc_...", operation: status|diff|log|stage|unstage|commit|fetch|pull|push, ...args }.
 * There is no free-form command or argv input; see workspace-git.ts.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { workspace, operation, ...args } = body;
    const turnHeader = request.headers.get("x-smart-notes-turn-id");
    if (turnHeader && args.turnId === undefined) args.turnId = turnHeader;
    return NextResponse.json(await runWorkspaceGit(workspace, operation, args));
  } catch (error) {
    const gitError = workspaceGitErrorBody(error);
    if (gitError) return NextResponse.json(gitError.body, { status: gitError.status });
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
