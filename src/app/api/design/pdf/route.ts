import { NextResponse } from "next/server";
import { renderDesignToPdf } from "@/server/vault/page-render";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await request.json() as { path?: unknown; bodyHtml?: unknown };
    if (typeof input.path !== "string" || !input.path.trim() || (input.bodyHtml !== undefined && typeof input.bodyHtml !== "string")) {
      throw new VaultError("INVALID_INPUT", "A design page path and optional HTML body are required.", 400);
    }
    const result = await renderDesignToPdf(input.path, input.bodyHtml as string | undefined);
    return new Response(new Uint8Array(result.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="design-page.pdf"',
        "Content-Length": String(result.pdf.length),
        "X-Design-Page-Count": String(result.pages),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
