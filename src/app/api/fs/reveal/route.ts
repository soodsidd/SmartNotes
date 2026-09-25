import { NextResponse } from "next/server";
import {
  revealAbsolutePathInExplorer,
  revealNotebookInExplorer,
} from "@/server/fs/reveal-in-explorer";
import { findPortableNotebookContainingPath } from "@/server/vault/design-link";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { resolveVaultPath } from "@/server/vault/paths";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * POST /api/fs/reveal — open a notebook folder or a contained absolute file in
 * the system file manager.
 *
 * Body:
 * - { notebookPath } — reveal a notebook root
 * - { absolutePath } — reveal a file/folder inside a registered portable root
 * - { pagePath } — reveal the resolved disk path for a vault page
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      notebookPath?: string;
      absolutePath?: string;
      pagePath?: string;
    };

    const absolutePath = String(body.absolutePath ?? "").trim();
    const pagePath = String(body.pagePath ?? "").trim();
    const notebookPath = String(body.notebookPath ?? "").trim();

    if (absolutePath) {
      const portable = findPortableNotebookContainingPath(absolutePath);
      if (!portable) {
        throw new VaultError(
          "INVALID_PATH",
          "Reveal is limited to paths inside a registered portable-notebook root.",
          400
        );
      }
      const result = revealAbsolutePathInExplorer(absolutePath);
      return NextResponse.json(result);
    }

    if (pagePath) {
      const resolved = resolveVaultPath(pagePath, "page");
      const result = revealAbsolutePathInExplorer(resolved.absolutePath);
      return NextResponse.json({
        path: result.path,
        pagePath: resolved.relativePath,
      });
    }

    if (!notebookPath) {
      throw new VaultError(
        "INVALID_PATH",
        'Body field "notebookPath", "pagePath", or "absolutePath" is required.'
      );
    }

    const result = revealNotebookInExplorer(notebookPath);
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
