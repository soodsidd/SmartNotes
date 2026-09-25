import { NextResponse } from "next/server";

import { getJupyterProfileStatus } from "@/server/jupyter/runtime";

export const dynamic = "force-dynamic";

/** Read-only bootstrap-profile capability status for Settings → App. */
export async function GET() {
  const { jupyterExecutable: _jupyterExecutable, ...status } = await getJupyterProfileStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" },
  });
}
