import { NextResponse } from "next/server";
import { executeVaultCommand, listVaultCommands, type VaultCommandRequest } from "@/server/vault/agent-commands";
import { executeVaultTool, formatVaultToolsPrompt, VAULT_TOOL_DEFINITIONS } from "@/server/vault/agent-tools";
import { toErrorResponse } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    tools: VAULT_TOOL_DEFINITIONS,
    commands: listVaultCommands(),
    prompt: formatVaultToolsPrompt(),
    endpoint: "POST /api/agent/vault",
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      tool?: string;
      args?: Record<string, unknown>;
      group?: VaultCommandRequest["group"];
      action?: string;
    };

    if (body.tool) {
      const outcome = await executeVaultTool(body.tool, body.args ?? {});
      if (!outcome.ok) {
        return NextResponse.json(
          { error: outcome.error, code: outcome.code, tool: outcome.tool },
          { status: outcome.status ?? 400 }
        );
      }
      emitVaultSideEffects(outcome.result);
      return NextResponse.json(outcome);
    }

    if (body.group && body.action) {
      const result = await executeVaultCommand({
        group: body.group,
        action: body.action,
        args: body.args ?? {},
      });
      emitVaultSideEffects(result);
      return NextResponse.json({ ok: true, result });
    }

    return NextResponse.json(
      { error: 'Provide either { tool, args } or { group, action, args }.', code: "INVALID_INPUT" },
      { status: 400 }
    );
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
