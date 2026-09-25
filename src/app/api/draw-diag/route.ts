import { NextResponse } from "next/server";

// In-memory ring — last 300 entries; cleared on server restart
const ring: Array<{ ts: number; tag: string; fields: Record<string, unknown> }> = [];
const MAX = 300;

export async function POST(req: Request): Promise<Response> {
  let body: { ts?: number; tag?: string; fields?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const entry = {
    ts: body.ts ?? Date.now(),
    tag: body.tag ?? "unknown",
    fields: body.fields ?? {},
  };

  ring.push(entry);
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);

  // Emit to server stdout so runtime-stdout diag stream captures it
  const elapsed = new Date(entry.ts).toISOString().slice(11, 23);
  console.log(`[draw-diag] ${elapsed} ${entry.tag}`, JSON.stringify(entry.fields));

  return NextResponse.json({ ok: true });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? 0);
  const items = since > 0 ? ring.filter((e) => e.ts > since) : ring;
  return NextResponse.json({ entries: items, total: ring.length });
}
