import { NextResponse } from "next/server";
import { readPageComments, savePageComments, type StoredComment } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pagePath = url.searchParams.get("path");
    if (!pagePath) {
      throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
    }
    const comments = await readPageComments(pagePath);
    return NextResponse.json({ comments });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { path?: string; comments?: StoredComment[]; pageBody?: string };
    if (!body.path) {
      throw new VaultError("INVALID_PATH", '"path" is required.');
    }
    const comments = await savePageComments(body.path, body.comments ?? [], body.pageBody);
    return NextResponse.json({ comments });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
