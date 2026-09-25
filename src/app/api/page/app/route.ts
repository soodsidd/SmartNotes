import { NextResponse } from "next/server";
import {
  bootstrapAppRuntime,
  saveAppManifest,
  setAppEnabled,
} from "@/server/vault/app-runtime";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

function requiredPath(value: unknown): string {
  if (typeof value !== "string" || !value) throw new VaultError("INVALID_PATH", "An App page path is required.", 400);
  return value;
}

/** Owner bootstrap. The server session token stays in the host and is never injected into app source. */
export async function GET(request: Request) {
  try {
    const path = requiredPath(new URL(request.url).searchParams.get("path"));
    const bootstrap = await bootstrapAppRuntime(path, request.headers.get("x-smart-notes-app-session"));
    return NextResponse.json(bootstrap, {
      headers: { "Cache-Control": "no-store", ETag: `"${bootstrap.revision}"` },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** Owner-only manifest replacement used by Develop > Data attachment controls. */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { path?: unknown; manifest?: unknown };
    const path = requiredPath(body.path);
    const manifest = await saveAppManifest(path, body.manifest);
    emitVaultSideEffects({ fileUpdated: { path, content: "", kind: "app_data" } });
    return NextResponse.json({ manifest });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** Persist owner Disable/Enable independently of the recoverable in-memory Stop control. */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { path?: unknown; enabled?: unknown };
    const path = requiredPath(body.path);
    if (typeof body.enabled !== "boolean") throw new VaultError("INVALID_APP", "enabled must be boolean.", 400);
    const manifest = await setAppEnabled(path, body.enabled);
    emitVaultSideEffects({ fileUpdated: { path, content: "", kind: "app_data" } });
    return NextResponse.json({ manifest });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
