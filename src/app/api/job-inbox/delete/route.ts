import { NextResponse } from "next/server";
import { executeAppRpc } from "@/server/vault/app-runtime";
import { deleteJobPosting } from "@/server/vault/job-inbox";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.path !== "string" || typeof body.rowId !== "string") {
      throw new VaultError("INVALID_JOB_DELETE", "App path and posting ID are required.", 400);
    }
    await executeAppRpc({ path: body.path, sessionToken: body.sessionToken, tableId: "postings", operation: "query", query: { limit: 1 } });
    const result = await deleteJobPosting(body.path, body.rowId);
    emitVaultSideEffects({ treeChanged: false });
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
