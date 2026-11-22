import { NextResponse } from "next/server";
import { readAnnotationsScene, saveAnnotationsScene } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { parseInkEngine } from "@/server/vault/ink-sidecars";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const path = query.get("path");
    if (!path) throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
    const { scene, drawableBottom } = await readAnnotationsScene(path, parseInkEngine(query.get("engine")));
    return NextResponse.json({ scene, drawableBottom });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const { path, scene, drawableBottom, engine } = (await request.json()) as {
      path?: string;
      scene?: unknown;
      drawableBottom?: number;
      engine?: unknown;
    };
    if (!path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" is required.');
    }
    await saveAnnotationsScene(path, scene ?? null, {
      engine: parseInkEngine(engine),
      drawableBottom:
        typeof drawableBottom === "number" && Number.isFinite(drawableBottom)
          ? drawableBottom
          : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
