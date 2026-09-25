/**
 * Vault-native log page contract (SN-144).
 *
 * A log page is a `note_type: log` vault page whose typed schema and row records
 * live in a `<page-stem>.log.json` sidecar next to the `.html` stub — never in
 * TipTap HTML tables. This module is the single source of truth for the sidecar
 * shape and is safe to import from both the Node server and the browser client.
 */

export type LogFieldType = "text" | "number" | "date" | "boolean" | "select" | "image" | "image-sequence";

export const LOG_FIELD_TYPES: LogFieldType[] = ["text", "number", "date", "boolean", "select", "image", "image-sequence"];

export interface LogField {
  /** Stable identifier used as the key inside a row's `values` map. */
  id: string;
  /** Human label shown in Form inputs and Table headers. */
  name: string;
  type: LogFieldType;
  /** When true, the Form tab blocks submit until this field has a value. */
  required?: boolean;
  /** Allowed values for `select` fields. Ignored for other types. */
  options?: string[];
}

export interface LogSchema {
  fields: LogField[];
}

/** A single persisted record. `values` is keyed by {@link LogField.id}. */
export interface LogRow {
  id: string;
  createdAt: string;
  updatedAt?: string;
  values: Record<string, LogValue>;
}

/**
 * Cell value for a projected field. Object/array values are allowed so a richer
 * JSON Forms script can still persist nested data into the row map.
 */
export type LogValue = string | number | boolean | null | object;

export interface LogDocument {
  version: 1;
  schema: LogSchema;
  rows: LogRow[];
}

/** Generate a short, collision-resistant id for fields and rows. */
export function makeLogId(prefix: "f" | "r"): string {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) {
    return `${prefix}_${cryptoObj.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Starter schema seeded when a log page is created. Property ids are stable
 * (`entry` / `amount` / `notes`) so they match the default JSON Forms script in
 * `.form.json`. The Source tab is the authoring surface for richer forms.
 */
export function defaultLogSchema(): LogSchema {
  return {
    fields: [
      { id: "entry", name: "Entry", type: "text", required: true },
      { id: "amount", name: "Amount", type: "number" },
      { id: "notes", name: "Notes", type: "text" },
    ],
  };
}

export function defaultLogDocument(): LogDocument {
  return { version: 1, schema: defaultLogSchema(), rows: [] };
}

function coerceFieldType(value: unknown): LogFieldType {
  return LOG_FIELD_TYPES.includes(value as LogFieldType) ? (value as LogFieldType) : "text";
}

function normalizeField(raw: unknown, index: number): LogField | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<LogField>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name) return null;
  const type = coerceFieldType(candidate.type);
  const field: LogField = {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : makeLogId("f"),
    name,
    type,
  };
  if (candidate.required === true) field.required = true;
  if (type === "select" && Array.isArray(candidate.options)) {
    const options = candidate.options
      .filter((option): option is string => typeof option === "string")
      .map((option) => option.trim())
      .filter(Boolean);
    if (options.length > 0) field.options = options;
  }
  // Guarantee unique ids even if the sidecar was hand-edited with collisions.
  field.id = field.id || makeLogId("f");
  void index;
  return field;
}

function normalizeValue(field: LogField, raw: unknown): LogValue {
  switch (field.type) {
    case "number": {
      if (raw === null || raw === undefined || raw === "") return null;
      const num = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(num) ? num : null;
    }
    case "boolean":
      return raw === true || raw === "true" || raw === 1 || raw === "1";
    case "select": {
      // An unselected option ("") is stored as null, not an empty string.
      if (raw === null || raw === undefined || raw === "") return null;
      return typeof raw === "string" ? raw : String(raw);
    }
    case "image":
      return coerceImageAssetValue(raw, false);
    case "image-sequence":
      return coerceImageAssetValue(raw, true);
    case "date":
    case "text":
    default:
      if (raw === null || raw === undefined) return null;
      // Preserve nested JSON Forms values (arrays/objects) for richer scripts.
      if (typeof raw === "object") return raw;
      return typeof raw === "string" ? raw : String(raw);
  }
}

/** True only for a vault-served file inside a page's sibling `.assets` folder. */
export function isVaultAssetUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/vault/") || value.includes("?") || value.includes("#")) {
    return false;
  }
  try {
    return decodeURIComponent(value).includes(".assets/");
  } catch {
    return false;
  }
}

/**
 * Coerce image values to vault URLs. This deliberately rejects data URLs and
 * remote URLs so `.log.json` cannot accumulate base64 image blobs.
 */
export function coerceImageAssetValue(raw: unknown, multiple: boolean): LogValue {
  const urls = (multiple ? (Array.isArray(raw) ? raw : [raw]) : [raw])
    .filter(isVaultAssetUrl);
  if (multiple) return urls;
  return urls[0] ?? null;
}

function normalizeRow(raw: unknown, fields: LogField[]): LogRow | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<LogRow>;
  const rawValues =
    candidate.values && typeof candidate.values === "object"
      ? (candidate.values as Record<string, unknown>)
      : {};
  const values: Record<string, LogValue> = {};
  for (const field of fields) {
    values[field.id] = normalizeValue(field, rawValues[field.id]);
  }
  const row: LogRow = {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : makeLogId("r"),
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt
        ? candidate.createdAt
        : new Date().toISOString(),
    values,
  };
  if (typeof candidate.updatedAt === "string" && candidate.updatedAt) {
    row.updatedAt = candidate.updatedAt;
  }
  return row;
}

/**
 * Defensively parse an unknown value (freshly read JSON sidecar, or request
 * body) into a valid {@link LogDocument}. Never throws — a corrupt or partial
 * sidecar degrades to the default document rather than breaking the page.
 */
export function normalizeLogDocument(data: unknown): LogDocument {
  if (!data || typeof data !== "object") {
    return defaultLogDocument();
  }
  const candidate = data as Partial<LogDocument>;
  const rawFields = candidate.schema?.fields;
  const fields: LogField[] = Array.isArray(rawFields)
    ? rawFields
        .map((field, index) => normalizeField(field, index))
        .filter((field): field is LogField => field !== null)
    : defaultLogSchema().fields;

  const rawRows = candidate.rows;
  const rows: LogRow[] = Array.isArray(rawRows)
    ? rawRows.map((row) => normalizeRow(row, fields)).filter((row): row is LogRow => row !== null)
    : [];

  return { version: 1, schema: { fields }, rows };
}

/** Sanitize an incoming schema (from the schema editor) into normalized fields. */
export function normalizeFields(rawFields: unknown): LogField[] {
  if (!Array.isArray(rawFields)) return [];
  return rawFields
    .map((field, index) => normalizeField(field, index))
    .filter((field): field is LogField => field !== null);
}

/** Coerce a submitted values map to the typed shape for the given fields. */
export function coerceRowValues(
  fields: LogField[],
  rawValues: Record<string, unknown>
): Record<string, LogValue> {
  const values: Record<string, LogValue> = {};
  for (const field of fields) {
    values[field.id] = normalizeValue(field, rawValues[field.id]);
  }
  return values;
}

/** Field ids that are `required` but missing/blank in the submitted values. */
export function missingRequiredFields(
  fields: LogField[],
  values: Record<string, LogValue>
): LogField[] {
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.id];
    return value === null || value === undefined || value === "";
  });
}

/** Empty values map for a fresh Form render. */
export function emptyRowValues(fields: LogField[]): Record<string, LogValue> {
  const values: Record<string, LogValue> = {};
  for (const field of fields) {
    values[field.id] = field.type === "boolean" ? false : null;
  }
  return values;
}
