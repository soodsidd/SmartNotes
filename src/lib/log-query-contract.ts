import type { LogDocument, LogField, LogRow, LogValue } from "@/lib/log-contract";

export const LOG_QUERY_DEFAULT_LIMIT = 50;
export const LOG_QUERY_MAX_LIMIT = 200;
export const LOG_QUERY_MAX_FILTERS = 12;
export const LOG_QUERY_MAX_SORTS = 3;
export const LOG_QUERY_MAX_FIELDS = 32;
export const LOG_QUERY_MAX_AGGREGATES = 12;
export const LOG_QUERY_MAX_GROUPS = 100;

export const LOG_FILTER_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "is_empty",
] as const;
export type LogFilterOperator = (typeof LOG_FILTER_OPERATORS)[number];

export const LOG_AGGREGATE_OPERATORS = ["count", "sum", "average", "minimum", "maximum"] as const;
export type LogAggregateOperator = (typeof LOG_AGGREGATE_OPERATORS)[number];

export interface LogQueryFilter {
  field: string;
  operator: LogFilterOperator;
  value?: unknown;
}

export interface LogQuerySort {
  field: string;
  direction: "asc" | "desc";
}

export interface LogQueryDateRange {
  field?: string;
  from?: string;
  to?: string;
}

export interface LogQueryAggregate {
  operator: LogAggregateOperator;
  field?: string;
  as?: string;
}

export interface LogQuery {
  fields?: string[];
  filters?: LogQueryFilter[];
  sort?: LogQuerySort[];
  dateRange?: LogQueryDateRange;
  limit?: number;
  groupBy?: string[];
  aggregates?: LogQueryAggregate[];
}

export interface ParsedLogQuery {
  fields: string[];
  filters: LogQueryFilter[];
  sort: LogQuerySort[];
  dateRange?: LogQueryDateRange;
  limit: number;
  groupBy: string[];
  aggregates: LogQueryAggregate[];
}

export interface LogQueryResultRow {
  id: string;
  createdAt: string;
  updatedAt?: string;
  values: Record<string, LogValue>;
}

export interface LogQueryGroup {
  key: Record<string, LogValue>;
  rowCount: number;
  aggregates: Record<string, number | null>;
}

export interface LogQueryResult {
  fields: string[];
  rows: LogQueryResultRow[];
  matchedCount: number;
  returnedCount: number;
  truncated: boolean;
  limit: number;
  aggregates: Record<string, number | null>;
  groups: LogQueryGroup[];
}

export class LogQueryValidationError extends Error {
  readonly code = "INVALID_LOG_QUERY";

  constructor(message: string) {
    super(message);
    this.name = "LogQueryValidationError";
  }
}

const QUERY_KEYS = new Set(["fields", "filters", "sort", "dateRange", "limit", "groupBy", "aggregates"]);
const FILTER_KEYS = new Set(["field", "operator", "value"]);
const SORT_KEYS = new Set(["field", "direction"]);
const DATE_RANGE_KEYS = new Set(["field", "from", "to"]);
const AGGREGATE_KEYS = new Set(["operator", "field", "as"]);
const META_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectExtraKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length) {
    throw new LogQueryValidationError(`${label} contains unsupported key(s): ${extras.join(", ")}.`);
  }
}

function requiredString(value: unknown, label: string, maxLength = 80): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new LogQueryValidationError(`${label} must be a non-empty string.`);
  }
  const result = value.trim();
  if (result.length > maxLength) throw new LogQueryValidationError(`${label} is too long.`);
  return result;
}

function fieldMap(fields: LogField[]) {
  return new Map(fields.map((field) => [field.id, field]));
}

function requireKnownField(value: unknown, fields: Map<string, LogField>, label: string, allowMeta = true): string {
  const field = requiredString(value, label);
  if (!fields.has(field) && !(allowMeta && META_FIELDS.has(field))) {
    throw new LogQueryValidationError(`${label} references unknown field "${field}".`);
  }
  return field;
}

function validateIsoDate(value: unknown, label: string): string {
  const date = requiredString(value, label);
  if (!Number.isFinite(Date.parse(date))) throw new LogQueryValidationError(`${label} must be an ISO date or timestamp.`);
  return date;
}

function parseStringList(
  raw: unknown,
  fields: Map<string, LogField>,
  label: string,
  max: number,
  allowMeta = true
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > max) {
    throw new LogQueryValidationError(`${label} must be an array with at most ${max} entries.`);
  }
  const result = raw.map((entry, index) => requireKnownField(entry, fields, `${label}[${index}]`, allowMeta));
  if (new Set(result).size !== result.length) throw new LogQueryValidationError(`${label} cannot contain duplicates.`);
  return result;
}

/** Strictly validates an application-agnostic query. Unknown keys are rejected. */
export function parseLogQuery(raw: unknown, schemaFields: LogField[]): ParsedLogQuery {
  if (raw === undefined || raw === null) raw = {};
  if (!plainObject(raw)) throw new LogQueryValidationError("Log query must be an object.");
  rejectExtraKeys(raw, QUERY_KEYS, "Log query");
  const fieldsById = fieldMap(schemaFields);

  const selected = raw.fields === undefined
    ? schemaFields.slice(0, LOG_QUERY_MAX_FIELDS).map((field) => field.id)
    : parseStringList(raw.fields, fieldsById, "fields", LOG_QUERY_MAX_FIELDS);

  let filters: LogQueryFilter[] = [];
  if (raw.filters !== undefined) {
    if (!Array.isArray(raw.filters) || raw.filters.length > LOG_QUERY_MAX_FILTERS) {
      throw new LogQueryValidationError(`filters must contain at most ${LOG_QUERY_MAX_FILTERS} entries.`);
    }
    filters = raw.filters.map((entry, index) => {
      if (!plainObject(entry)) throw new LogQueryValidationError(`filters[${index}] must be an object.`);
      rejectExtraKeys(entry, FILTER_KEYS, `filters[${index}]`);
      const field = requireKnownField(entry.field, fieldsById, `filters[${index}].field`);
      if (!LOG_FILTER_OPERATORS.includes(entry.operator as LogFilterOperator)) {
        throw new LogQueryValidationError(`filters[${index}].operator is not allowlisted.`);
      }
      const operator = entry.operator as LogFilterOperator;
      if (operator === "in" && (!Array.isArray(entry.value) || entry.value.length > 50)) {
        throw new LogQueryValidationError(`filters[${index}].value must be an array with at most 50 entries.`);
      }
      if (operator !== "is_empty" && entry.value === undefined) {
        throw new LogQueryValidationError(`filters[${index}].value is required.`);
      }
      return { field, operator, ...(operator === "is_empty" ? {} : { value: entry.value }) };
    });
  }

  let sort: LogQuerySort[] = [];
  if (raw.sort !== undefined) {
    if (!Array.isArray(raw.sort) || raw.sort.length > LOG_QUERY_MAX_SORTS) {
      throw new LogQueryValidationError(`sort must contain at most ${LOG_QUERY_MAX_SORTS} entries.`);
    }
    sort = raw.sort.map((entry, index) => {
      if (!plainObject(entry)) throw new LogQueryValidationError(`sort[${index}] must be an object.`);
      rejectExtraKeys(entry, SORT_KEYS, `sort[${index}]`);
      const field = requireKnownField(entry.field, fieldsById, `sort[${index}].field`);
      if (entry.direction !== "asc" && entry.direction !== "desc") {
        throw new LogQueryValidationError(`sort[${index}].direction must be "asc" or "desc".`);
      }
      return { field, direction: entry.direction };
    });
  }

  let dateRange: LogQueryDateRange | undefined;
  if (raw.dateRange !== undefined) {
    if (!plainObject(raw.dateRange)) throw new LogQueryValidationError("dateRange must be an object.");
    rejectExtraKeys(raw.dateRange, DATE_RANGE_KEYS, "dateRange");
    const field = raw.dateRange.field === undefined
      ? "createdAt"
      : requireKnownField(raw.dateRange.field, fieldsById, "dateRange.field");
    const from = raw.dateRange.from === undefined ? undefined : validateIsoDate(raw.dateRange.from, "dateRange.from");
    const to = raw.dateRange.to === undefined ? undefined : validateIsoDate(raw.dateRange.to, "dateRange.to");
    if (!from && !to) throw new LogQueryValidationError("dateRange requires from and/or to.");
    if (from && to && Date.parse(from) > Date.parse(to)) {
      throw new LogQueryValidationError("dateRange.from must not be after dateRange.to.");
    }
    dateRange = { field, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }

  let limit = LOG_QUERY_DEFAULT_LIMIT;
  if (raw.limit !== undefined) {
    if (!Number.isInteger(raw.limit) || (raw.limit as number) < 1) {
      throw new LogQueryValidationError("limit must be a positive integer.");
    }
    limit = Math.min(raw.limit as number, LOG_QUERY_MAX_LIMIT);
  }

  const groupBy = parseStringList(raw.groupBy, fieldsById, "groupBy", 2);
  let aggregates: LogQueryAggregate[] = [];
  if (raw.aggregates !== undefined) {
    if (!Array.isArray(raw.aggregates) || raw.aggregates.length > LOG_QUERY_MAX_AGGREGATES) {
      throw new LogQueryValidationError(`aggregates must contain at most ${LOG_QUERY_MAX_AGGREGATES} entries.`);
    }
    aggregates = raw.aggregates.map((entry, index) => {
      if (!plainObject(entry)) throw new LogQueryValidationError(`aggregates[${index}] must be an object.`);
      rejectExtraKeys(entry, AGGREGATE_KEYS, `aggregates[${index}]`);
      if (!LOG_AGGREGATE_OPERATORS.includes(entry.operator as LogAggregateOperator)) {
        throw new LogQueryValidationError(`aggregates[${index}].operator is not allowlisted.`);
      }
      const operator = entry.operator as LogAggregateOperator;
      const field = entry.field === undefined ? undefined : requireKnownField(entry.field, fieldsById, `aggregates[${index}].field`, false);
      if (operator !== "count" && !field) {
        throw new LogQueryValidationError(`aggregates[${index}].field is required for ${operator}.`);
      }
      if (field && operator !== "count" && fieldsById.get(field)?.type !== "number") {
        throw new LogQueryValidationError(`aggregates[${index}].field must be numeric for ${operator}.`);
      }
      const as = entry.as === undefined ? undefined : requiredString(entry.as, `aggregates[${index}].as`, 64);
      return { operator, ...(field ? { field } : {}), ...(as ? { as } : {}) };
    });
  }

  return { fields: selected, filters, sort, ...(dateRange ? { dateRange } : {}), limit, groupBy, aggregates };
}

function rowValue(row: LogRow, field: string): unknown {
  if (field === "id") return row.id;
  if (field === "createdAt") return row.createdAt;
  if (field === "updatedAt") return row.updatedAt ?? null;
  return row.values[field];
}

function compare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function matchesFilter(row: LogRow, filter: LogQueryFilter): boolean {
  const actual = rowValue(row, filter.field);
  switch (filter.operator) {
    case "eq": return actual === filter.value;
    case "neq": return actual !== filter.value;
    case "gt": return compare(actual, filter.value) > 0;
    case "gte": return compare(actual, filter.value) >= 0;
    case "lt": return compare(actual, filter.value) < 0;
    case "lte": return compare(actual, filter.value) <= 0;
    case "contains": return String(actual ?? "").toLocaleLowerCase().includes(String(filter.value ?? "").toLocaleLowerCase());
    case "in": return (filter.value as unknown[]).some((candidate) => actual === candidate);
    case "is_empty": return actual === null || actual === undefined || actual === "";
  }
}

function aggregateName(spec: LogQueryAggregate): string {
  return spec.as ?? `${spec.operator}${spec.field ? `_${spec.field}` : ""}`;
}

function computeAggregates(rows: LogRow[], specs: LogQueryAggregate[]): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const spec of specs) {
    const name = aggregateName(spec);
    if (spec.operator === "count") {
      result[name] = spec.field
        ? rows.filter((row) => rowValue(row, spec.field!) !== null && rowValue(row, spec.field!) !== undefined).length
        : rows.length;
      continue;
    }
    const values = rows.map((row) => rowValue(row, spec.field!)).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!values.length) {
      result[name] = null;
    } else if (spec.operator === "sum") {
      result[name] = values.reduce((sum, value) => sum + value, 0);
    } else if (spec.operator === "average") {
      result[name] = values.reduce((sum, value) => sum + value, 0) / values.length;
    } else if (spec.operator === "minimum") {
      result[name] = Math.min(...values);
    } else {
      result[name] = Math.max(...values);
    }
  }
  return result;
}

/** Executes only the validated, in-memory contract; it never reads a file or evaluates code. */
export function executeLogQuery(document: LogDocument, rawQuery: unknown): LogQueryResult {
  const query = parseLogQuery(rawQuery, document.schema.fields);
  let matched = document.rows.filter((row) => query.filters.every((filter) => matchesFilter(row, filter)));
  if (query.dateRange) {
    const from = query.dateRange.from ? Date.parse(query.dateRange.from) : Number.NEGATIVE_INFINITY;
    const to = query.dateRange.to ? Date.parse(query.dateRange.to) : Number.POSITIVE_INFINITY;
    matched = matched.filter((row) => {
      const timestamp = Date.parse(String(rowValue(row, query.dateRange!.field ?? "createdAt") ?? ""));
      return Number.isFinite(timestamp) && timestamp >= from && timestamp <= to;
    });
  }
  if (query.sort.length) {
    matched = [...matched].sort((left, right) => {
      for (const spec of query.sort) {
        const result = compare(rowValue(left, spec.field), rowValue(right, spec.field));
        if (result) return spec.direction === "asc" ? result : -result;
      }
      return 0;
    });
  }

  const groups: LogQueryGroup[] = [];
  if (query.groupBy.length) {
    const grouped = new Map<string, { key: Record<string, LogValue>; rows: LogRow[] }>();
    for (const row of matched) {
      const key = Object.fromEntries(query.groupBy.map((field) => [field, rowValue(row, field) as LogValue]));
      const encoded = JSON.stringify(key);
      const existing = grouped.get(encoded) ?? { key, rows: [] };
      existing.rows.push(row);
      grouped.set(encoded, existing);
    }
    for (const group of [...grouped.values()].slice(0, LOG_QUERY_MAX_GROUPS)) {
      groups.push({ key: group.key, rowCount: group.rows.length, aggregates: computeAggregates(group.rows, query.aggregates) });
    }
  }

  const rows = matched.slice(0, query.limit).map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
    values: Object.fromEntries(query.fields.map((field) => [field, rowValue(row, field) as LogValue])),
  }));
  return {
    fields: query.fields,
    rows,
    matchedCount: matched.length,
    returnedCount: rows.length,
    truncated: matched.length > rows.length,
    limit: query.limit,
    aggregates: computeAggregates(matched, query.aggregates),
    groups,
  };
}
