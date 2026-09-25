import { NextResponse } from "next/server";
import { readAnnotationsScene, saveAnnotationsScene } from "@/server/vault/pages";
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
    const { scene, drawableBottom } = await readAnnotationsScene(searchParamPath(request));
    return NextResponse.json({ scene, drawableBottom });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const { path, scene, drawableBottom } = (await request.json()) as {
      path?: string;
      scene?: unknown;
      drawableBottom?: number;
    };
    if (!path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" is required.');
    }
    await saveAnnotationsScene(path, scene ?? null, {
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
