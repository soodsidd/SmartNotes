import { NextResponse } from "next/server";
import { executeOwnerAppDataMutation, readAppDataSnapshot } from "@/server/vault/app-runtime";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

function requiredPath(value: unknown): string {
  if (typeof value !== "string" || !value) throw new VaultError("INVALID_PATH", "An App page path is required.", 400);
  return value;
}

/** Host-owned Develop > Data snapshot. It never issues or rotates a frame session. */
export async function GET(request: Request) {
  try {
    const path = requiredPath(new URL(request.url).searchParams.get("path"));
    const snapshot = await readAppDataSnapshot(path);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store", ETag: `"${snapshot.revision}"` },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** Same-origin owner correction path; opaque App frames cannot call it through their denied network policy. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const path = requiredPath(body.path);
    const data = await executeOwnerAppDataMutation({
      path,
      sessionToken: body.sessionToken,
      tableId: body.tableId,
      operation: body.operation,
      rowId: body.rowId,
      values: body.values,
    });
    emitVaultSideEffects({ fileUpdated: { path, content: "", kind: "app_data" } });
    return NextResponse.json({ data });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
