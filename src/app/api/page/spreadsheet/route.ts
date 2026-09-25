import { NextResponse } from "next/server";
import { readPage } from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { readSpreadsheetWorkbook, writeSpreadsheetWorkbook } from "@/server/vault/spreadsheet";
import { snapshotSpreadsheetContent } from "@/server/vault/versions";

export const dynamic = "force-dynamic";

function requirePath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new VaultError("INVALID_PATH", 'Spreadsheet page "path" is required.');
  }
  return value;
}

async function requireSpreadsheetPage(pagePath: string) {
  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "spreadsheet") {
    throw new VaultError("UNSUPPORTED_NOTE_TYPE", "This page is not a Spreadsheet page.", 400);
  }
  return page;
}

export async function GET(request: Request) {
  try {
    const pagePath = requirePath(new URL(request.url).searchParams.get("path"));
    await requireSpreadsheetPage(pagePath);
    return NextResponse.json({ workbook: await readSpreadsheetWorkbook(pagePath) });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { path?: unknown; workbook?: unknown };
    const pagePath = requirePath(body.path);
    await requireSpreadsheetPage(pagePath);
    await snapshotSpreadsheetContent(pagePath);
    const workbook = await writeSpreadsheetWorkbook(pagePath, body.workbook);
    return NextResponse.json({ workbook });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
