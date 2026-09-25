import { NextResponse } from "next/server";
import { searchVault } from "@/server/vault/search";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseLimit(value: string | null) {
  if (!value) {
    return 20;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new VaultError("INVALID_INPUT", 'Query parameter "limit" must be a positive integer.');
  }

  return Math.min(parsed, 50);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const limit = parseLimit(url.searchParams.get("limit"));
    const results = await searchVault(query, limit);
    return NextResponse.json({ results });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
