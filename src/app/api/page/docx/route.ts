import { NextResponse } from "next/server";
import { buildAttachmentContentDisposition } from "@/server/http/content-disposition";
import { exportPageAsDocx, importPageFromDocx, toApiPageDocument } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

function docxResponse(buffer: Buffer, fileName: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": buildAttachmentContentDisposition(fileName, ".docx"),
      "Cache-Control": "no-store",
    },
  });
}

function searchParamPath(request: Request) {
  const url = new URL(request.url);
  const pagePath = url.searchParams.get("path");
  if (!pagePath) {
    throw new VaultError("INVALID_PATH", "Query parameter \"path\" is required.");
  }
  return pagePath;
}

export async function GET(request: Request) {
  try {
    const path = searchParamPath(request);
    const buffer = await exportPageAsDocx({ path });
    const title = path.split("/").pop()?.replace(/\.html$/i, "") ?? "Smart Notes page";
    return docxResponse(buffer, title);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { path?: string; title?: string; bodyHtml?: string };
    if (!body.path) {
      throw new VaultError("INVALID_PATH", "Field \"path\" is required.");
    }
    const buffer = await exportPageAsDocx({
      path: body.path,
      title: body.title,
      bodyHtml: body.bodyHtml,
    });
    return docxResponse(buffer, body.title ?? body.path);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const sectionPath = String(formData.get("sectionPath") ?? "").trim();
    const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
    const publishedUrl = String(formData.get("publishedUrl") ?? "").trim();
    const file = formData.get("file");

    if (!sectionPath) {
      throw new VaultError("INVALID_PATH", "Multipart field \"sectionPath\" is required.");
    }
    if (!(file instanceof File)) {
      throw new VaultError("INVALID_INPUT", "Multipart field \"file\" is required.");
    }
    if (!file.name.toLowerCase().endsWith(".docx")) {
      throw new VaultError("INVALID_DOCX", "Import requires a .docx file.", 400);
    }

    const page = await importPageFromDocx({
      sectionPath,
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      sourceUrl,
      publishedUrl,
    });

    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ page: toApiPageDocument(page) }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
