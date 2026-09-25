import { NextResponse } from "next/server";
import { appPagesCapability } from "@/lib/app-capabilities";

/** Runtime-level App support probe. It is independent of any vault page state. */
export async function GET() {
  return NextResponse.json(appPagesCapability(), {
    headers: { "Cache-Control": "no-store" },
  });
}
