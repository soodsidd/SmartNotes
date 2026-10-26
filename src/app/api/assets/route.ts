import { NextResponse } from "next/server";
import { uploadPageAsset } from "@/server/vault/assets";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { MAX_PAGE_ASSET_BYTES, PAGE_ASSET_TOO_LARGE_HINT } from "@/lib/editor-asset-upload";

function searchParamPath(request: Request) {
  const url = new URL(request.url);
  const pagePath = url.searchParams.get("path");
  if (!pagePath) {
    throw new VaultError("INVALID_PATH", "Query parameter \"path\" is required.");
  }
  return pagePath;
}

export async function POST(request: Request) {
  try {
    const pagePath = searchParamPath(request);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new VaultError("INVALID_INPUT", "Multipart field \"file\" is required.");
    }
    if (file.size > MAX_PAGE_ASSET_BYTES) {
      throw new VaultError("INVALID_INPUT", PAGE_ASSET_TOO_LARGE_HINT, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await uploadPageAsset(pagePath, file.name, buffer);

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
