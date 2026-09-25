import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  APP_MANIFEST_VERSION,
  appUpsertRowId,
  assertAppTableId,
  defaultAppManifest,
  isAppRpcOperation,
  normalizeAppManifest,
  validateAppRpcValues,
  type AppManifest,
  type AppRpcOperation,
  type AppTableAttachment,
  type AppTableSnapshot,
} from "@/lib/app-contract";
import {
  coerceRowValues,
  makeLogId,
  missingRequiredFields,
  normalizeLogDocument,
  type LogDocument,
  type LogRow,
  type LogValue,
} from "@/lib/log-contract";
import { VaultError } from "./errors";
import {
  appendLogRow,
  deleteLogRow,
  readLogDocument,
  readPage,
  updateLogRow,
} from "./pages";
import { resolveVaultPath } from "./paths";

const APP_SESSION_TTL_MS = 30 * 60 * 1000;
const APP_QUERY_MAX_ROWS = 200;
const APP_RPC_MAX_RESPONSE_BYTES = 1024 * 1024;

interface AppSession {
  pagePath: string;
  expiresAt: number;
}

interface AppRuntimeRegistry {
  sessions: Map<string, AppSession>;
  tableMutationQueues: Map<string, Promise<void>>;
}

// Next may compile the bootstrap and RPC route handlers into separate module
// bundles. Keep their process-local capability registry shared without ever
// serializing session tokens to disk or exposing them to companion source.
const appRuntimeGlobal = globalThis as typeof globalThis & {
  __smartNotesAppRuntime?: AppRuntimeRegistry;
};
const appRuntimeRegistry = appRuntimeGlobal.__smartNotesAppRuntime ??= {
  sessions: new Map<string, AppSession>(),
  tableMutationQueues: new Map<string, Promise<void>>(),
};
const appSessions = appRuntimeRegistry.sessions;
const tableMutationQueues = appRuntimeRegistry.tableMutationQueues;

function appSidecarAbsolutePath(pagePath: string): string {
  return resolveVaultPath(pagePath, "page").absolutePath.replace(/\.html$/i, ".app.json");
}

function ownedTableAbsolutePath(pagePath: string, tableId: string): string {
  const id = assertAppTableId(tableId);
  return resolveVaultPath(pagePath, "page").absolutePath.replace(/\.html$/i, `.app-data.${id}.json`);
}

async function writeAtomically(targetPath: string, content: string): Promise<void> {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );
  await fs.writeFile(tempPath, content, "utf8");
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rename(tempPath, targetPath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code === "EPERM" || code === "EXDEV") && attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
          continue;
        }
        if (code === "EPERM" || code === "EXDEV") {
          await fs.copyFile(tempPath, targetPath);
          await fs.rm(tempPath, { force: true });
          return;
        }
        throw error;
      }
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function assertAppPage(pagePath: string) {
  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "app") {
    throw new VaultError("INVALID_APP", `Page is not an App page: ${page.path}`, 400);
  }
  return page;
}

export async function readAppManifest(pagePath: string): Promise<AppManifest> {
  await assertAppPage(pagePath);
  try {
    const raw = await fs.readFile(appSidecarAbsolutePath(pagePath), "utf8");
    return normalizeAppManifest(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return defaultAppManifest();
    if (error instanceof VaultError) throw error;
    throw new VaultError(
      "INVALID_APP_MANIFEST",
      error instanceof Error ? error.message : "App manifest is invalid.",
      400
    );
  }
}

export async function saveAppManifest(pagePath: string, value: unknown): Promise<AppManifest> {
  await assertAppPage(pagePath);
  let manifest: AppManifest;
  try {
    manifest = normalizeAppManifest(value);
  } catch (error) {
    throw new VaultError(
      "INVALID_APP_MANIFEST",
      error instanceof Error ? error.message : "App manifest is invalid.",
      400
    );
  }
  for (const attachment of manifest.tables) {
    if (attachment.kind !== "log") continue;
    const target = await readPage(attachment.pagePath);
    if (target.metadata.note_type !== "log") {
      throw new VaultError(
        "INVALID_APP_ATTACHMENT",
        `Attached path is not a Log page: ${attachment.pagePath}`,
        400
      );
    }
  }
  await writeAtomically(appSidecarAbsolutePath(pagePath), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function withTableMutationLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = tableMutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => gate);
  tableMutationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (tableMutationQueues.get(key) === queued) tableMutationQueues.delete(key);
  }
}

async function readOwnedDocument(pagePath: string, attachment: Extract<AppTableAttachment, { kind: "app" }>): Promise<LogDocument> {
  try {
    const raw = await fs.readFile(ownedTableAbsolutePath(pagePath, attachment.id), "utf8");
    const current = normalizeLogDocument(JSON.parse(raw) as unknown);
    return normalizeLogDocument({
      version: 1,
      schema: attachment.schema,
      rows: current.rows.map((row) => ({
        ...row,
        values: coerceRowValues(attachment.schema.fields, row.values),
      })),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { version: 1, schema: attachment.schema, rows: [] };
    }
    if (error instanceof SyntaxError) {
      throw new VaultError("INVALID_APP_DATA", `Table data is invalid JSON: ${attachment.id}`, 400);
    }
    throw error;
  }
}

async function writeOwnedDocument(
  pagePath: string,
  attachment: Extract<AppTableAttachment, { kind: "app" }>,
  document: LogDocument
): Promise<LogDocument> {
  const normalized = normalizeLogDocument({ ...document, schema: attachment.schema });
  await writeAtomically(
    ownedTableAbsolutePath(pagePath, attachment.id),
    `${JSON.stringify(normalized, null, 2)}\n`
  );
  return normalized;
}

async function resolveAttachment(pagePath: string, tableId: unknown): Promise<AppTableAttachment> {
  let id: string;
  try {
    id = assertAppTableId(tableId);
  } catch (error) {
    throw new VaultError("INVALID_APP_TABLE", (error as Error).message, 400);
  }
  const manifest = await readAppManifest(pagePath);
  const attachment = manifest.tables.find((table) => table.id === id);
  if (!attachment) {
    throw new VaultError("APP_TABLE_NOT_ATTACHED", `Table is not attached to this app: ${id}`, 403);
  }
  if (attachment.kind === "log") {
    const target = await readPage(attachment.pagePath);
    if (target.metadata.note_type !== "log") {
      throw new VaultError("INVALID_APP_ATTACHMENT", `Attached page is no longer a Log page: ${id}`, 400);
    }
  }
  return attachment;
}

async function readAttachmentDocument(pagePath: string, attachment: AppTableAttachment): Promise<LogDocument> {
  return attachment.kind === "log"
    ? readLogDocument(attachment.pagePath)
    : readOwnedDocument(pagePath, attachment);
}

function validateRequired(document: LogDocument, values: Record<string, unknown>): Record<string, LogValue> {
  const allowed = new Set(document.schema.fields.map((field) => field.id));
  const unknown = Object.keys(values).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new VaultError("INVALID_APP_ROW", `Unknown fields: ${unknown.join(", ")}`, 400);
  }
  for (const field of document.schema.fields) {
    if (field.type !== "select" || !Object.prototype.hasOwnProperty.call(values, field.id)) continue;
    const value = values[field.id];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string" || !field.options?.includes(value)) {
      throw new VaultError("INVALID_APP_ROW", `Invalid option for ${field.name}.`, 400);
    }
  }
  const coerced = coerceRowValues(document.schema.fields, values);
  const missing = missingRequiredFields(document.schema.fields, coerced);
  if (missing.length > 0) {
    throw new VaultError(
      "INVALID_APP_ROW",
      `Missing required fields: ${missing.map((field) => field.name).join(", ")}`,
      400
    );
  }
  return coerced;
}

function validatedRpcValues(value: unknown): Record<string, LogValue> {
  try {
    return validateAppRpcValues(value);
  } catch (error) {
    throw new VaultError(
      "INVALID_APP_VALUE",
      error instanceof Error ? error.message : "App values must be valid bounded JSON.",
      400
    );
  }
}

function createSession(pagePath: string, replacementToken?: unknown): { token: string; expiresAt: string } {
  const now = Date.now();
  for (const [token, session] of appSessions) {
    if (session.expiresAt <= now) appSessions.delete(token);
  }
  if (typeof replacementToken === "string") appSessions.delete(replacementToken);
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + APP_SESSION_TTL_MS;
  appSessions.set(token, { pagePath, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

function authenticateSession(pagePath: string, token: unknown): void {
  if (typeof token !== "string") throw new VaultError("APP_RPC_UNAUTHORIZED", "App session is required.", 401);
  const session = appSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) appSessions.delete(token);
    throw new VaultError("APP_RPC_UNAUTHORIZED", "App session expired. Reload the app.", 401);
  }
  if (session.pagePath !== pagePath) {
    appSessions.delete(token);
    throw new VaultError("APP_RPC_UNAUTHORIZED", "App session does not match this page.", 403);
  }
}

export async function readAppDataSnapshot(pagePath: string) {
  const page = await assertAppPage(pagePath);
  const manifest = await readAppManifest(pagePath);
  const tables = await Promise.all(
    manifest.tables.map(async (attachment): Promise<AppTableSnapshot> => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      ...(await readAttachmentDocument(page.path, attachment)),
    }))
  );
  const snapshot = {
    page: { path: page.path, title: page.title, body: page.body },
    manifest,
    tables,
  };
  return {
    ...snapshot,
    revision: `sha256:${crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`,
  };
}

/** Bounded read-only companion access to one manifest-declared table. */
export async function queryAppTableForCompanion(
  pagePath: string,
  tableId: unknown,
  rawQuery: unknown = {}
): Promise<unknown> {
  if (!rawQuery || typeof rawQuery !== "object" || Array.isArray(rawQuery)) {
    throw new VaultError("INVALID_APP_QUERY", "query must be an object.", 400);
  }
  const query = rawQuery as { where?: unknown; limit?: unknown };
  const unsupported = Object.keys(query).filter((key) => key !== "where" && key !== "limit");
  if (unsupported.length) throw new VaultError("INVALID_APP_QUERY", `Unsupported query keys: ${unsupported.join(", ")}`, 400);
  const page = await assertAppPage(pagePath);
  const attachment = await resolveAttachment(page.path, tableId);
  const table = await readAttachmentDocument(page.path, attachment);
  const where = query.where === undefined ? {} : validatedRpcValues(query.where);
  const allowed = new Set(table.schema.fields.map((field) => field.id));
  const unknown = Object.keys(where).filter((key) => !allowed.has(key));
  if (unknown.length) throw new VaultError("INVALID_APP_QUERY", `Unknown query fields: ${unknown.join(", ")}`, 400);
  const limit = query.limit === undefined ? APP_QUERY_MAX_ROWS : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > APP_QUERY_MAX_ROWS) {
    throw new VaultError("INVALID_APP_QUERY", `query.limit must be an integer from 1 to ${APP_QUERY_MAX_ROWS}.`, 400);
  }
  const rows = table.rows
    .filter((row) => Object.entries(where).every(([key, value]) => Object.is(row.values[key], value)))
    .slice(0, limit);
  const response = { table: { id: attachment.id, name: attachment.name, kind: attachment.kind, schema: table.schema }, rows };
  if (new TextEncoder().encode(JSON.stringify(response)).byteLength > APP_RPC_MAX_RESPONSE_BYTES) {
    throw new VaultError("APP_QUERY_TOO_LARGE", "App query response exceeds 1 MiB. Use a narrower where filter or smaller limit.", 413);
  }
  return response;
}

export async function bootstrapAppRuntime(pagePath: string, replacementToken?: unknown) {
  const snapshot = await readAppDataSnapshot(pagePath);
  const session = createSession(snapshot.page.path, replacementToken);
  return {
    ...snapshot,
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
  };
}

export interface AppRpcInput {
  path: string;
  sessionToken: unknown;
  tableId: unknown;
  operation: unknown;
  rowId?: unknown;
  values?: unknown;
  query?: unknown;
  clientMutationId?: unknown;
  acceptedAt?: unknown;
  upsertKey?: unknown;
}

async function executeAppRpcUnlocked(input: AppRpcInput, ownerDataAccess = false): Promise<unknown> {
  authenticateSession(input.path, input.sessionToken);
  const appManifest = await readAppManifest(input.path);
  if (!ownerDataAccess && !appManifest.enabled) {
    throw new VaultError("APP_DISABLED", "This App is disabled. Enable it before accessing attached data.", 423);
  }
  if (!isAppRpcOperation(input.operation)) {
    throw new VaultError("INVALID_APP_OPERATION", "operation must be query, add, update, delete, or upsert.", 400);
  }
  const operation: AppRpcOperation = input.operation;
  const attachment = await resolveAttachment(input.path, input.tableId);
  const current = await readAttachmentDocument(input.path, attachment);

  if (operation === "query") {
    const rawQuery = input.query ?? {};
    if (!rawQuery || typeof rawQuery !== "object" || Array.isArray(rawQuery)) {
      throw new VaultError("INVALID_APP_QUERY", "query must be an object.", 400);
    }
    const query = rawQuery as { where?: unknown; limit?: unknown };
    const unsupportedQueryKeys = Object.keys(query).filter((key) => key !== "where" && key !== "limit");
    if (unsupportedQueryKeys.length > 0) {
      throw new VaultError("INVALID_APP_QUERY", `Unsupported query keys: ${unsupportedQueryKeys.join(", ")}`, 400);
    }
    const where = query.where === undefined ? {} : validatedRpcValues(query.where);
    const allowedFields = new Set(current.schema.fields.map((field) => field.id));
    const unknownWhereFields = Object.keys(where).filter((key) => !allowedFields.has(key));
    if (unknownWhereFields.length > 0) {
      throw new VaultError("INVALID_APP_QUERY", `Unknown query fields: ${unknownWhereFields.join(", ")}`, 400);
    }
    const limit = query.limit === undefined ? APP_QUERY_MAX_ROWS : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > APP_QUERY_MAX_ROWS) {
      throw new VaultError("INVALID_APP_QUERY", `query.limit must be an integer from 1 to ${APP_QUERY_MAX_ROWS}.`, 400);
    }
    const rows = current.rows.filter((row) =>
      Object.entries(where).every(([key, value]) => Object.is(row.values[key], value))
    ).slice(0, limit);
    const response = { table: { id: attachment.id, name: attachment.name, kind: attachment.kind, schema: current.schema }, rows };
    if (new TextEncoder().encode(JSON.stringify(response)).byteLength > APP_RPC_MAX_RESPONSE_BYTES) {
      throw new VaultError(
        "APP_QUERY_TOO_LARGE",
        "App query response exceeds 1 MiB. Use a narrower where filter or smaller limit.",
        413
      );
    }
    return response;
  }

  if (operation === "add") {
    const rawValues = validatedRpcValues(input.values);
    const values = validateRequired(current, rawValues);
    if (input.clientMutationId !== undefined && attachment.kind === "log") {
      throw new VaultError("APP_DURABLE_ACCEPT_UNSUPPORTED", "Durable acceptance requires an app-owned table.", 400);
    }
    if (attachment.kind === "log") {
      const result = await appendLogRow(attachment.pagePath, values);
      return { row: result.row, rowCount: result.document.rows.length };
    }
    return withTableMutationLock(ownedTableAbsolutePath(input.path, attachment.id), async () => {
      const latest = await readOwnedDocument(input.path, attachment);
      const now = new Date().toISOString();
      let rowId = makeLogId("r");
      if (input.clientMutationId !== undefined) {
        if (typeof input.clientMutationId !== "string" || !/^m_[A-Za-z0-9_-]{8,100}$/.test(input.clientMutationId)) {
          throw new VaultError("INVALID_APP_MUTATION", "A valid clientMutationId is required.", 400);
        }
        if (typeof input.acceptedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.acceptedAt) || Number.isNaN(Date.parse(input.acceptedAt))) {
          throw new VaultError("INVALID_APP_MUTATION", "A valid acceptedAt timestamp is required.", 400);
        }
        rowId = `r_${crypto.createHash("sha256").update(`${input.path}\0${attachment.id}\0${input.clientMutationId}`).digest("base64url").slice(0, 24)}`;
        const existing = latest.rows.find((row) => row.id === rowId);
        const incomingValues = validateRequired(latest, rawValues);
        if (existing) {
          if (existing.createdAt !== input.acceptedAt || !isDeepStrictEqual(existing.values, incomingValues)) {
            throw new VaultError("APP_MUTATION_CONFLICT", "Mutation id is already bound to a different accepted entry.", 409);
          }
          return { row: existing, rowCount: latest.rows.length, replayed: true };
        }
        const row: LogRow = { id: rowId, createdAt: input.acceptedAt, values: incomingValues };
        const document = await writeOwnedDocument(input.path, attachment, { ...latest, rows: [...latest.rows, row] });
        return { row, rowCount: document.rows.length };
      }
      if (input.acceptedAt !== undefined) throw new VaultError("INVALID_APP_MUTATION", "acceptedAt requires clientMutationId.", 400);
      const row: LogRow = { id: rowId, createdAt: now, values: validateRequired(latest, rawValues) };
      const document = await writeOwnedDocument(input.path, attachment, { ...latest, rows: [...latest.rows, row] });
      return { row, rowCount: document.rows.length };
    });
  }

  if (operation === "upsert") {
    if (attachment.kind === "log") {
      throw new VaultError("APP_DURABLE_UPSERT_UNSUPPORTED", "Durable upsert requires an app-owned table.", 400);
    }
    if (typeof input.clientMutationId !== "string" || !/^m_[A-Za-z0-9_-]{8,100}$/.test(input.clientMutationId)) {
      throw new VaultError("INVALID_APP_MUTATION", "A valid clientMutationId is required.", 400);
    }
    if (typeof input.acceptedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.acceptedAt) || Number.isNaN(Date.parse(input.acceptedAt))) {
      throw new VaultError("INVALID_APP_MUTATION", "A valid acceptedAt timestamp is required.", 400);
    }
    let rowId: string;
    try { rowId = appUpsertRowId(input.upsertKey); }
    catch { throw new VaultError("INVALID_APP_MUTATION", "A valid upsertKey is required.", 400); }
    const rawValues = validatedRpcValues(input.values);
    return withTableMutationLock(ownedTableAbsolutePath(input.path, attachment.id), async () => {
      const latest = await readOwnedDocument(input.path, attachment);
      const values = validateRequired(latest, rawValues);
      const index = latest.rows.findIndex((row) => row.id === rowId);
      if (index === -1) {
        const row: LogRow = { id: rowId, createdAt: input.acceptedAt as string, updatedAt: input.acceptedAt as string, values };
        const document = await writeOwnedDocument(input.path, attachment, { ...latest, rows: [...latest.rows, row] });
        return { row, rowCount: document.rows.length };
      }
      const existing = latest.rows[index];
      const existingTime = Date.parse(existing.updatedAt ?? existing.createdAt);
      const incomingTime = Date.parse(input.acceptedAt as string);
      if (existingTime > incomingTime) {
        throw new VaultError("APP_MUTATION_CONFLICT", "A newer keyed App value already exists; the pending local value was not discarded.", 409);
      }
      if (existingTime === incomingTime) {
        if (!isDeepStrictEqual(existing.values, values)) {
          throw new VaultError("APP_MUTATION_CONFLICT", "Durable upsert timestamp is already bound to different data.", 409);
        }
        return { row: existing, rowCount: latest.rows.length, replayed: true };
      }
      const rows = [...latest.rows];
      rows[index] = { ...existing, updatedAt: input.acceptedAt as string, values };
      const document = await writeOwnedDocument(input.path, attachment, { ...latest, rows });
      return { row: document.rows[index], rowCount: document.rows.length };
    });
  }

  if (typeof input.rowId !== "string" || !/^r_[A-Za-z0-9_-]{6,80}$/.test(input.rowId)) {
    throw new VaultError("INVALID_APP_ROW", "A valid rowId is required.", 400);
  }
  if (operation === "update") {
    const rawValues = validatedRpcValues(input.values);
    const values = validateRequired(current, rawValues);
    if (attachment.kind === "log") {
      const result = await updateLogRow(attachment.pagePath, input.rowId, values);
      return { row: result.row, rowCount: result.document.rows.length };
    }
    return withTableMutationLock(ownedTableAbsolutePath(input.path, attachment.id), async () => {
      const latest = await readOwnedDocument(input.path, attachment);
      const index = latest.rows.findIndex((row) => row.id === input.rowId);
      if (index === -1) throw new VaultError("APP_ROW_NOT_FOUND", `Row not found: ${input.rowId}`, 404);
      const rows = [...latest.rows];
      rows[index] = {
        ...rows[index],
        values: validateRequired(latest, rawValues),
        updatedAt: new Date().toISOString(),
      };
      const document = await writeOwnedDocument(input.path, attachment, { ...latest, rows });
      return { row: document.rows[index], rowCount: document.rows.length };
    });
  }

  if (attachment.kind === "log") {
    const document = await deleteLogRow(attachment.pagePath, input.rowId);
    return { rowCount: document.rows.length };
  }
  return withTableMutationLock(ownedTableAbsolutePath(input.path, attachment.id), async () => {
    const latest = await readOwnedDocument(input.path, attachment);
    const index = latest.rows.findIndex((row) => row.id === input.rowId);
    if (index === -1) throw new VaultError("APP_ROW_NOT_FOUND", `Row not found: ${input.rowId}`, 404);
    const document = await writeOwnedDocument(input.path, attachment, {
      ...latest,
      rows: latest.rows.filter((row) => row.id !== input.rowId),
    });
    return { rowCount: document.rows.length };
  });
}

export async function executeAppRpc(input: AppRpcInput): Promise<unknown> {
  // Serialize the enabled-state check with all page RPC so Disable has a clear
  // boundary: work admitted before Disable completes may finish; replayed or
  // queued work is denied after sessions are revoked.
  return withTableMutationLock(`app-runtime:${input.path}`, () => executeAppRpcUnlocked(input));
}

export async function executeOwnerAppDataMutation(input: AppRpcInput): Promise<unknown> {
  if (!isAppRpcOperation(input.operation) || input.operation === "query" || input.operation === "upsert") {
    throw new VaultError("INVALID_APP_OPERATION", "Owner Data accepts add, update, or delete.", 400);
  }
  return withTableMutationLock(`app-runtime:${input.path}`, () => executeAppRpcUnlocked(input, true));
}

export async function setAppEnabled(pagePath: string, enabled: boolean): Promise<AppManifest> {
  return withTableMutationLock(`app-runtime:${pagePath}`, async () => {
    const page = await assertAppPage(pagePath);
    const manifest = await readAppManifest(page.path);
    const saved = await saveAppManifest(page.path, { ...manifest, enabled });
    if (!enabled) {
      for (const [token, session] of appSessions) {
        if (session.pagePath === page.path) appSessions.delete(token);
      }
    }
    return saved;
  });
}

export async function seedOwnedAppTable(
  pagePath: string,
  tableId: string,
  rows: Array<Record<string, unknown>>
): Promise<LogDocument> {
  const attachment = await resolveAttachment(pagePath, tableId);
  if (attachment.kind !== "app") throw new VaultError("INVALID_APP_TABLE", "Only app-owned tables can be seeded.", 400);
  return withTableMutationLock(ownedTableAbsolutePath(pagePath, attachment.id), async () => {
    const current = await readOwnedDocument(pagePath, attachment);
    const now = new Date().toISOString();
    const nextRows = rows.map((values) => ({
      id: makeLogId("r"),
      createdAt: now,
      values: validateRequired(current, values),
    }));
    return writeOwnedDocument(pagePath, attachment, { ...current, rows: nextRows });
  });
}

export function resetAppSessionsForTesting(): void {
  appSessions.clear();
  tableMutationQueues.clear();
}

export { APP_MANIFEST_VERSION };
