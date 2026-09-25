import { NextResponse } from "next/server";
import { readVaultTree } from "@/server/vault/pages";
import { toErrorResponse } from "@/server/vault/errors";

/**
 * GET /api/notebooks
 */
export async function GET() {
  try {
    const { tree } = await readVaultTree();
    return NextResponse.json({
      notebooks: tree.map((notebook) => ({
        id: notebook.id,
        path: notebook.path,
        name: notebook.name,
        color: notebook.color,
        isPortable: Boolean(notebook.isPortable),
      })),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
