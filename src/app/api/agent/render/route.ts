import { NextResponse } from "next/server";
import { renderPageToPng } from "@/server/vault/page-render";
import { toErrorResponse } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/render?path=<vault-relative-path>
 *
 * WebFetch-callable (GET-only) alternative to the page_render vault tool.
 * The companion's editor sandbox has WebFetch (GET) but no Bash and no POST
 * capability, so this endpoint lets the companion trigger a Playwright render
 * and get back an absoluteDiskPath it can then Read for vision.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pagePath = searchParams.get("path");

  if (!pagePath?.trim()) {
    return NextResponse.json(
      { error: "Missing required query parameter: path", code: "INVALID_INPUT" },
      { status: 400 }
    );
  }

  try {
    const result = await renderPageToPng({ pagePath: pagePath.trim() });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
