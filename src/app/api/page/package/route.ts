import { NextResponse } from "next/server";
import { buildAttachmentContentDisposition } from "@/server/http/content-disposition";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import {
  exportPagePackage,
  importPagePackage,
  PAGE_PACKAGE_EXTENSION,
  PAGE_PACKAGE_LIMITS,
  PAGE_PACKAGE_MEDIA_TYPE,
} from "@/server/vault/page-package";
import { emitVaultSideEffects } from "@/server/vault/socket-events";
import { toApiPageDocument } from "@/server/vault/pages";

export const dynamic = "force-dynamic";

function requiredPagePath(request: Request): string {
  const pagePath = new URL(request.url).searchParams.get("path")?.trim();
  if (!pagePath) {
    throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
  }
  return pagePath;
}

export async function GET(request: Request) {
  try {
    const result = await exportPagePackage(requiredPagePath(request));
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": PAGE_PACKAGE_MEDIA_TYPE,
        "Content-Disposition": buildAttachmentContentDisposition(result.title, PAGE_PACKAGE_EXTENSION),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > PAGE_PACKAGE_LIMITS.compressedBytes + 1024 * 1024) {
      throw new VaultError("PAGE_PACKAGE_TOO_LARGE", "Page package is too large.", 413);
    }

    const formData = await request.formData();
    const sectionPath = String(formData.get("sectionPath") ?? "").trim();
    const file = formData.get("file");
    if (!sectionPath) {
      throw new VaultError("INVALID_PATH", 'Multipart field "sectionPath" is required.');
    }
    if (!(file instanceof File)) {
      throw new VaultError("INVALID_INPUT", 'Multipart field "file" is required.');
    }
    if (!file.name.toLowerCase().endsWith(PAGE_PACKAGE_EXTENSION)) {
      throw new VaultError(
        "INVALID_PAGE_PACKAGE",
        `Import requires a ${PAGE_PACKAGE_EXTENSION} file.`
      );
    }
    if (file.size > PAGE_PACKAGE_LIMITS.compressedBytes) {
      throw new VaultError("PAGE_PACKAGE_TOO_LARGE", "Page package is too large.", 413);
    }

    const page = await importPagePackage({
      sectionPath,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ page: toApiPageDocument(page) }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
