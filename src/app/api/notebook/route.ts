import { NextResponse } from "next/server";
import { createNotebook, deleteNotebook, renameNotebook } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

/** POST /api/notebook  { name: string } → create a new notebook */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string };
    const notebook = await createNotebook(body.name ?? "");
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ notebook }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** PATCH /api/notebook  { path: string; name: string } → rename a notebook */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { path?: string; name?: string };
    if (!body.path) {
      throw new VaultError("INVALID_PATH", "Query parameter \"path\" is required.");
    }
    const notebook = await renameNotebook(body.path, body.name ?? "");
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ notebook });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** DELETE /api/notebook?path=… → delete a notebook (recursive) */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const notebookPath = url.searchParams.get("path");
    if (!notebookPath) {
      throw new VaultError("INVALID_PATH", "Query parameter \"path\" is required.");
    }
    const result = await deleteNotebook(notebookPath);
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
