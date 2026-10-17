import { NextResponse } from "next/server";
import { reconstructMarkedText, type RectGeometry } from "@/lib/pdf-annotations";
import { extractPdfPageTextItems } from "@/server/vault/pdf-text-geometry";
import { resolveVaultPath } from "@/server/vault/paths";
import { VaultError, toErrorResponse } from "@/server/vault/errors";

export async function POST(request: Request) {
  try {
    const input = await request.json() as { pdfPath?: unknown; page?: unknown; segmentRects?: unknown };
    if (typeof input.pdfPath !== "string" || !input.pdfPath.toLowerCase().endsWith(".pdf") ||
      !Number.isInteger(input.page) || Number(input.page) < 1 ||
      !Array.isArray(input.segmentRects) || input.segmentRects.length > 200 ||
      input.segmentRects.some((rect: RectGeometry) => !rect?.origin || !rect?.size || ![rect.origin.x, rect.origin.y, rect.size.width, rect.size.height].every(Number.isFinite))) {
      throw new VaultError("INVALID_HIGHLIGHT", "Invalid PDF highlight geometry.", 400);
    }
    const pdf = resolveVaultPath(input.pdfPath, "section");
    const items = await extractPdfPageTextItems(pdf.absolutePath, Number(input.page));
    const found = items && reconstructMarkedText(input.segmentRects, items, { maxChars: 100000 });
    return NextResponse.json({ quote: found && !found.truncated ? found.text : null, recovered: Boolean(found && !found.truncated) });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
