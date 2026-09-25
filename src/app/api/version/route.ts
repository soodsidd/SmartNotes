import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

let cachedBuildId: string | null = null;

/**
 * Resolve the deployed build id (SN-85).
 *
 * Mirrors scripts/generate-service-worker.mjs so /api/version reports the same
 * identifier baked into the generated service worker for a given build: the
 * controlling SW compares its own BUILD_ID against this value to detect a new
 * deploy. Resolution is cached for the lifetime of the server process.
 */
function resolveBuildId(): string {
  if (cachedBuildId) {
    return cachedBuildId;
  }

  const root = process.cwd();
  const nextDistDir = process.env.SMART_NOTES_NEXT_DIST_DIR || ".next";
  const buildIdPath = path.join(root, nextDistDir, "BUILD_ID");
  try {
    if (fs.existsSync(buildIdPath)) {
      cachedBuildId = fs.readFileSync(buildIdPath, "utf8").trim();
      return cachedBuildId;
    }
  } catch {
    // fall through to git / dev fallback
  }

  try {
    cachedBuildId = execSync("git rev-parse --short HEAD", {
      cwd: root,
      encoding: "utf8",
    }).trim();
    return cachedBuildId;
  } catch {
    cachedBuildId = "dev";
    return cachedBuildId;
  }
}

export async function GET() {
  const buildId = resolveBuildId();
  return NextResponse.json(
    { buildId },
    {
      headers: {
        "SW-Build-ID": buildId,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
