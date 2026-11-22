import { NextResponse } from "next/server";
import { readAnnotationsScene, saveAnnotationsScene } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { parseInkEngine } from "@/server/vault/ink-sidecars";
import { parsePdfInkPagePath } from "@/lib/pdf-annotations";
import { readPdfInkPage, savePdfInkPage } from "@/server/vault/pdf-annotations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const path = query.get("path");
    if (!path) throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
    const engine = parseInkEngine(query.get("engine"));
    const pdfPage = engine === "smart-notes" ? parsePdfInkPagePath(path) : null;
    if (pdfPage) return NextResponse.json(await readPdfInkPage(pdfPage.pdfPath, pdfPage.page));
    const { scene, drawableBottom } = await readAnnotationsScene(path, engine);
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
    const selectedEngine = parseInkEngine(engine);
    const pdfPage = selectedEngine === "smart-notes" ? parsePdfInkPagePath(path) : null;
    if (pdfPage) {
      await savePdfInkPage(pdfPage.pdfPath, pdfPage.page, scene ?? null);
      return NextResponse.json({ ok: true });
    }
    await saveAnnotationsScene(path, scene ?? null, {
      engine: selectedEngine,
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
