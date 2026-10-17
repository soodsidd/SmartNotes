import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { appendPdfRecord, undoPdfRecord } from "@/server/vault/pages";
import { resolveVaultPath } from "@/server/vault/paths";
import { VaultError, toErrorResponse } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";
import { PDF_CLIP_MAX_BYTES, PDF_CLIP_MAX_SIDE, type PdfRecordInput } from "@/lib/pdf-record";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function validClip(input: Partial<PdfRecordInput>): boolean {
  const clip = input.clip;
  if (clip === undefined) return true;
  return Boolean(clip) && (clip.kind === "area" || clip.kind === "page") &&
    [clip.width, clip.height].every(value => Number.isInteger(value) && value > 0 && value <= PDF_CLIP_MAX_SIDE);
}

/** SN-336 image Records arrive as multipart: a JSON `record` plus a PNG `image`. */
async function readRecordRequest(request: Request): Promise<{ input: Partial<PdfRecordInput>; image?: Buffer }> {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return { input: await request.json() as Partial<PdfRecordInput> };
  }
  const form = await request.formData();
  const record = form.get("record");
  const file = form.get("image");
  if (typeof record !== "string" || !(file instanceof Blob) || file.size > PDF_CLIP_MAX_BYTES) {
    throw new VaultError("INVALID_RECORD", "Invalid PDF image Record upload.", 400);
  }
  const image = Buffer.from(await file.arrayBuffer());
  if (image.length < PNG_SIGNATURE.length || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new VaultError("INVALID_RECORD", "PDF image Record must be a PNG rendered from the PDF.", 400);
  }
  try {
    return { input: JSON.parse(record) as Partial<PdfRecordInput>, image };
  } catch {
    throw new VaultError("INVALID_RECORD", "Invalid PDF image Record upload.", 400);
  }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

function validate(input: Partial<PdfRecordInput>): asserts input is PdfRecordInput {
  if (!validId(input.id) || typeof input.destinationPath !== "string" ||
      typeof input.pdfPath !== "string" || !input.pdfPath.toLowerCase().endsWith(".pdf") ||
      typeof input.pdfTitle !== "string" || !input.pdfTitle.trim() || input.pdfTitle.length > 500 ||
      !Number.isInteger(input.page) || (input.page ?? 0) < 1 ||
      !(input.quote === null || typeof input.quote === "string") ||
      (input.quote === null && input.quoteUnavailable !== true && !input.clip) ||
      !validClip(input) ||
      (input.quote?.length ?? 0) > 100000 ||
      [input.thought, input.question, input.answer].some(value => value !== undefined && (typeof value !== "string" || value.length > 50000)) ||
      (input.answer && !input.question)) {
    throw new VaultError("INVALID_RECORD", "Invalid PDF record source or destination.", 400);
  }
}

function updated(page: { path: string; body: string }) {
  emitVaultSideEffects({ fileUpdated: { path: page.path, content: page.body } });
}

export async function POST(request: Request) {
  try {
    const { input, image } = await readRecordRequest(request);
    validate(input);
    const pdf = resolveVaultPath(input.pdfPath, "section");
    if (pdf.relativePath !== input.pdfPath.replaceAll("\\", "/") || !pdf.relativePath.toLowerCase().endsWith(".pdf")) {
      throw new VaultError("INVALID_PDF", "PDF path is invalid.", 400);
    }
    await fs.access(pdf.absolutePath);
    const { page, created } = await appendPdfRecord(input, image);
    if (created) updated(page);
    return NextResponse.json({ path: page.path, created });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(request: Request) {
  try {
    const input = await request.json() as { id?: unknown; destinationPath?: unknown };
    if (!validId(input.id) || typeof input.destinationPath !== "string") {
      throw new VaultError("INVALID_RECORD", "Invalid Record undo request.", 400);
    }
    const { page, removed } = await undoPdfRecord(input.destinationPath, input.id);
    if (removed) updated(page);
    return NextResponse.json({ path: page.path, removed });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
