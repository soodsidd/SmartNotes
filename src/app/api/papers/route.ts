import { NextResponse } from "next/server";
import { createPaper, readVaultTree, toApiPageDocument } from "@/server/vault/pages";
import { bibliographyEntries } from "@/lib/papers";
import { toErrorResponse } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { tree } = await readVaultTree({ skipCache: true });
    return NextResponse.json({ papers: bibliographyEntries(tree) });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const page = await createPaper(body.title);
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ page: toApiPageDocument(page) }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
