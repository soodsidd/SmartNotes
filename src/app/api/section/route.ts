import { NextResponse } from "next/server";
import { createSection, deleteSection, renameSection, reorderSectionPages } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

/** POST /api/section  { notebookPath: string; name: string } → create a new section */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { notebookPath?: string; name?: string };
    if (!body.notebookPath) {
      throw new VaultError("INVALID_PATH", "\"notebookPath\" is required.");
    }
    const section = await createSection(body.notebookPath, body.name ?? "");
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ section }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** PATCH /api/section  { path: string; name: string } → rename a section */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { path?: string; name?: string };
    if (!body.path) {
      throw new VaultError("INVALID_PATH", "\"path\" is required.");
    }
    const section = await renameSection(body.path, body.name ?? "");
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ section });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** PUT /api/section  { sectionPath: string; orderedIds: string[] } → persist page order for a section */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { sectionPath?: string; orderedIds?: unknown };
    if (!body.sectionPath) {
      throw new VaultError("INVALID_PATH", "\"sectionPath\" is required.");
    }
    if (!Array.isArray(body.orderedIds)) {
      throw new VaultError("INVALID_PAYLOAD", "\"orderedIds\" must be an array.");
    }
    await reorderSectionPages(body.sectionPath, body.orderedIds as string[]);
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** DELETE /api/section?path=… → delete a section (recursive) */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const sectionPath = url.searchParams.get("path");
    if (!sectionPath) {
      throw new VaultError("INVALID_PATH", "Query parameter \"path\" is required.");
    }
    const result = await deleteSection(sectionPath);
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
