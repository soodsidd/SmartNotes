import { NextResponse } from "next/server";
import { readVaultTree } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

interface RouteContext {
  params: {
    notebook: string;
  };
}

/**
 * GET /api/notebooks/:notebook/sections
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const notebookPath = decodeURIComponent(context.params.notebook);
    const { tree } = await readVaultTree();
    const notebook = tree.find((entry) => entry.path === notebookPath || entry.id === notebookPath);
    if (!notebook) {
      throw new VaultError("NOTEBOOK_NOT_FOUND", `Notebook not found: ${notebookPath}`, 404);
    }

    return NextResponse.json({
      notebook: {
        id: notebook.id,
        path: notebook.path,
        name: notebook.name,
      },
      sections: notebook.sections.map((section) => ({
        id: section.id,
        path: section.path,
        name: section.name,
      })),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
