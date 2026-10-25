import { NextResponse } from "next/server";

import { cancelCellRunWake, listCellRunWakes } from "@/server/jupyter/cell-run-wake";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

/** SN-377: list Jupyter cell wakes (pending + recently settled) for the shell. */
export async function GET() {
  try {
    return NextResponse.json({ wakes: await listCellRunWakes() });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** SN-377: owner cancel — `{ action: "cancel", wakeId, interrupt? }`. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; wakeId?: unknown; interrupt?: unknown };
    if (body.action !== "cancel") {
      throw new VaultError("INVALID_INPUT", 'Only { action: "cancel" } is supported.');
    }
    if (typeof body.wakeId !== "string" || !body.wakeId.trim()) {
      throw new VaultError("INVALID_INPUT", '"wakeId" is required.');
    }
    const wake = await cancelCellRunWake(body.wakeId.trim(), { interrupt: body.interrupt === true });
    return NextResponse.json({ ok: true, wake });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
