import { NextResponse } from "next/server";
import {
  linkDesignPage,
  relinkDesignPage,
  toApiPageDocument,
  unlinkDesignPage,
} from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/page/design-link — link an existing self-contained HTML file in place (SN-168).
 * Body: { sourcePath: string, title?: string, replacePath?: string }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sourcePath?: string;
      title?: string;
      replacePath?: string;
    };
    const page = await linkDesignPage({
      sourcePath: body.sourcePath ?? "",
      title: body.title,
      replacePath: body.replacePath,
    });
    const apiPage = toApiPageDocument(page);
    return NextResponse.json(
      {
        page: apiPage,
        resolvedDiskPath: apiPage.resolvedDiskPath,
      },
      { status: 201 }
    );
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/**
 * PATCH /api/page/design-link — relink a linked design to a different HTML file.
 * Body: { path: string, sourcePath: string, title?: string }
 */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      path?: string;
      sourcePath?: string;
      title?: string;
    };
    const page = await relinkDesignPage({
      path: body.path ?? "",
      sourcePath: body.sourcePath ?? "",
      title: body.title,
    });
    return NextResponse.json({ page: toApiPageDocument(page) });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/**
 * DELETE /api/page/design-link?path=… — remove link metadata; leave the HTML on disk.
 */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const pagePath = url.searchParams.get("path");
    if (!pagePath) {
      throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
    }
    const result = await unlinkDesignPage(pagePath);
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
