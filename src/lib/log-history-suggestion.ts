import type { JsonSchema } from "@jsonforms/core";

import type {
  LogHistorySuggestionDefinition,
} from "@/lib/log-form-contract";
import type { LogRow, LogValue } from "@/lib/log-contract";

export interface LogHistorySuggestionValue {
  fieldId: string;
  label: string;
  value: LogValue;
}

export interface LogHistorySuggestion {
  rowId: string;
  createdAt: string;
  values: LogHistorySuggestionValue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every(
        (key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key])
      );
  }
  return false;
}

function cloneValue(value: LogValue): LogValue {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item as LogValue));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneValue(child as LogValue)])
  );
}

function fieldLabel(schema: JsonSchema, fieldId: string): string {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const property = isPlainObject(properties[fieldId])
    ? properties[fieldId] as JsonSchema
    : null;
  return typeof property?.title === "string" && property.title.trim()
    ? property.title.trim()
    : fieldId;
}

function rowMatches(
  row: LogRow,
  draft: Record<string, unknown>,
  matchFields: string[]
): boolean {
  return matchFields.every((fieldId) => {
    const currentValue = draft[fieldId];
    const priorValue = row.values[fieldId];
    return hasMeaningfulValue(currentValue)
      && hasMeaningfulValue(priorValue)
      && valuesEqual(currentValue, priorValue);
  });
}

/**
 * Finds the newest row matching the form-authored stable fields. This is a pure
 * read: deriving a suggestion never changes the current draft.
 */
export function findLogHistorySuggestion(
  definition: LogHistorySuggestionDefinition | undefined,
  schema: JsonSchema,
  draft: Record<string, unknown>,
  rows: LogRow[]
): LogHistorySuggestion | null {
  if (!definition || !definition.matchFields.length || !definition.copyFields.length) {
    return null;
  }

  let newest: { row: LogRow; timestamp: number; index: number } | null = null;
  for (const [index, row] of rows.entries()) {
    if (!rowMatches(row, draft, definition.matchFields)) continue;
    const parsed = Date.parse(row.createdAt);
    const timestamp = Number.isFinite(parsed) ? parsed : 0;
    if (
      !newest
      || timestamp > newest.timestamp
      || (timestamp === newest.timestamp && index > newest.index)
    ) {
      newest = { row, timestamp, index };
    }
  }
  if (!newest) return null;

  const values = definition.copyFields.flatMap((fieldId) => {
    const value = newest?.row.values[fieldId];
    if (!hasMeaningfulValue(value)) return [];
    return [{
      fieldId,
      label: fieldLabel(schema, fieldId),
      value: cloneValue(value as LogValue),
    }];
  });
  return values.length
    ? {
        rowId: newest.row.id,
        createdAt: newest.row.createdAt,
        values,
      }
    : null;
}

/**
 * Returns a copied draft after an explicit copy action. Unselected draft fields
 * retain their current values, including manual edits.
 */
export function applyLogHistorySuggestion(
  draft: Record<string, unknown>,
  suggestion: LogHistorySuggestion,
  selectedFieldIds = suggestion.values.map((value) => value.fieldId)
): Record<string, unknown> {
  const selected = new Set(selectedFieldIds);
  const next = { ...draft };
  for (const item of suggestion.values) {
    if (selected.has(item.fieldId)) next[item.fieldId] = cloneValue(item.value);
  }
  return next;
}
