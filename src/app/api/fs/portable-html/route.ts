import { NextResponse } from "next/server";
import { listPortableHtmlBrowser } from "@/server/fs/portable-html-browser";
import { toErrorResponse } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/fs/portable-html?path=…
 * List folders + `.html` files inside registered portable-notebook roots (SN-168).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const folderPath = searchParams.get("path") ?? undefined;
    return NextResponse.json(listPortableHtmlBrowser(folderPath));
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
