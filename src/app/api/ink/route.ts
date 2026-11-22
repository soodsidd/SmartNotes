import { NextResponse } from "next/server";
import { readInkScene, saveInkScene, type InkBackgroundMode } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { parseInkEngine } from "@/server/vault/ink-sidecars";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const path = query.get("path");
    if (!path) throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
    const { scene, backgroundMode } = await readInkScene(path, parseInkEngine(query.get("engine")));
    return NextResponse.json({ scene, backgroundMode });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const { path, scene, backgroundMode, engine } = (await request.json()) as {
      path?: string;
      scene?: unknown;
      backgroundMode?: string;
      engine?: unknown;
    };
    if (!path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" is required.');
    }
    const mode: InkBackgroundMode = backgroundMode === "grid" ? "grid" : "blank";
    await saveInkScene(path, scene ?? null, mode, parseInkEngine(engine));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
