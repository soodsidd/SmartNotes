import { NextResponse } from "next/server";
import { readInkScene, saveInkScene, type InkBackgroundMode } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

function searchParamPath(request: Request) {
  const url = new URL(request.url);
  const pagePath = url.searchParams.get("path");
  if (!pagePath) {
    throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
  }
  return pagePath;
}

export async function GET(request: Request) {
  try {
    const { scene, backgroundMode } = await readInkScene(searchParamPath(request));
    return NextResponse.json({ scene, backgroundMode });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const { path, scene, backgroundMode } = (await request.json()) as {
      path?: string;
      scene?: unknown;
      backgroundMode?: string;
    };
    if (!path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" is required.');
    }
    const mode: InkBackgroundMode = backgroundMode === "grid" ? "grid" : "blank";
    await saveInkScene(path, scene ?? null, mode);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
