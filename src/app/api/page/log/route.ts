import { NextResponse } from "next/server";
import {
  appendLogRow,
  deleteLogRow,
  readLogDocument,
  readLogFormDefinition,
  saveLogFormDefinition,
  saveLogSchema,
  updateLogRow,
} from "@/server/vault/pages";
import { toErrorResponse, VaultError } from "@/server/vault/errors";
import { emitVaultSideEffects } from "@/server/vault/socket-events";

function requiredPath(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new VaultError("INVALID_PATH", "A log page \"path\" is required.");
  }
  return value;
}

function optionalLocalRowId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^r_[A-Za-z0-9_-]{6,80}$/.test(value)) {
    throw new VaultError("INVALID_ROW", "The submitted \"rowId\" is invalid.");
  }
  return value;
}

function optionalCreatedAt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new VaultError("INVALID_ROW", "The submitted \"createdAt\" is invalid.");
  }
  return value;
}

/** Notify open clients that a log page's sidecar changed on disk. */
function emitLogUpdated(path: string, kind?: "log_form") {
  // Reuse the file-update side channel so other devices refetch the page's data.
  emitVaultSideEffects({ fileUpdated: { path, content: "", kind } });
}

/** GET ?path= — read schema, rows, and the JSON Forms script. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const path = requiredPath(url.searchParams.get("path"));
    const [document, form] = await Promise.all([
      readLogDocument(path),
      readLogFormDefinition(path),
    ]);
    return NextResponse.json({ path, form, ...document });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/**
 * PUT — replace the form script (`form`) or the flat field list (`fields`).
 * Prefer `form` (Source tab). `fields` remains for compatibility and regenerates
 * the form script from the flat schema.
 */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      path?: string;
      form?: unknown;
      fields?: unknown;
    };
    const path = requiredPath(body.path);
    if (body.form !== undefined) {
      const { document, form } = await saveLogFormDefinition(path, body.form);
      emitLogUpdated(path, "log_form");
      return NextResponse.json({ path, form, ...document });
    }
    const document = await saveLogSchema(path, body.fields);
    const form = await readLogFormDefinition(path);
    emitLogUpdated(path, "log_form");
    return NextResponse.json({ path, form, ...document });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** POST — append a row (Form submit). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      path?: string;
      values?: Record<string, unknown>;
      rowId?: unknown;
      createdAt?: unknown;
    };
    const path = requiredPath(body.path);
    const { document, row, created } = await appendLogRow(path, body.values ?? {}, {
      rowId: optionalLocalRowId(body.rowId),
      createdAt: optionalCreatedAt(body.createdAt),
    });
    const form = await readLogFormDefinition(path);
    if (created) emitLogUpdated(path);
    return NextResponse.json({ path, form, row, created, ...document }, { status: created ? 201 : 200 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** PATCH — update an existing row (Table correction). */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      path?: string;
      rowId?: string;
      values?: Record<string, unknown>;
    };
    const path = requiredPath(body.path);
    if (typeof body.rowId !== "string" || !body.rowId) {
      throw new VaultError("INVALID_ROW", "A \"rowId\" is required to update a log row.");
    }
    const { document, row } = await updateLogRow(path, body.rowId, body.values ?? {});
    const form = await readLogFormDefinition(path);
    emitLogUpdated(path);
    return NextResponse.json({ path, form, row, ...document });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** DELETE ?path=&rowId= — remove a row. */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const path = requiredPath(url.searchParams.get("path"));
    const rowId = url.searchParams.get("rowId");
    if (!rowId) {
      throw new VaultError("INVALID_ROW", "A \"rowId\" query parameter is required.");
    }
    const document = await deleteLogRow(path, rowId);
    const form = await readLogFormDefinition(path);
    emitLogUpdated(path);
    return NextResponse.json({ path, form, ...document });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
