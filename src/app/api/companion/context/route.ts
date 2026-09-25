import { NextResponse } from "next/server";
import { buildCompanionPageContext } from "@/server/vault/companion-context";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      path?: string;
      basePageContext?: string;
      /** Character offset into the extracted PDF text for chunked reading. */
      pdfChunkOffset?: number;
      /** Maximum PDF characters to include (overrides the server default). */
      pdfMaxChars?: number;
      /** Active immersive-reader attachment href. */
      activePdfHref?: string;
      /** Display name reported by the immersive reader. */
      activePdfFileName?: string;
      /** Current 1-based page reported by the reader. */
      pdfPage?: number;
      /** Page count reported by the loaded reader document. */
      pdfPageCount?: number;
      /** Zero-based active cell in the canonical notebook.ipynb. */
      activeJupyterCellIndex?: number;
      /** Stable nbformat id for the active cell. */
      activeJupyterCellId?: string;
    };
    if (!body.path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" is required.');
    }

    return NextResponse.json(
      await buildCompanionPageContext({
        path: body.path,
        basePageContext: typeof body.basePageContext === "string" ? body.basePageContext : "",
        pdfChunkOffset: typeof body.pdfChunkOffset === "number" ? body.pdfChunkOffset : undefined,
        pdfMaxChars: typeof body.pdfMaxChars === "number" ? body.pdfMaxChars : undefined,
        activePdfHref: typeof body.activePdfHref === "string" ? body.activePdfHref : undefined,
        activePdfFileName: typeof body.activePdfFileName === "string" ? body.activePdfFileName : undefined,
        pdfPage: typeof body.pdfPage === "number" ? body.pdfPage : undefined,
        pdfPageCount: typeof body.pdfPageCount === "number" ? body.pdfPageCount : undefined,
        activeJupyterCellIndex:
          Number.isInteger(body.activeJupyterCellIndex) && (body.activeJupyterCellIndex ?? -1) >= 0
            ? body.activeJupyterCellIndex
            : undefined,
        activeJupyterCellId:
          typeof body.activeJupyterCellId === "string" && body.activeJupyterCellId.trim()
            ? body.activeJupyterCellId.trim()
            : undefined,
      })
    );
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
