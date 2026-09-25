import { NextResponse } from "next/server";

interface PdfRenderDiagnosticEntry {
  ts: number;
  openId: string;
  tag: string;
  fields: Record<string, unknown>;
}

const ring: PdfRenderDiagnosticEntry[] = [];
const MAX_ENTRIES = 400;
const MAX_FIELDS_BYTES = 8_000;

function cleanToken(value: unknown, fallback: string): string {
  const clean = String(value ?? "")
    .replace(/[^a-zA-Z0-9._:-]/g, "-")
    .slice(0, 80);
  return clean || fallback;
}

export async function POST(request: Request): Promise<Response> {
  let body: Partial<PdfRenderDiagnosticEntry>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const fields =
    body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? body.fields
      : {};
  if (JSON.stringify(fields).length > MAX_FIELDS_BYTES) {
    return NextResponse.json({ error: "fields too large" }, { status: 413 });
  }

  const entry: PdfRenderDiagnosticEntry = {
    ts: Number.isFinite(body.ts) ? Number(body.ts) : Date.now(),
    openId: cleanToken(body.openId, "unknown-open"),
    tag: cleanToken(body.tag, "unknown"),
    fields,
  };
  ring.push(entry);
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);

  const elapsed = new Date(entry.ts).toISOString().slice(11, 23);
  console.log(
    `[pdf-render-diag] ${elapsed} ${entry.openId} ${entry.tag}`,
    JSON.stringify(entry.fields)
  );

  return NextResponse.json({ ok: true });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const openId = url.searchParams.get("openId");
  const entries = openId ? ring.filter((entry) => entry.openId === openId) : ring;
  return NextResponse.json({ entries, total: ring.length });
}

