import { NextResponse } from "next/server";
import { executeAppRpc } from "@/server/vault/app-runtime";
import { promoteJobPosting } from "@/server/vault/job-inbox";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.path !== "string" || typeof body.rowId !== "string" || typeof body.runFit !== "boolean") {
      throw new VaultError("INVALID_JOB_PROMOTE", "App path, posting ID, and Run Fit choice are required.", 400);
    }
    await executeAppRpc({ path: body.path, sessionToken: body.sessionToken, tableId: "postings", operation: "query", query: { limit: 1 } });
    const result = await promoteJobPosting(body.path, body.rowId, body.runFit);
    emitVaultSideEffects({ treeChanged: result.created });
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
