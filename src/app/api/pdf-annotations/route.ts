import { NextResponse } from "next/server";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { readPdfAnnotations, savePdfAnnotations } from "@/server/vault/pdf-annotations";

export const dynamic = "force-dynamic";

function searchParamPath(request: Request) {
  const url = new URL(request.url);
  const pdfPath = url.searchParams.get("path");
  if (!pdfPath) {
    throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
  }
  return pdfPath;
}

export async function GET(request: Request) {
  try {
    const sidecar = await readPdfAnnotations(searchParamPath(request));
    return NextResponse.json(sidecar);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { path?: string; items?: unknown };
    if (!body.path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" is required.');
    }
    const sidecar = await savePdfAnnotations(body.path, body.items ?? []);
    return NextResponse.json({ ok: true, sidecar });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
