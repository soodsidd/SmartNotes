import { NextResponse } from "next/server";
import { capturePage, toApiPageDocument } from "@/server/vault/pages";
import { toErrorResponse } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

/**
 * POST /api/capture
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      destination?: "inbox" | "page";
      title?: string;
      content?: string;
      notebookPath?: string;
      sectionPath?: string;
    };
    const page = await capturePage(body);
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ page: toApiPageDocument(page) }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
