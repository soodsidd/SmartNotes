import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * SN-301: in-app fallback status for Settings → Server. When the app runs
 * under gateway-start.js the supervisor sets SMART_NOTES_CONTROL_PORT, which
 * the panel uses to reach Start/Stop/Restart (the supervisor outlives the app).
 */
export async function GET() {
  const port = Number(process.env.PORT || 3002);
  const controlPort = Number(process.env.SMART_NOTES_CONTROL_PORT) || null;
  const dist = process.env.SMART_NOTES_NEXT_DIST_DIR || ".next";
  let build: string | null = null;
  try {
    build = fs.readFileSync(path.join(process.cwd(), dist, "BUILD_ID"), "utf8").trim();
  } catch {
    // A development preview may not have a BUILD_ID yet.
  }
  return NextResponse.json({
    status: "running",
    address: `http://localhost:${port}`,
    reachable: true,
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    build,
    log: "",
    supervised: false,
    controlPort,
  }, { headers: { "Cache-Control": "no-store" } });
}
