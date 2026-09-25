import { NextResponse } from "next/server";
import {
  createServerFolder,
  listServerFolders,
  validateServerFolder,
} from "@/server/fs/server-folder-browser";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

/** GET /api/fs/server-folders — list directories on the Smart Notes backend host */
export async function GET(request: Request) {
  try {
    const folderPath = new URL(request.url).searchParams.get("path") ?? undefined;
    return NextResponse.json(listServerFolders(folderPath));
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** POST /api/fs/server-folders — create or validate a backend-host folder */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      parentPath?: string;
      folderName?: string;
      path?: string;
    };

    if (body.action === "create") {
      if (!body.parentPath?.trim() || !body.folderName?.trim()) {
        throw new VaultError("INVALID_PATH", "Provide parentPath and folderName to create a server folder.");
      }
      return NextResponse.json(createServerFolder(body.parentPath, body.folderName), { status: 201 });
    }

    if (body.action === "validate") {
      if (!body.path?.trim()) {
        throw new VaultError("INVALID_PATH", "Provide path to validate a server folder.");
      }
      return NextResponse.json(validateServerFolder(body.path));
    }

    throw new VaultError("INVALID_ACTION", 'Use action "create" or "validate".');
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
