// SN-209: bounded cell-level read/write/summary adapters over the Syncfusion
// native workbook JSON model (see spreadsheet-workbook.ts). These are pure
// functions so the companion spreadsheet tools stay fully unit-testable in
// isolation from the vault filesystem and the live editor surface.
//
// Workbook truth is Syncfusion native JSON sidecars (SN-207). A sheet is
// { name, rows?: [{ index?, cells?: [{ index?, value?, formula? }] }] } where
// rows and cells are sparse and carry an optional explicit `index`; when the
// index is absent the array position is authoritative (mirrors the CSV adapter).

import {
  normalizeSpreadsheetWorkbook,
  type SpreadsheetWorkbook,
} from "@/lib/spreadsheet-workbook";

/** Read bound: reject any range covering more cells than this. */
export const SPREADSHEET_MAX_READ_CELLS = 2_000;
/** Write bound: reject a write batch touching more cells than this. */
export const SPREADSHEET_MAX_WRITE_CELLS = 500;
/** Summary bound: reject summarizing a range wider than this. */
export const SPREADSHEET_MAX_SUMMARY_CELLS = 20_000;
/** Hard ceiling on addressable columns/rows so a bad ref cannot allocate wildly. */
export const SPREADSHEET_MAX_ROWS = 1_048_576;
export const SPREADSHEET_MAX_COLUMNS = 16_384;

/** Typed error the vault command layer maps onto a VaultError with the same code/status. */
export class SpreadsheetCellError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SpreadsheetCellError";
    this.code = code;
    this.status = status;
  }
}

type SpreadsheetCell = {
  index?: number;
  value?: unknown;
  formula?: string;
  [key: string]: unknown;
};

type SpreadsheetRow = {
  index?: number;
  cells?: SpreadsheetCell[];
  [key: string]: unknown;
};

type SpreadsheetSheet = {
  name?: string;
  rows?: SpreadsheetRow[];
  selectedRange?: string;
  activeCell?: string;
  [key: string]: unknown;
};

export interface CellAddress {
  row: number;
  col: number;
}

export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface WorksheetSummary {
  index: number;
  name: string;
  rowCount: number;
  columnCount: number;
  isActive: boolean;
}

export interface CellReadResult {
  ref: string;
  row: number;
  col: number;
  value: unknown;
  formula?: string;
}

export interface ReadRangeResult {
  sheet: { index: number; name: string };
  range: string;
  rowCount: number;
  columnCount: number;
  cellCount: number;
  nonEmptyCount: number;
  cells: CellReadResult[];
}

export interface CellWrite {
  ref: string;
  value?: unknown;
  formula?: string;
  clear?: boolean;
}

export interface AppliedWrite {
  ref: string;
  row: number;
  col: number;
  value?: unknown;
  formula?: string;
  cleared?: boolean;
}

export interface ApplyWritesResult {
  workbook: SpreadsheetWorkbook;
  sheet: { index: number; name: string };
  applied: AppliedWrite[];
}

export interface SummaryResult {
  sheet: { index: number; name: string };
  range: string;
  source: "range" | "selection" | "used";
  cellCount: number;
  nonEmptyCount: number;
  numericCount: number;
  textCount: number;
  formulaCount: number;
  sum: number | null;
  min: number | null;
  max: number | null;
  average: number | null;
  sampleCells: CellReadResult[];
}

/** Sheet selector: name (string), zero-based index (number), or default active sheet. */
export type SheetSelector = string | number | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ─── A1 addressing ──────────────────────────────────────────────────────────

/** "A" → 0, "Z" → 25, "AA" → 26. Throws on a non-alpha column token. */
export function columnLabelToIndex(label: string): number {
  const upper = label.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) {
    throw new SpreadsheetCellError("INVALID_CELL_REF", `Invalid column label: "${label}".`);
  }
  let index = 0;
  for (let i = 0; i < upper.length; i += 1) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnIndexToLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new SpreadsheetCellError("INVALID_CELL_REF", `Invalid column index: ${index}.`);
  }
  let remaining = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

/** Parse a single A1 reference (e.g. "B3") into a zero-based { row, col }. */
export function parseCellRef(ref: string): CellAddress {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!match) {
    throw new SpreadsheetCellError(
      "INVALID_CELL_REF",
      `Invalid cell reference: "${ref}". Use A1 notation like "B3".`
    );
  }
  const col = columnLabelToIndex(match[1]!);
  const row = Number.parseInt(match[2]!, 10) - 1;
  if (row < 0 || row >= SPREADSHEET_MAX_ROWS || col >= SPREADSHEET_MAX_COLUMNS) {
    throw new SpreadsheetCellError("CELL_OUT_OF_RANGE", `Cell reference out of range: "${ref}".`);
  }
  return { row, col };
}

/** Format a zero-based { row, col } as an A1 reference. */
export function formatCellRef(row: number, col: number): string {
  return `${columnIndexToLabel(col)}${row + 1}`;
}

/** Parse a range like "A1:C10" (or a single "A1") into a normalized CellRange. */
export function parseRange(range: string): CellRange {
  const trimmed = range.trim();
  const parts = trimmed.split(":");
  const [startRaw, endRaw] = parts;
  if (parts.length > 2 || !startRaw || (trimmed.includes(":") && !endRaw)) {
    throw new SpreadsheetCellError(
      "INVALID_RANGE",
      `Invalid range: "${range}". Use A1 notation like "A1:C10".`
    );
  }
  const start = parseCellRef(startRaw);
  const end = endRaw ? parseCellRef(endRaw) : start;
  return {
    startRow: Math.min(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endRow: Math.max(start.row, end.row),
    endCol: Math.max(start.col, end.col),
  };
}

export function rangeCellCount(range: CellRange): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
}

export function formatRange(range: CellRange): string {
  const start = formatCellRef(range.startRow, range.startCol);
  const end = formatCellRef(range.endRow, range.endCol);
  return start === end ? start : `${start}:${end}`;
}

// ─── Sheet / cell access ──────────────────────────────────────────────────────

// Syncfusion serializes sparse rows/cells positionally and pads empty slots with
// `null` (e.g. a workbook with an image or data cell at a high column emits nulls
// for the empty leading columns). Treat a null/undefined entry as an empty slot at
// its array position so scans and writes never dereference it (SN-223).
function effectiveIndex(entry: { index?: number } | null | undefined, position: number): number {
  return entry && typeof entry.index === "number" && Number.isFinite(entry.index) ? entry.index : position;
}

function getSheets(workbook: SpreadsheetWorkbook): SpreadsheetSheet[] {
  return Array.isArray(workbook.Workbook.sheets) ? (workbook.Workbook.sheets as SpreadsheetSheet[]) : [];
}

function activeSheetIndex(workbook: SpreadsheetWorkbook): number {
  const raw = workbook.Workbook.activeSheetIndex;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/** Resolve a sheet selector to its index, defaulting to the active sheet. */
export function resolveSheetIndex(workbook: SpreadsheetWorkbook, selector: SheetSelector): number {
  const sheets = getSheets(workbook);
  if (sheets.length === 0) {
    throw new SpreadsheetCellError("SHEET_NOT_FOUND", "Workbook has no worksheets.", 404);
  }
  if (selector === null || selector === undefined || selector === "") {
    const active = activeSheetIndex(workbook);
    return active >= 0 && active < sheets.length ? active : 0;
  }
  if (typeof selector === "number") {
    if (!Number.isInteger(selector) || selector < 0 || selector >= sheets.length) {
      throw new SpreadsheetCellError(
        "SHEET_NOT_FOUND",
        `Sheet index ${selector} is out of range (0-${sheets.length - 1}).`,
        404
      );
    }
    return selector;
  }
  const target = selector.trim().toLowerCase();
  // Allow a numeric string selector to address by index too.
  if (/^\d+$/.test(target)) {
    const asIndex = Number.parseInt(target, 10);
    if (asIndex < sheets.length) return asIndex;
  }
  const found = sheets.findIndex((sheet) => (sheet.name ?? "").trim().toLowerCase() === target);
  if (found === -1) {
    const names = sheets.map((sheet) => sheet.name ?? "").filter(Boolean).join(", ");
    throw new SpreadsheetCellError(
      "SHEET_NOT_FOUND",
      `Sheet "${selector}" not found. Available sheets: ${names || "(none)"}.`,
      404
    );
  }
  return found;
}

function sheetName(sheet: SpreadsheetSheet, index: number): string {
  return (sheet.name ?? "").trim() || `Sheet${index + 1}`;
}

/** Largest used (row, col) bounds for a sheet, i.e. the extent that holds data. */
export function usedDimensions(sheet: SpreadsheetSheet): { rowCount: number; columnCount: number } {
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  let maxRow = -1;
  let maxCol = -1;
  rows.forEach((row, rowPos) => {
    if (!row) return;
    const rowIndex = effectiveIndex(row, rowPos);
    const cells = Array.isArray(row.cells) ? row.cells : [];
    let rowHasCell = false;
    cells.forEach((cell, cellPos) => {
      if (!cell) return;
      const hasContent = cell.value !== undefined || cell.formula !== undefined;
      if (hasContent) {
        rowHasCell = true;
        maxCol = Math.max(maxCol, effectiveIndex(cell, cellPos));
      }
    });
    if (rowHasCell) {
      maxRow = Math.max(maxRow, rowIndex);
    }
  });
  return { rowCount: maxRow + 1, columnCount: maxCol + 1 };
}

function findCell(sheet: SpreadsheetSheet, row: number, col: number): SpreadsheetCell | null {
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  for (let rowPos = 0; rowPos < rows.length; rowPos += 1) {
    const currentRow = rows[rowPos];
    if (!currentRow) continue;
    if (effectiveIndex(currentRow, rowPos) === row) {
      const cells = Array.isArray(currentRow.cells) ? currentRow.cells : [];
      for (let cellPos = 0; cellPos < cells.length; cellPos += 1) {
        const cell = cells[cellPos];
        if (!cell) continue;
        if (effectiveIndex(cell, cellPos) === col) {
          return cell;
        }
      }
      return null;
    }
  }
  return null;
}

function readCellAt(sheet: SpreadsheetSheet, row: number, col: number): CellReadResult {
  const cell = findCell(sheet, row, col);
  const result: CellReadResult = {
    ref: formatCellRef(row, col),
    row,
    col,
    value: cell?.value ?? null,
  };
  if (cell?.formula !== undefined) {
    result.formula = cell.formula;
  }
  return result;
}

// ─── Public read/summary APIs ─────────────────────────────────────────────────

export function listWorksheets(workbook: SpreadsheetWorkbook): WorksheetSummary[] {
  const sheets = getSheets(workbook);
  const active = activeSheetIndex(workbook);
  return sheets.map((sheet, index) => {
    const { rowCount, columnCount } = usedDimensions(sheet);
    return {
      index,
      name: sheetName(sheet, index),
      rowCount,
      columnCount,
      isActive: index === active,
    };
  });
}

export function readCellRange(
  workbook: SpreadsheetWorkbook,
  options: { sheet?: SheetSelector; range: string }
): ReadRangeResult {
  const index = resolveSheetIndex(workbook, options.sheet);
  const sheet = getSheets(workbook)[index]!;
  const range = parseRange(options.range);
  const count = rangeCellCount(range);
  if (count > SPREADSHEET_MAX_READ_CELLS) {
    throw new SpreadsheetCellError(
      "RANGE_TOO_LARGE",
      `Range ${formatRange(range)} covers ${count} cells, over the ${SPREADSHEET_MAX_READ_CELLS}-cell read limit. Request a smaller range.`
    );
  }
  const cells: CellReadResult[] = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      const cell = readCellAt(sheet, row, col);
      if (cell.value !== null || cell.formula !== undefined) {
        cells.push(cell);
      }
    }
  }
  return {
    sheet: { index, name: sheetName(sheet, index) },
    range: formatRange(range),
    rowCount: range.endRow - range.startRow + 1,
    columnCount: range.endCol - range.startCol + 1,
    cellCount: count,
    nonEmptyCount: cells.length,
    cells,
  };
}

function resolveSummaryRange(
  sheet: SpreadsheetSheet,
  options: { range?: string; selection?: boolean }
): { range: CellRange; source: "range" | "selection" | "used" } {
  if (options.range) {
    return { range: parseRange(options.range), source: "range" };
  }
  if (options.selection) {
    const selected = typeof sheet.selectedRange === "string" ? sheet.selectedRange.trim() : "";
    if (!selected) {
      throw new SpreadsheetCellError(
        "NO_SELECTION",
        "No active selection is recorded on this sheet. Pass an explicit range instead."
      );
    }
    // Syncfusion selectedRange can be absolute ("A1:D5") or dollar-anchored; strip $.
    return { range: parseRange(selected.replace(/\$/g, "")), source: "selection" };
  }
  const { rowCount, columnCount } = usedDimensions(sheet);
  if (rowCount === 0 || columnCount === 0) {
    return { range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, source: "used" };
  }
  return {
    range: { startRow: 0, startCol: 0, endRow: rowCount - 1, endCol: columnCount - 1 },
    source: "used",
  };
}

export function summarizeCells(
  workbook: SpreadsheetWorkbook,
  options: { sheet?: SheetSelector; range?: string; selection?: boolean }
): SummaryResult {
  const index = resolveSheetIndex(workbook, options.sheet);
  const sheet = getSheets(workbook)[index]!;
  const { range, source } = resolveSummaryRange(sheet, options);
  const count = rangeCellCount(range);
  if (count > SPREADSHEET_MAX_SUMMARY_CELLS) {
    throw new SpreadsheetCellError(
      "RANGE_TOO_LARGE",
      `Range ${formatRange(range)} covers ${count} cells, over the ${SPREADSHEET_MAX_SUMMARY_CELLS}-cell summary limit. Summarize a smaller range or sheet.`
    );
  }

  let nonEmptyCount = 0;
  let numericCount = 0;
  let textCount = 0;
  let formulaCount = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const sampleCells: CellReadResult[] = [];

  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      const cell = readCellAt(sheet, row, col);
      const isEmpty = cell.value === null && cell.formula === undefined;
      if (isEmpty) continue;
      nonEmptyCount += 1;
      if (cell.formula !== undefined) formulaCount += 1;
      if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
        numericCount += 1;
        sum += cell.value;
        min = Math.min(min, cell.value);
        max = Math.max(max, cell.value);
      } else if (cell.value !== null && cell.value !== undefined) {
        textCount += 1;
      }
      if (sampleCells.length < 20) {
        sampleCells.push(cell);
      }
    }
  }

  return {
    sheet: { index, name: sheetName(sheet, index) },
    range: formatRange(range),
    source,
    cellCount: count,
    nonEmptyCount,
    numericCount,
    textCount,
    formulaCount,
    sum: numericCount > 0 ? sum : null,
    min: numericCount > 0 ? min : null,
    max: numericCount > 0 ? max : null,
    average: numericCount > 0 ? sum / numericCount : null,
    sampleCells,
  };
}

// ─── Write API ────────────────────────────────────────────────────────────────

function insertSorted<T extends { index?: number }>(
  list: T[],
  target: number,
  create: () => T
): T {
  for (let pos = 0; pos < list.length; pos += 1) {
    const entry = list[pos];
    const idx = effectiveIndex(entry, pos);
    if (idx === target) {
      // A null/undefined slot is a positional placeholder for an empty cell; replace
      // it in place so the write lands at the right column without shifting others.
      if (!entry) {
        const created = create();
        list[pos] = created;
        return created;
      }
      return entry;
    }
    if (idx > target) {
      const created = create();
      list.splice(pos, 0, created);
      return created;
    }
  }
  const created = create();
  list.push(created);
  return created;
}

function normalizeWrite(write: unknown, position: number): Required<Pick<CellWrite, "ref">> & CellWrite {
  if (!isRecord(write)) {
    throw new SpreadsheetCellError(
      "INVALID_WRITE",
      `Write #${position + 1} must be an object with a "ref" and a value/formula/clear.`
    );
  }
  const ref = write.ref;
  if (typeof ref !== "string" || !ref.trim()) {
    throw new SpreadsheetCellError("INVALID_WRITE", `Write #${position + 1} is missing a cell "ref".`);
  }
  const clear = write.clear === true;
  const hasValue = Object.prototype.hasOwnProperty.call(write, "value") && write.value !== undefined;
  const hasFormula =
    Object.prototype.hasOwnProperty.call(write, "formula") &&
    write.formula !== undefined &&
    write.formula !== null;
  const operationCount = Number(clear) + Number(hasValue) + Number(hasFormula);
  if (operationCount === 0) {
    throw new SpreadsheetCellError(
      "INVALID_WRITE",
      `Write for ${ref} must include a "value", a "formula", or "clear": true.`
    );
  }
  if (operationCount > 1) {
    throw new SpreadsheetCellError(
      "INVALID_WRITE",
      `Write for ${ref} must include exactly one of "value", "formula", or "clear": true.`
    );
  }
  if (hasFormula && typeof write.formula !== "string") {
    throw new SpreadsheetCellError("INVALID_WRITE", `Formula for ${ref} must be a string.`);
  }
  return {
    ref: ref.trim(),
    ...(hasValue ? { value: write.value } : {}),
    ...(hasFormula ? { formula: write.formula as string } : {}),
    clear,
  };
}

/**
 * Apply a bounded batch of cell writes to a deep copy of the workbook, returning
 * the new workbook plus a record of what changed. The input workbook is never
 * mutated. A formula is stored as `cell.formula` (leading "=" is ensured) with any
 * stale computed value dropped so Syncfusion recalculates on open; a scalar value
 * is stored as `cell.value` with any stale formula dropped.
 */
export function applyCellWrites(
  workbook: SpreadsheetWorkbook,
  options: { sheet?: SheetSelector; writes: unknown }
): ApplyWritesResult {
  const writes = options.writes;
  if (!Array.isArray(writes) || writes.length === 0) {
    throw new SpreadsheetCellError(
      "INVALID_WRITE",
      '"writes" must be a non-empty array of { ref, value?/formula?/clear? } entries.'
    );
  }
  if (writes.length > SPREADSHEET_MAX_WRITE_CELLS) {
    throw new SpreadsheetCellError(
      "WRITE_TOO_LARGE",
      `Write batch of ${writes.length} cells exceeds the ${SPREADSHEET_MAX_WRITE_CELLS}-cell limit. Split it into smaller batches.`
    );
  }

  const normalized = writes.map((write, position) => normalizeWrite(write, position));
  // Deep clone so the caller's workbook stays untouched until the write succeeds.
  const nextWorkbook = normalizeSpreadsheetWorkbook(
    JSON.parse(JSON.stringify(workbook))
  );
  const index = resolveSheetIndex(nextWorkbook, options.sheet);
  const sheet = getSheets(nextWorkbook)[index]! as SpreadsheetSheet;
  if (!Array.isArray(sheet.rows)) {
    sheet.rows = [];
  }
  const rows = sheet.rows;

  const applied: AppliedWrite[] = [];
  for (const write of normalized) {
    const { row, col } = parseCellRef(write.ref);
    const targetRow = insertSorted(rows, row, () => ({ index: row, cells: [] as SpreadsheetCell[] }));
    if (!Array.isArray(targetRow.cells)) {
      targetRow.cells = [];
    }
    const cell = insertSorted(targetRow.cells, col, () => ({ index: col }));

    if (write.clear && write.value === undefined && write.formula === undefined) {
      delete cell.value;
      delete cell.formula;
      applied.push({ ref: formatCellRef(row, col), row, col, cleared: true });
      continue;
    }
    if (write.formula !== undefined) {
      const formula = write.formula.startsWith("=") ? write.formula : `=${write.formula}`;
      cell.formula = formula;
      delete cell.value;
      applied.push({ ref: formatCellRef(row, col), row, col, formula });
    } else {
      cell.value = write.value;
      delete cell.formula;
      applied.push({ ref: formatCellRef(row, col), row, col, value: write.value });
    }
  }

  return {
    workbook: nextWorkbook,
    sheet: { index, name: sheetName(sheet, index) },
    applied,
  };
}
