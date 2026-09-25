import {
  coerceRowValues,
  LOG_FIELD_TYPES,
  missingRequiredFields,
  normalizeFields,
  type LogDocument,
  type LogField,
  type LogValue,
} from "@/lib/log-contract";

export const APP_MANIFEST_VERSION = 1 as const;
export const APP_RPC_OPERATIONS = ["query", "add", "update", "delete", "upsert"] as const;
export type AppRpcOperation = (typeof APP_RPC_OPERATIONS)[number];

export interface AppOwnedTableAttachment {
  id: string;
  name: string;
  kind: "app";
  schema: { fields: LogField[] };
}

export interface AppLogTableAttachment {
  id: string;
  name: string;
  kind: "log";
  /** Vault-relative Log page id. Never exposed as an absolute filesystem path. */
  pagePath: string;
}

export type AppTableAttachment = AppOwnedTableAttachment | AppLogTableAttachment;

export interface AppManifest {
  version: typeof APP_MANIFEST_VERSION;
  enabled: boolean;
  template?: { id: string; version: number };
  tables: AppTableAttachment[];
}

export interface AppTableSnapshot extends LogDocument {
  id: string;
  name: string;
  kind: AppTableAttachment["kind"];
}

const SAFE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const SAFE_FIELD_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SAFE_UPSERT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const MAX_RPC_JSON_BYTES = 256 * 1024;

export function assertAppTableId(value: unknown, field = "tableId"): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${field} must start with a letter and contain only lowercase letters, numbers, underscores, or hyphens.`);
  }
  return value;
}

export function assertAppFieldId(value: unknown, field = "fieldId"): string {
  if (typeof value !== "string" || !SAFE_FIELD_ID.test(value)) {
    throw new Error(field + " must start with a letter and contain only letters, numbers, underscores, or hyphens.");
  }
  return value;
}

function requiredLabel(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new Error(`${field} must be a non-empty string up to 120 characters.`);
  }
  return value.trim();
}

function normalizeOwnedFields(value: unknown): LogField[] {
  if (!Array.isArray(value)) throw new Error("App table schema.fields must be an array.");
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`App table schema.fields[${index}] must be an object.`);
    }
    const rawField = entry as Record<string, unknown>;
    rejectUnknownKeys(rawField, ["id", "name", "type", "required", "options"], `schema.fields[${index}]`);
    assertAppFieldId(rawField.id, `schema.fields[${index}].id`);
    requiredLabel(rawField.name, `schema.fields[${index}].name`);
    const suppliedType = rawField.type;
    if (typeof suppliedType !== "string" || !LOG_FIELD_TYPES.includes(suppliedType as LogField["type"])) {
      throw new Error(`Unsupported field type at schema.fields[${index}]: ${String(suppliedType)}`);
    }
    if (rawField.required !== undefined && typeof rawField.required !== "boolean") {
      throw new Error(`schema.fields[${index}].required must be boolean.`);
    }
    if (rawField.options !== undefined) {
      if (suppliedType !== "select" || !Array.isArray(rawField.options) || rawField.options.length === 0) {
        throw new Error(`schema.fields[${index}].options is allowed only as a non-empty array for select fields.`);
      }
      const seenOptions = new Set<string>();
      for (const [optionIndex, option] of rawField.options.entries()) {
        const canonical = requiredLabel(option, `schema.fields[${index}].options[${optionIndex}]`);
        if (canonical !== option) throw new Error(`schema.fields[${index}].options[${optionIndex}] must be trimmed.`);
        if (seenOptions.has(canonical)) throw new Error(`schema.fields[${index}] contains duplicate options.`);
        seenOptions.add(canonical);
      }
    }
  });
  const fields = normalizeFields(value);
  if (fields.length === 0) throw new Error("An app-owned table requires at least one field.");
  const ids = new Set<string>();
  for (const field of fields) {
    if (!LOG_FIELD_TYPES.includes(field.type)) throw new Error(`Unsupported field type: ${field.type}`);
    if (ids.has(field.id)) throw new Error(`Duplicate app table field id: ${field.id}`);
    ids.add(field.id);
  }
  return fields;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) throw new Error(`${path} contains unknown keys: ${unknown.join(", ")}.`);
}

export function normalizeAppManifest(value: unknown): AppManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("App manifest must be an object.");
  }
  const raw = value as Record<string, unknown>;
  rejectUnknownKeys(raw, ["version", "enabled", "template", "tables"], "App manifest");
  if (raw.version !== APP_MANIFEST_VERSION) {
    throw new Error(`App manifest version must be ${APP_MANIFEST_VERSION}.`);
  }
  if (typeof raw.enabled !== "boolean") throw new Error("App manifest enabled must be boolean.");
  if (!Array.isArray(raw.tables)) throw new Error("App manifest tables must be an array.");
  const seen = new Set<string>();
  const tables = raw.tables.map((entry, index): AppTableAttachment => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`tables[${index}] must be an object.`);
    }
    const table = entry as Record<string, unknown>;
    const id = assertAppTableId(table.id, `tables[${index}].id`);
    if (seen.has(id)) throw new Error(`Duplicate app table id: ${id}`);
    seen.add(id);
    const name = requiredLabel(table.name, `tables[${index}].name`);
    if (table.kind === "app") {
      rejectUnknownKeys(table, ["id", "name", "kind", "schema"], `tables[${index}]`);
      const schema = table.schema as { fields?: unknown } | undefined;
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        throw new Error(`tables[${index}].schema must be an object.`);
      }
      rejectUnknownKeys(schema as Record<string, unknown>, ["fields"], `tables[${index}].schema`);
      return { id, name, kind: "app", schema: { fields: normalizeOwnedFields(schema?.fields) } };
    }
    if (table.kind === "log") {
      rejectUnknownKeys(table, ["id", "name", "kind", "pagePath"], `tables[${index}]`);
      if (typeof table.pagePath !== "string" || !table.pagePath.trim() || !/\.html$/i.test(table.pagePath)) {
        throw new Error(`tables[${index}].pagePath must be a vault-relative Log page path.`);
      }
      return { id, name, kind: "log", pagePath: table.pagePath.replace(/\\/g, "/") };
    }
    throw new Error(`tables[${index}].kind must be "app" or "log".`);
  });
  let template: AppManifest["template"];
  if (raw.template !== undefined) {
    const candidate = raw.template as Record<string, unknown>;
    if (!candidate || typeof candidate !== "object") throw new Error("template must be an object.");
    rejectUnknownKeys(candidate, ["id", "version"], "template");
    const id = assertAppTableId(candidate.id, "template.id");
    if (!Number.isInteger(candidate.version) || Number(candidate.version) < 1) {
      throw new Error("template.version must be a positive integer.");
    }
    template = { id, version: Number(candidate.version) };
  }
  return { version: APP_MANIFEST_VERSION, enabled: raw.enabled, ...(template ? { template } : {}), tables };
}

export function defaultAppManifest(): AppManifest {
  return { version: APP_MANIFEST_VERSION, enabled: true, tables: [] };
}

function assertJsonNode(value: unknown, path: string, depth: number): void {
  if (depth > 20) throw new Error(`${path} exceeds the maximum nesting depth.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite numbers.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonNode(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error(`${path} contains a forbidden key.`);
      }
      assertJsonNode(entry, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw new Error(`${path} contains a non-JSON value.`);
}

export function validateAppRpcValues(value: unknown): Record<string, LogValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("values must be a JSON object.");
  }
  assertJsonNode(value, "values", 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_RPC_JSON_BYTES) {
    throw new Error(`values exceeds ${MAX_RPC_JSON_BYTES} bytes.`);
  }
  return value as Record<string, LogValue>;
}

export function isAppRpcOperation(value: unknown): value is AppRpcOperation {
  return typeof value === "string" && APP_RPC_OPERATIONS.includes(value as AppRpcOperation);
}

export function appUpsertRowId(upsertKey: unknown): string {
  if (typeof upsertKey !== "string" || !SAFE_UPSERT_KEY.test(upsertKey)) {
    throw new Error("Invalid durable App upsert key.");
  }
  return `r_u_${upsertKey}`;
}

/** Shared browser/server preflight for host-owned durable App acceptance. */
export function validateAppTableAcceptance(
  table: Pick<AppTableSnapshot, "kind" | "schema"> | undefined,
  value: unknown
): Record<string, LogValue> {
  if (!table) throw new Error("App table is not declared.");
  if (table.kind !== "app") throw new Error("Durable acceptance requires an app-owned table.");
  const values = validateAppRpcValues(value);
  const allowed = new Set(table.schema.fields.map((field) => field.id));
  const unknown = Object.keys(values).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown fields: ${unknown.join(", ")}`);
  for (const field of table.schema.fields) {
    if (field.type !== "select" || !Object.prototype.hasOwnProperty.call(values, field.id)) continue;
    const selected = values[field.id];
    if (selected === null || selected === undefined || selected === "") continue;
    if (typeof selected !== "string" || !field.options?.includes(selected)) throw new Error(`Invalid option for ${field.name}.`);
  }
  const coerced = coerceRowValues(table.schema.fields, values);
  const missing = missingRequiredFields(table.schema.fields, coerced);
  if (missing.length) throw new Error(`Missing required fields: ${missing.map((field) => field.name).join(", ")}`);
  return coerced;
}
