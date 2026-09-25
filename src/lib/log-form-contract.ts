/**
 * JSON Forms definition for vault-native log pages (SN-144).
 *
 * The Form tab renders this script via JSON Forms. The Source tab edits it as
 * JSON. Row records still live in `.log.json`; this file is the sibling
 * `<page-stem>.form.json` that describes layout, widgets, and validation.
 *
 * Companion authoring of this script is deferred (SN-145); humans (and later
 * the companion) edit Source directly.
 */

import type { JsonSchema, UISchemaElement } from "@jsonforms/core";
import {
  defaultLogSchema,
  makeLogId,
  type LogField,
  type LogFieldType,
} from "@/lib/log-contract";
import {
  LOG_QUERY_MAX_FIELDS,
  LOG_QUERY_DEFAULT_LIMIT,
  LOG_QUERY_MAX_LIMIT,
  parseLogQuery,
  type LogQueryAggregate,
  type LogQueryDateRange,
  type LogQueryFilter,
  type LogQuerySort,
} from "@/lib/log-query-contract";

export const LOG_FORM_VERSION = 1 as const;

/** Vault sidecar shape for a log page's JSON Forms script. */
export interface LogFormDefinition {
  version: typeof LOG_FORM_VERSION;
  /** JSON Schema describing the form data object (one row's values). */
  schema: JsonSchema;
  /** JSON Forms UI schema (layout, controls, widgets). */
  uischema: UISchemaElement;
  /** Explicit, application-agnostic contract for suggesting values from prior rows. */
  historySuggestion?: LogHistorySuggestionDefinition;
  /** Named, declarative history views. Rows remain solely in `.log.json`. */
  views?: LogViewDefinition[];
  /** Safe links from the rendered form into validated named History views. */
  actions?: LogFormActionDefinition[];
}

export interface LogHistorySuggestionDefinition {
  /** Stable field ids that must equal the current draft before a row is eligible. */
  matchFields: string[];
  /** Field ids whose prior values may be copied after an explicit user action. */
  copyFields: string[];
}

export const LOG_VIEW_MAX_COUNT = 24;
export const LOG_FORM_ACTION_MAX_COUNT = 12;
export const LOG_VIEW_FORMATS = ["text", "number", "integer", "boolean", "date", "datetime", "percent", "currency"] as const;
export type LogViewFormat = (typeof LOG_VIEW_FORMATS)[number];

export interface LogFormActionDefinition {
  type: "open-history";
  label: string;
  view: string;
}

export interface LogViewColumn {
  field: string;
  label?: string;
  unit?: string;
  format?: LogViewFormat;
}

export interface LogViewSummary extends LogQueryAggregate {
  label?: string;
  unit?: string;
  format?: LogViewFormat;
}

export interface LogViewDefinition {
  id: string;
  name: string;
  filters?: LogQueryFilter[];
  columns: LogViewColumn[];
  dateRange?: LogQueryDateRange;
  sort?: LogQuerySort[];
  limit?: number;
  grouping?: string[];
  summaries?: LogViewSummary[];
  presentation?: "table" | "cards" | "timeline" | "grouped" | "summary";
}

const DEFAULT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    entry: { type: "string", title: "Entry" },
    amount: { type: "number", title: "Amount" },
    notes: { type: "string", title: "Notes" },
  },
  required: ["entry"],
};

const DEFAULT_UI_SCHEMA: UISchemaElement = {
  type: "VerticalLayout",
  elements: [
    { type: "Control", scope: "#/properties/entry" },
    { type: "Control", scope: "#/properties/amount" },
    { type: "Control", scope: "#/properties/notes" },
  ],
};

/** Starter form script seeded when a log page is created. */
export function defaultLogFormDefinition(): LogFormDefinition {
  return {
    version: LOG_FORM_VERSION,
    schema: structuredClone(DEFAULT_SCHEMA),
    uischema: structuredClone(DEFAULT_UI_SCHEMA) as UISchemaElement,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coerceJsonSchema(raw: unknown): JsonSchema {
  if (!isPlainObject(raw)) {
    return structuredClone(DEFAULT_SCHEMA);
  }
  // Accept any JSON-Schema-shaped object; JSON Forms validates at render time.
  return raw as JsonSchema;
}

function coerceUiSchema(raw: unknown): UISchemaElement {
  if (!isPlainObject(raw) || typeof raw.type !== "string") {
    return structuredClone(DEFAULT_UI_SCHEMA) as UISchemaElement;
  }
  return raw as unknown as UISchemaElement;
}

function normalizeHistoryFieldList(
  raw: unknown,
  key: keyof LogHistorySuggestionDefinition,
  schema: JsonSchema,
  strict: boolean
): string[] | null {
  const propertyIds = isPlainObject(schema.properties)
    ? new Set(Object.keys(schema.properties))
    : new Set<string>();
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LOG_QUERY_MAX_FIELDS) {
    if (strict) {
      throw new Error(
        `"historySuggestion.${key}" must contain 1-${LOG_QUERY_MAX_FIELDS} schema field ids.`
      );
    }
    return null;
  }
  const fields: string[] = [];
  for (const [index, value] of raw.entries()) {
    const field = typeof value === "string" ? value.trim() : "";
    if (!field || !propertyIds.has(field)) {
      if (strict) {
        throw new Error(
          `"historySuggestion.${key}[${index}]" must reference a schema property.`
        );
      }
      return null;
    }
    if (fields.includes(field)) {
      if (strict) {
        throw new Error(`"historySuggestion.${key}" must not contain duplicate field ids.`);
      }
      return null;
    }
    fields.push(field);
  }
  return fields;
}

function normalizeLogHistorySuggestion(
  raw: unknown,
  schema: JsonSchema,
  strict: boolean
): LogHistorySuggestionDefinition | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    if (strict) throw new Error('"historySuggestion" must be an object.');
    return undefined;
  }
  const extras = Object.keys(raw).filter(
    (key) => !["matchFields", "copyFields"].includes(key)
  );
  if (extras.length) {
    if (strict) {
      throw new Error(`"historySuggestion" contains unsupported key(s): ${extras.join(", ")}.`);
    }
    return undefined;
  }
  const matchFields = normalizeHistoryFieldList(
    raw.matchFields,
    "matchFields",
    schema,
    strict
  );
  const copyFields = normalizeHistoryFieldList(
    raw.copyFields,
    "copyFields",
    schema,
    strict
  );
  return matchFields && copyFields ? { matchFields, copyFields } : undefined;
}

/**
 * Defensively parse a `.form.json` sidecar (or Source-tab payload) into a valid
 * form definition. Never throws — corrupt input falls back to the starter.
 */
export function normalizeLogFormDefinition(data: unknown): LogFormDefinition {
  if (!isPlainObject(data)) {
    return defaultLogFormDefinition();
  }
  const schema = coerceJsonSchema(data.schema);
  const views = normalizeLogViews(data.views, schema, false);
  const actions = normalizeLogFormActions(data.actions, views, false);
  const historySuggestion = normalizeLogHistorySuggestion(
    data.historySuggestion,
    schema,
    false
  );
  return {
    version: LOG_FORM_VERSION,
    schema,
    uischema: coerceUiSchema(data.uischema),
    ...(historySuggestion ? { historySuggestion } : {}),
    ...(views.length ? { views } : {}),
    ...(actions.length ? { actions } : {}),
  };
}

function shortText(value: unknown, max = 120): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result && result.length <= max ? result : undefined;
}

function normalizeLogViews(raw: unknown, schema: JsonSchema, strict: boolean): LogViewDefinition[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > LOG_VIEW_MAX_COUNT) {
    if (strict) throw new Error(`"views" must contain at most ${LOG_VIEW_MAX_COUNT} named views.`);
    return [];
  }
  const fields = fieldsFromJsonSchema(schema);
  const ids = new Set<string>();
  const normalized: LogViewDefinition[] = [];
  for (const [index, candidate] of raw.entries()) {
    try {
      if (!isPlainObject(candidate)) throw new Error(`views[${index}] must be an object.`);
      const allowed = new Set(["id", "name", "filters", "columns", "dateRange", "sort", "limit", "grouping", "summaries", "presentation"]);
      const extras = Object.keys(candidate).filter((key) => !allowed.has(key));
      if (extras.length) throw new Error(`views[${index}] contains unsupported key(s): ${extras.join(", ")}.`);
      const id = shortText(candidate.id, 64);
      const name = shortText(candidate.name, 120);
      if (!id || !/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`views[${index}].id is invalid.`);
      if (!name) throw new Error(`views[${index}].name is invalid.`);
      if (ids.has(id)) throw new Error(`views[${index}].id must be unique.`);
      if (!Array.isArray(candidate.columns) || !candidate.columns.length || candidate.columns.length > LOG_QUERY_MAX_FIELDS) {
        throw new Error(`views[${index}].columns must contain 1-${LOG_QUERY_MAX_FIELDS} entries.`);
      }
      const query = parseLogQuery({
        fields: candidate.columns.map((column) => isPlainObject(column) ? column.field : undefined),
        filters: candidate.filters,
        dateRange: candidate.dateRange,
        sort: candidate.sort,
        limit: candidate.limit ?? LOG_QUERY_DEFAULT_LIMIT,
        groupBy: candidate.grouping,
        aggregates: Array.isArray(candidate.summaries)
          ? candidate.summaries.map((summary) => isPlainObject(summary)
            ? { operator: summary.operator, field: summary.field, as: summary.as }
            : summary)
          : candidate.summaries,
      }, fields);
      const columns = candidate.columns.map((column, columnIndex) => {
        if (!isPlainObject(column)) throw new Error(`views[${index}].columns[${columnIndex}] must be an object.`);
        const extras = Object.keys(column).filter((key) => !["field", "label", "unit", "format"].includes(key));
        if (extras.length) throw new Error(`views[${index}].columns[${columnIndex}] has unsupported keys.`);
        const field = query.fields[columnIndex];
        const label = shortText(column.label);
        const unit = shortText(column.unit, 40);
        const format = LOG_VIEW_FORMATS.includes(column.format as LogViewFormat) ? column.format as LogViewFormat : undefined;
        if (column.format !== undefined && !format) throw new Error(`views[${index}].columns[${columnIndex}].format is not allowlisted.`);
        return { field, ...(label ? { label } : {}), ...(unit ? { unit } : {}), ...(format ? { format } : {}) };
      });
      const summaries = Array.isArray(candidate.summaries)
        ? candidate.summaries.map((summary, summaryIndex) => {
            if (!isPlainObject(summary)) throw new Error(`views[${index}].summaries[${summaryIndex}] must be an object.`);
            const extras = Object.keys(summary).filter((key) => !["operator", "field", "as", "label", "unit", "format"].includes(key));
            if (extras.length) throw new Error(`views[${index}].summaries[${summaryIndex}] has unsupported keys.`);
            const parsed = query.aggregates[summaryIndex];
            const label = shortText(summary.label);
            const unit = shortText(summary.unit, 40);
            const format = LOG_VIEW_FORMATS.includes(summary.format as LogViewFormat) ? summary.format as LogViewFormat : undefined;
            if (summary.format !== undefined && !format) throw new Error(`views[${index}].summaries[${summaryIndex}].format is not allowlisted.`);
            return { ...parsed, ...(label ? { label } : {}), ...(unit ? { unit } : {}), ...(format ? { format } : {}) };
          })
        : undefined;
      const presentation = candidate.presentation === undefined ? undefined : candidate.presentation;
      if (presentation !== undefined && !["table", "cards", "timeline", "grouped", "summary"].includes(String(presentation))) {
        throw new Error(`views[${index}].presentation is not allowlisted.`);
      }
      if (presentation === "grouped" && !query.groupBy.length) {
        throw new Error(`views[${index}].grouping is required for grouped presentation.`);
      }
      if (presentation === "summary" && !summaries?.length) {
        throw new Error(`views[${index}].summaries are required for summary presentation.`);
      }
      ids.add(id);
      normalized.push({
        id,
        name,
        columns,
        ...(query.filters.length ? { filters: query.filters } : {}),
        ...(query.dateRange ? { dateRange: query.dateRange } : {}),
        ...(query.sort.length ? { sort: query.sort } : {}),
        limit: query.limit,
        ...(query.groupBy.length ? { grouping: query.groupBy } : {}),
        ...(summaries?.length ? { summaries } : {}),
        ...(presentation ? { presentation: presentation as LogViewDefinition["presentation"] } : {}),
      });
    } catch (error) {
      if (strict) throw error;
    }
  }
  return normalized;
}

function normalizeLogFormActions(
  raw: unknown,
  views: LogViewDefinition[],
  strict: boolean
): LogFormActionDefinition[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > LOG_FORM_ACTION_MAX_COUNT) {
    if (strict) {
      throw new Error(`"actions" must contain at most ${LOG_FORM_ACTION_MAX_COUNT} safe actions.`);
    }
    return [];
  }
  const viewIds = new Set(views.map((view) => view.id));
  const normalized: LogFormActionDefinition[] = [];
  for (const [index, candidate] of raw.entries()) {
    try {
      if (!isPlainObject(candidate)) throw new Error(`actions[${index}] must be an object.`);
      const extras = Object.keys(candidate).filter((key) => !["type", "label", "view"].includes(key));
      if (extras.length) throw new Error(`actions[${index}] contains unsupported key(s): ${extras.join(", ")}.`);
      if (candidate.type !== "open-history") {
        throw new Error(`actions[${index}].type must be "open-history".`);
      }
      const label = shortText(candidate.label, 80);
      const view = shortText(candidate.view, 64);
      if (!label) throw new Error(`actions[${index}].label is invalid.`);
      if (!view || !viewIds.has(view)) {
        throw new Error(`actions[${index}].view must reference a valid named view.`);
      }
      normalized.push({ type: "open-history", label, view });
    } catch (error) {
      if (strict) throw error;
    }
  }
  return normalized;
}

/** Strict write-path validation. Defensive reads use `normalizeLogFormDefinition`. */
export function validateLogFormDefinitionForWrite(data: unknown): LogFormDefinition {
  if (!isPlainObject(data)) throw new Error("Form definition must be an object.");
  const normalized = normalizeLogFormDefinition(data);
  const views = normalizeLogViews(data.views, normalized.schema, true);
  const actions = normalizeLogFormActions(data.actions, views, true);
  const historySuggestion = normalizeLogHistorySuggestion(
    data.historySuggestion,
    normalized.schema,
    true
  );
  return {
    ...normalized,
    ...(historySuggestion ? { historySuggestion } : {}),
    ...(views.length ? { views } : {}),
    ...(actions.length ? { actions } : {}),
  };
}

/** Pretty-print the form script for the Source tab. */
export function serializeLogFormSource(definition: LogFormDefinition): string {
  const normalized = normalizeLogFormDefinition(definition);
  return `${JSON.stringify(
    {
      version: normalized.version,
      schema: normalized.schema,
      uischema: normalized.uischema,
      ...(normalized.historySuggestion
        ? { historySuggestion: normalized.historySuggestion }
        : {}),
      ...(normalized.views?.length ? { views: normalized.views } : {}),
      ...(normalized.actions?.length ? { actions: normalized.actions } : {}),
    },
    null,
    2
  )}\n`;
}

/**
 * Parse Source-tab text into a form definition. Throws with a human message when
 * the text is not valid JSON (caller should surface that without writing disk).
 */
export function parseLogFormSource(text: string): LogFormDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Form source is not valid JSON: ${message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error("Form source must be a JSON object with schema and uischema.");
  }
  if (!("schema" in parsed) || !("uischema" in parsed)) {
    throw new Error('Form source must include both "schema" and "uischema".');
  }
  return validateLogFormDefinitionForWrite(parsed);
}

function titleOf(prop: JsonSchema, fallback: string): string {
  if (typeof prop.title === "string" && prop.title.trim()) return prop.title.trim();
  return fallback;
}

function mapPropertyToField(id: string, prop: JsonSchema, required: boolean): LogField {
  const name = titleOf(prop, id);
  const enumValues = Array.isArray(prop.enum)
    ? prop.enum.filter((value): value is string | number | boolean =>
        ["string", "number", "boolean"].includes(typeof value)
      )
    : null;

  let type: LogFieldType = "text";
  let options: string[] | undefined;

  const itemSchema = isPlainObject(prop.items) ? (prop.items as JsonSchema) : null;
  if (prop.type === "array" && itemSchema?.type === "string" && itemSchema.format === "image") {
    type = "image-sequence";
  } else if (prop.type === "string" && prop.format === "image") {
    type = "image";
  } else if (enumValues && enumValues.length > 0) {
    type = "select";
    options = enumValues.map(String);
  } else if (prop.type === "boolean") {
    type = "boolean";
  } else if (prop.type === "number" || prop.type === "integer") {
    type = "number";
  } else if (prop.type === "string" && prop.format === "date") {
    type = "date";
  } else {
    type = "text";
  }

  const field: LogField = { id, name, type };
  if (required) field.required = true;
  if (options) field.options = options;
  return field;
}

/**
 * Project top-level JSON Schema properties into the flat {@link LogField}[] used
 * by `.log.json` row coercion and the Table tab. Nested/array richness stays in
 * the form script; Table only lists projected columns.
 */
export function fieldsFromJsonSchema(schema: JsonSchema): LogField[] {
  if (!isPlainObject(schema) || schema.type !== "object" || !isPlainObject(schema.properties)) {
    return defaultLogSchema().fields;
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : []
  );
  const fields: LogField[] = [];
  for (const [id, rawProp] of Object.entries(schema.properties)) {
    if (!id.trim()) continue;
    const prop = isPlainObject(rawProp) ? (rawProp as JsonSchema) : ({ type: "string" } as JsonSchema);
    fields.push(mapPropertyToField(id, prop, required.has(id)));
  }
  return fields.length > 0 ? fields : defaultLogSchema().fields;
}

/** Build a VerticalLayout Control list covering every projected field. */
function uischemaFromFields(fields: LogField[]): UISchemaElement {
  return {
    type: "VerticalLayout",
    elements: fields.map((field) => ({
      type: "Control",
      scope: `#/properties/${field.id}`,
    })),
  };
}

/** Build a JSON Schema object from flat log fields (migration / Fields→Source). */
export function jsonSchemaFromFields(fields: LogField[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of fields) {
    const id = field.id || makeLogId("f");
    let prop: JsonSchema;
    switch (field.type) {
      case "number":
        prop = { type: "number", title: field.name };
        break;
      case "boolean":
        prop = { type: "boolean", title: field.name };
        break;
      case "date":
        prop = { type: "string", format: "date", title: field.name };
        break;
      case "select":
        prop = {
          type: "string",
          title: field.name,
          enum: field.options && field.options.length > 0 ? field.options : [""],
        };
        break;
      case "image":
        prop = { type: "string", format: "image", title: field.name };
        break;
      case "image-sequence":
        prop = { type: "array", title: field.name, items: { type: "string", format: "image" } };
        break;
      case "text":
      default:
        prop = { type: "string", title: field.name };
        break;
    }
    properties[id] = prop;
    if (field.required) required.push(id);
  }
  const schema = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  } as JsonSchema;
  return schema;
}

/** Derive a form script from a legacy flat schema (logs created before Source). */
export function formDefinitionFromFields(fields: LogField[]): LogFormDefinition {
  const normalizedFields = fields.length > 0 ? fields : defaultLogSchema().fields;
  return {
    version: LOG_FORM_VERSION,
    schema: jsonSchemaFromFields(normalizedFields),
    uischema: uischemaFromFields(normalizedFields),
  };
}

function cloneStaticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneStaticValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneStaticValue(child)])
  );
}

function initializeSchemaValue(schema: JsonSchema, current: unknown): unknown {
  const schemaDefault = schema.default === undefined
    ? undefined
    : cloneStaticValue(schema.default);
  const value = current === undefined ? schemaDefault : current;

  if (schema.type === "object" || isPlainObject(schema.properties)) {
    if (value !== undefined && !isPlainObject(value)) return value;
    const initialized = isPlainObject(schemaDefault)
      ? cloneStaticValue(schemaDefault) as Record<string, unknown>
      : {};
    if (isPlainObject(value)) {
      for (const [id, child] of Object.entries(value)) {
        if (child !== undefined) initialized[id] = cloneStaticValue(child);
      }
    }
    let hasValue = value !== undefined || schemaDefault !== undefined;
    if (isPlainObject(schema.properties)) {
      for (const [id, rawProperty] of Object.entries(schema.properties)) {
        if (!isPlainObject(rawProperty)) continue;
        const child = initializeSchemaValue(
          rawProperty as JsonSchema,
          initialized[id]
        );
        if (child !== undefined) {
          initialized[id] = child;
          hasValue = true;
        }
      }
    }
    return hasValue ? initialized : undefined;
  }

  if (schema.type === "array" && Array.isArray(value)) {
    const itemSchema = isPlainObject(schema.items) ? schema.items as JsonSchema : null;
    return itemSchema
      ? value.map((item) => initializeSchemaValue(itemSchema, item))
      : value.map(cloneStaticValue);
  }

  // Preserve the existing log-form convention for unchecked booleans.
  if (value === undefined && schema.type === "boolean") return false;
  return value;
}

/**
 * Initializes a log entry from JSON Schema defaults without replacing restored
 * draft or manually entered values. Nested object defaults and array-default
 * rows are recursively completed, and returned containers never alias schema
 * defaults or the supplied data.
 */
export function initializeFormData(
  schema: JsonSchema,
  data?: Record<string, unknown>
): Record<string, unknown> {
  const initialized = initializeSchemaValue(schema, data);
  return isPlainObject(initialized) ? initialized : {};
}
