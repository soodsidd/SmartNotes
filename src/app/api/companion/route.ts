import { NextResponse } from "next/server";
import {
  deleteCompanionSessions,
  readCompanionSessions,
  saveCompanionSessions,
} from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

function searchParamPath(request: Request) {
  const url = new URL(request.url);
  const pagePath = url.searchParams.get("path");
  if (!pagePath) {
    throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
  }
  return pagePath;
}

export async function GET(request: Request) {
  try {
    const { scopes } = await readCompanionSessions(searchParamPath(request));
    return NextResponse.json({ scopes });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: Request) {
  try {
    const { path, scopes } = (await request.json()) as {
      path?: string;
      scopes?: Record<string, unknown>;
    };
    if (!path) {
      throw new VaultError("INVALID_PATH", 'Body field "path" is required.');
    }
    await saveCompanionSessions(path, scopes ?? {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(request: Request) {
  try {
    await deleteCompanionSessions(searchParamPath(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
