import { NextResponse } from "next/server";
import {
  loadNotebookRegistry,
  portableNotebookPath,
  registerPortableNotebookFromInput,
  unregisterPortableNotebook,
  type RegisterPortableNotebookInput,
} from "@/server/vault/notebook-registry";
import { invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

export const dynamic = "force-dynamic";

function invalidateTreeCache() {
  invalidateVaultTreeCacheForTesting();
}

/** GET /api/notebook-registry — list registered portable notebooks */
export async function GET() {
  try {
    const registry = loadNotebookRegistry();
    return NextResponse.json({
      notebooks: registry.notebooks.map((entry) => ({
        ...entry,
        path: portableNotebookPath(entry.id),
      })),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** POST /api/notebook-registry — register a directory (existing or create-on-register) */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RegisterPortableNotebookInput;
    const hasRootPath = Boolean(body.rootPath?.trim());
    const hasParentAndFolder = Boolean(body.parentPath?.trim() && body.folderName?.trim());
    if (!hasRootPath && !hasParentAndFolder) {
      throw new VaultError(
        "INVALID_PATH",
        'Provide "rootPath" for an existing folder, or "parentPath" and "folderName" to create one.'
      );
    }

    const entry = registerPortableNotebookFromInput(body);
    invalidateTreeCache();
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json(
      {
        notebook: {
          ...entry,
          path: portableNotebookPath(entry.id),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** DELETE /api/notebook-registry?id=… — remove registration without deleting files */
export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      throw new VaultError("INVALID_PATH", 'Query parameter "id" is required.');
    }

    const removed = unregisterPortableNotebook(id);
    invalidateTreeCache();
    emitVaultSideEffects({ treeChanged: true });
    return NextResponse.json({ notebook: removed });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
