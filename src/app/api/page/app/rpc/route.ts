import { NextResponse } from "next/server";
import { executeAppRpc } from "@/server/vault/app-runtime";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.path !== "string" || !body.path) {
      throw new VaultError("INVALID_PATH", "An App page path is required.", 400);
    }
    const data = await executeAppRpc({
      path: body.path,
      sessionToken: body.sessionToken,
      tableId: body.tableId,
      operation: body.operation,
      rowId: body.rowId,
      values: body.values,
      query: body.query,
      clientMutationId: body.clientMutationId,
      acceptedAt: body.acceptedAt,
      upsertKey: body.upsertKey,
    });
    if (body.operation !== "query") {
      emitVaultSideEffects({ fileUpdated: { path: body.path, content: "", kind: "app_data" } });
    }
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json({ ok: false, ...response.body }, { status: response.status });
  }
}
