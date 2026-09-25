import { parseJupyterInlineContext, utf8ByteLength } from "@/lib/jupyter-focus";
import { VaultError } from "@/server/vault/errors";
import { sendJupyterFastLaneMessage } from "@/server/ai/jupyter-fast-lane";
import { resolveJupyterOwnerPath } from "@/server/jupyter/workspace-request";
import { workspacePathBlockReason } from "@/lib/deep-work";

export const dynamic = "force-dynamic";

const FAST_LANE_MESSAGE_MAX_BYTES = 16 * 1024;

interface StreamRequestBody {
  path?: string;
  message?: string;
  context?: unknown;
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function errorPayload(error: unknown): { error: string; code: string } {
  const code =
    error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "FAST_LANE_PROVIDER_ERROR";
  const message = error instanceof Error ? error.message : "The inline AI request failed.";
  return { error: message, code };
}

/**
 * SN-253 — streaming sibling of POST /api/companion/fast-lane/send.
 *
 * Deliberately a separate route rather than a mode of the JSON one: the
 * existing JSON endpoint stays for Explain / Ask (and any non-streaming
 * caller), while notebook-routed code actions and Answer comment take this
 * SSE path so the overlay can show live text (SN-253 / SN-255).
 * Emits `delta` events carrying newly produced answer text, then exactly one
 * terminal `done` or `error` event. The `done` payload always carries the
 * complete answer, so a client that missed deltas is still correct.
 */
export async function POST(request: Request) {
  let path: string | null = null;
  let message = "";
  let context: ReturnType<typeof parseJupyterInlineContext> = null;

  try {
    const body = (await request.json().catch(() => ({}))) as StreamRequestBody;
    path = await resolveJupyterOwnerPath(body.path);
    message = typeof body.message === "string" ? body.message : "";
    if (!path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" must identify a Jupyter note or validated Deep Work workspace.');
    }
    if (utf8ByteLength(message) > FAST_LANE_MESSAGE_MAX_BYTES) {
      throw new VaultError("FAST_LANE_MESSAGE_TOO_LARGE", "Fast-lane message exceeds 16 KiB.", 413);
    }
    const hasContext = Object.prototype.hasOwnProperty.call(body, "context");
    context = hasContext ? parseJupyterInlineContext(body.context, path) : null;
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
  } catch (error) {
    // Validation failures are ordinary HTTP errors: no stream was opened yet,
    // so the client's fetch rejects exactly like the non-streaming route.
    const payload = errorPayload(error);
    const status = error instanceof VaultError ? error.status : 400;
    return Response.json(payload, { status });
  }

  const pagePath = path;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (name: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(name, data)));
        } catch {
          closed = true;
        }
      };

      try {
        const result = await sendJupyterFastLaneMessage(pagePath, message, {
          signal: request.signal,
          context,
          onText: (chunk) => send("delta", { text: chunk }),
        });
        send("done", {
          text: result.text,
          sessionId: result.sessionId,
          durationMs: result.durationMs,
        });
      } catch (error) {
        send("error", errorPayload(error));
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by client disconnect.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Proxies that buffer would defeat the point of the live stream.
      "X-Accel-Buffering": "no",
    },
  });
}
