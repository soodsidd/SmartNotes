import { NextResponse } from "next/server";

import { parseJupyterInlineContext, utf8ByteLength } from "@/lib/jupyter-focus";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { sendJupyterFastLaneMessage } from "@/server/ai/jupyter-fast-lane";
import { resolveJupyterOwnerPath } from "@/server/jupyter/workspace-request";
import { workspacePathBlockReason } from "@/lib/deep-work";

export const dynamic = "force-dynamic";

const FAST_LANE_ERROR_STATUS: Record<string, number> = {
  FAST_LANE_EMPTY_MESSAGE: 400,
  FAST_LANE_BUSY: 409,
  FAST_LANE_ABORTED: 499,
  FAST_LANE_TIMEOUT: 504,
  FAST_LANE_INCOMPLETE: 502,
  FAST_LANE_PROVIDER_ERROR: 502,
};

const FAST_LANE_MESSAGE_MAX_BYTES = 16 * 1024;

/**
 * SN-247: server-side fast-lane path. Accepts a prompt for an open Jupyter
 * page and returns model text without invoking the companion tool surface or
 * its full system prompt — resumes the page's warmed Claude session
 * (captured via ensureJupyterFastLaneWarm) when one exists, or falls back to
 * a cold turn so the request still succeeds even before warm-up lands.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      path?: string;
      message?: string;
      context?: unknown;
    };
    const path = await resolveJupyterOwnerPath(body.path);
    const message = typeof body.message === "string" ? body.message : "";
    if (!path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" must identify a Jupyter note or validated Deep Work workspace.');
    }
    if (utf8ByteLength(message) > FAST_LANE_MESSAGE_MAX_BYTES) {
      throw new VaultError("FAST_LANE_MESSAGE_TOO_LARGE", "Fast-lane message exceeds 16 KiB.", 413);
    }
    const hasContext = Object.prototype.hasOwnProperty.call(body, "context");
    const context = hasContext ? parseJupyterInlineContext(body.context, path) : null;
    if (hasContext && !context) {
      throw new VaultError(
        "INVALID_JUPYTER_CONTEXT",
        "Jupyter context is malformed, oversized, or contains an unsafe workspace path."
      );
    }
    if (
      path.startsWith("dwc_") &&
      context &&
      (!context.workspacePath || workspacePathBlockReason(context.workspacePath))
    ) {
      throw new VaultError(
        "WORKSPACE_AI_PROTECTED_PATH",
        "Inline AI is unavailable for hidden, secret-shaped, dependency, VCS, build, or cache paths.",
        403
      );
    }
    const result = await sendJupyterFastLaneMessage(path, message, {
      signal: request.signal,
      context,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as { code?: unknown }).code;
      const status = typeof code === "string" ? FAST_LANE_ERROR_STATUS[code] : undefined;
      if (status) {
        const message = error instanceof Error ? error.message : String(code);
        return NextResponse.json({ error: message, code }, { status });
      }
    }
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
