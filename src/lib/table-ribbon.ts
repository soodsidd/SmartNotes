/**
 * SN-278: table ribbon commands, per-table modes, and selection stats.
 *
 * Excel-like editing on stock TipTap tables. No formula engine: cell text is
 * only ever read as a literal number for stats, sorting, and Data mode.
 */
import { Extension, type Editor } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  CellSelection,
  TableMap,
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  cellAround,
  moveTableColumn,
  moveTableRow,
  nextCell,
  selectedRect,
} from "@tiptap/pm/tables";

// ── Pure helpers ────────────────────────────────────────────────────────────

const NUMBER_PATTERN = /^([-+]?)\$?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(%?)$/;

/** Literal number in a cell, or null. Accepts 1,234.5, $12, -3, .5 and 45% (= 0.45). */
export function parseCellNumber(text: string): number | null {
  const trimmed = text.trim().replace(/^\((.*)\)$/, "-$1");
  const match = NUMBER_PATTERN.exec(trimmed);
  if (!match) return null;
  const value = Number(`${match[1]}${match[2].replace(/,/g, "")}`);
  if (!Number.isFinite(value)) return null;
  return match[3] ? value / 100 : value;
}

export interface SelectionStats {
  count: number;
  numbers: number;
  sum: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
}

/** Count is every selected cell (blank included, as in fork photo #16); the rest use numeric cells only. */
export function computeSelectionStats(texts: string[]): SelectionStats {
  const values = texts.map(parseCellNumber).filter((value): value is number => value !== null);
  if (values.length === 0) {
    return { count: texts.length, numbers: 0, sum: null, average: null, min: null, max: null };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: texts.length,
    numbers: values.length,
    sum,
    average: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function formatStat(value: number | null): string {
  if (value === null) return "-";
  return String(Number(value.toPrecision(12)));
}

export function formatSelectionStats(stats: SelectionStats): string {
  return [
    `Count: ${stats.count}`,
    `Numbers: ${stats.numbers}`,
    `Sum: ${formatStat(stats.sum)}`,
    `Average: ${formatStat(stats.average)}`,
    `Min: ${formatStat(stats.min)}`,
    `Max: ${formatStat(stats.max)}`,
  ].join(" | ");
}

/** Tab-separated rows (what spreadsheets put on the clipboard). */
export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return lines.map((line) => line.split("\t"));
}

export function looksLikeTsv(text: string): boolean {
  return text.includes("\t");
}

export function toTsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

/** Sort comparator: blanks last, numbers before text, numbers numerically, text naturally. */
export function compareCellText(a: string, b: string): number {
  const aBlank = a.trim() === "";
  const bBlank = b.trim() === "";
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
  const aNum = parseCellNumber(a);
  const bNum = parseCellNumber(b);
  if (aNum !== null && bNum !== null) return aNum - bNum;
  if (aNum !== null) return -1;
  if (bNum !== null) return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// ── Table context ───────────────────────────────────────────────────────────

export type TableModeAttr = "gridMode" | "dataMode" | "expanded";
export const TABLE_MODE_ATTRS: Record<TableModeAttr, string> = {
  gridMode: "data-grid-mode",
  dataMode: "data-data-mode",
  expanded: "data-expanded",
};
export const COLUMN_WIDTH_STEP = 40;
export const COLUMN_MIN_WIDTH = 48;
export const COLUMN_DEFAULT_WIDTH = 120;

export interface TableContext {
  table: ProseMirrorNode;
  tablePos: number;
  tableStart: number;
  map: TableMap;
  rect: { left: number; top: number; right: number; bottom: number };
  /** Cell nodes in the selection (single active cell for a caret). */
  cells: ProseMirrorNode[];
  hasMergedCells: boolean;
}

export function getTableContext(state: EditorState): TableContext | null {
  const { selection } = state;
  const $cell = selection instanceof CellSelection ? selection.$headCell : cellAround(selection.$head);
  if (!$cell) return null;
  const rect = selectedRect(state);
  const tableStart = rect.tableStart;
  const tablePos = tableStart - 1;
  const table = rect.table;
  const cells: ProseMirrorNode[] = [];
  if (selection instanceof CellSelection) {
    selection.forEachCell((node) => cells.push(node));
  } else {
    const node = state.doc.nodeAt($cell.pos);
    if (node) cells.push(node);
  }
  let hasMergedCells = false;
  table.descendants((node) => {
    if ((node.attrs.colspan ?? 1) > 1 || (node.attrs.rowspan ?? 1) > 1) hasMergedCells = true;
    return !hasMergedCells && node.type.spec.tableRole !== "cell" && node.type.spec.tableRole !== "header_cell";
  });
  return {
    table,
    tablePos,
    tableStart,
    map: rect.map,
    rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    cells,
    hasMergedCells,
  };
}

export function selectionStatsForState(state: EditorState): SelectionStats | null {
  const context = getTableContext(state);
  if (!context) return null;
  return computeSelectionStats(context.cells.map((cell) => cell.textContent));
}

/** Rectangle of cell texts for the current selection (merged cells appear once). */
export function selectionMatrix(state: EditorState): string[][] {
  const context = getTableContext(state);
  if (!context) return [];
  const { map, rect, table } = context;
  const rows: string[][] = [];
  for (let row = rect.top; row < rect.bottom; row++) {
    const texts: string[] = [];
    for (let col = rect.left; col < rect.right; col++) {
      const offset = map.map[row * map.width + col];
      const firstSeen = map.map.indexOf(offset) === row * map.width + col;
      texts.push(firstSeen ? table.nodeAt(offset)?.textContent ?? "" : "");
    }
    rows.push(texts);
  }
  return rows;
}

function tableGrid(table: ProseMirrorNode): ProseMirrorNode[][] {
  const grid: ProseMirrorNode[][] = [];
  table.forEach((row) => {
    const cells: ProseMirrorNode[] = [];
    row.forEach((cell) => cells.push(cell));
    grid.push(cells);
  });
  return grid;
}

function cellWithText(cell: ProseMirrorNode, schema: Schema, text: string): ProseMirrorNode {
  const paragraph = schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  return cell.type.create(cell.attrs, paragraph, cell.marks);
}

function headerRowCount(table: ProseMirrorNode): number {
  let count = 0;
  for (let index = 0; index < table.childCount; index++) {
    const row = table.child(index);
    let allHeaders = row.childCount > 0;
    row.forEach((cell) => {
      if (cell.type.spec.tableRole !== "header_cell") allHeaders = false;
    });
    if (!allHeaders) break;
    count++;
  }
  return count;
}

/** New table with body rows sorted by `column`; header rows stay on top. Requires no merged cells. */
export function sortTableNode(table: ProseMirrorNode, column: number, direction: "asc" | "desc"): ProseMirrorNode {
  const headers = headerRowCount(table);
  const rows: ProseMirrorNode[] = [];
  table.forEach((row) => rows.push(row));
  const body = rows.slice(headers).map((row, index) => ({ row, index }));
  body.sort((a, b) => {
    const result = compareCellText(
      a.row.maybeChild(column)?.textContent ?? "",
      b.row.maybeChild(column)?.textContent ?? "",
    );
    const blankA = (a.row.maybeChild(column)?.textContent ?? "").trim() === "";
    const blankB = (b.row.maybeChild(column)?.textContent ?? "").trim() === "";
    const ordered = direction === "desc" && !blankA && !blankB ? -result : result;
    return ordered || a.index - b.index;
  });
  return table.copy(Fragment.fromArray([...rows.slice(0, headers), ...body.map((entry) => entry.row)]));
}

/**
 * New table with `data` written from (row, col), growing rows/columns as needed.
 * Requires no merged cells. New cells copy the cell type of their row's last cell.
 */
export function fillTableNode(
  table: ProseMirrorNode,
  schema: Schema,
  startRow: number,
  startCol: number,
  data: string[][],
): ProseMirrorNode {
  const grid = tableGrid(table);
  const width = Math.max(grid[0]?.length ?? 0, startCol + Math.max(...data.map((row) => row.length)));
  const height = Math.max(grid.length, startRow + data.length);
  const rowType = table.firstChild?.type ?? schema.nodes.tableRow;
  const blankCell = schema.nodes.tableCell.createAndFill()!;
  const rows: ProseMirrorNode[] = [];
  for (let r = 0; r < height; r++) {
    const existing = grid[r] ?? [];
    const cells: ProseMirrorNode[] = [];
    for (let c = 0; c < width; c++) {
      let cell = existing[c] ?? blankCell;
      const value = data[r - startRow]?.[c - startCol];
      if (value !== undefined) cell = cellWithText(cell, schema, value);
      cells.push(cell);
    }
    rows.push(rowType.create(table.maybeChild(r)?.attrs ?? null, cells));
  }
  return table.copy(Fragment.fromArray(rows));
}

function cellPositions(table: ProseMirrorNode, tableStart: number, row: number, col: number): number {
  return tableStart + TableMap.get(table).positionAt(row, col, table);
}

// ── Commands (all return false when not applicable) ─────────────────────────

type Dispatch = ((tr: Transaction) => void) | undefined;

function run(editor: Editor, command: (state: EditorState, dispatch: Dispatch) => boolean): boolean {
  const { state, view } = editor;
  const ok = command(state, (tr) => view.dispatch(tr.scrollIntoView()));
  if (ok) view.focus();
  return ok;
}

export function canRunTableCommand(editor: Editor, command: (state: EditorState, dispatch: Dispatch) => boolean): boolean {
  return command(editor.state, undefined);
}

export function setTableModeCommand(attr: TableModeAttr, value: boolean) {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const context = getTableContext(state);
    if (!context) return false;
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(context.tablePos, undefined, { ...context.table.attrs, [attr]: value }));
    }
    return true;
  };
}

export function moveRowCommand(delta: -1 | 1) {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const context = getTableContext(state);
    if (!context || context.hasMergedCells) return false;
    const from = delta < 0 ? context.rect.top : context.rect.bottom - 1;
    const to = from + delta;
    if (context.rect.bottom - context.rect.top !== 1 || to < 0 || to >= context.map.height) return false;
    return moveTableRow({ from, to, select: false })(state, dispatch);
  };
}

export function moveColumnCommand(delta: -1 | 1) {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const context = getTableContext(state);
    if (!context || context.hasMergedCells) return false;
    const from = context.rect.left;
    const to = from + delta;
    if (context.rect.right - context.rect.left !== 1 || to < 0 || to >= context.map.width) return false;
    return moveTableColumn({ from, to, select: false })(state, dispatch);
  };
}

/** Change selected columns' width by `delta` px, or clear widths when delta is null. */
export function resizeColumnsCommand(delta: number | null, allColumns = false) {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const context = getTableContext(state);
    if (!context) return false;
    const { map, table, tableStart } = context;
    const left = allColumns ? 0 : context.rect.left;
    const right = allColumns ? map.width : context.rect.right;
    const tr = state.tr;
    const seen = new Set<number>();
    let changed = false;
    for (let row = 0; row < map.height; row++) {
      for (let col = left; col < right; col++) {
        const offset = map.map[row * map.width + col];
        if (seen.has(offset)) continue;
        seen.add(offset);
        const cell = table.nodeAt(offset);
        if (!cell) continue;
        const span = cell.attrs.colspan ?? 1;
        const start = map.colCount(offset);
        const widths: (number | null)[] = Array.from({ length: span }, (_, i) => cell.attrs.colwidth?.[i] ?? null);
        const next = widths.map((width, i) => {
          const column = start + i;
          if (column < left || column >= right) return width;
          if (delta === null) return null;
          return Math.max(COLUMN_MIN_WIDTH, (width ?? COLUMN_DEFAULT_WIDTH) + delta);
        });
        const colwidth = next.every((width) => width === null) ? null : next.map((width) => width ?? 0);
        if (JSON.stringify(colwidth) === JSON.stringify(cell.attrs.colwidth ?? null)) continue;
        tr.setNodeMarkup(tableStart + offset, undefined, { ...cell.attrs, colwidth });
        changed = true;
      }
    }
    if (!changed) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

export function clearCellContentsCommand(state: EditorState, dispatch: Dispatch): boolean {
  const context = getTableContext(state);
  if (!context) return false;
  const tr = state.tr;
  const positions: { pos: number; node: ProseMirrorNode }[] = [];
  if (state.selection instanceof CellSelection) {
    state.selection.forEachCell((node, pos) => positions.push({ pos, node }));
  } else {
    const $cell = cellAround(state.selection.$head);
    const node = $cell ? state.doc.nodeAt($cell.pos) : null;
    if ($cell && node) positions.push({ pos: $cell.pos, node });
  }
  if (!positions.some(({ node }) => node.textContent !== "" || node.childCount > 1)) return false;
  for (const { pos, node } of positions.reverse()) {
    const empty = cellWithText(node, state.schema, "");
    tr.replaceWith(tr.mapping.map(pos + 1), tr.mapping.map(pos + node.nodeSize - 1), empty.content);
  }
  if (dispatch) dispatch(tr);
  return true;
}

export function alignCellsCommand(align: "left" | "center" | "right" | null) {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const context = getTableContext(state);
    if (!context) return false;
    const tr = state.tr;
    const apply = (node: ProseMirrorNode, pos: number) => {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
    };
    if (state.selection instanceof CellSelection) {
      state.selection.forEachCell(apply);
    } else {
      const $cell = cellAround(state.selection.$head);
      const node = $cell ? state.doc.nodeAt($cell.pos) : null;
      if (!$cell || !node) return false;
      apply(node, $cell.pos);
    }
    if (dispatch) dispatch(tr);
    return true;
  };
}

export function selectCellsCommand(scope: "cell" | "row" | "column" | "table") {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const context = getTableContext(state);
    if (!context) return false;
    const { table, tableStart, map, rect } = context;
    const first = (row: number, col: number) => cellPositions(table, tableStart, row, col);
    let anchor: number;
    let head: number;
    if (scope === "cell") {
      anchor = head = state.selection instanceof CellSelection ? state.selection.$headCell.pos : cellAround(state.selection.$head)!.pos;
    } else if (scope === "row") {
      anchor = first(rect.top, 0);
      head = first(rect.bottom - 1, map.width - 1);
    } else if (scope === "column") {
      anchor = first(0, rect.left);
      head = first(map.height - 1, rect.right - 1);
    } else {
      anchor = first(0, 0);
      head = first(map.height - 1, map.width - 1);
    }
    if (dispatch) dispatch(state.tr.setSelection(CellSelection.create(state.doc, anchor, head)));
    return true;
  };
}

export function tableColumnValues(table: ProseMirrorNode, column: number): string[] {
  const values = new Set<string>();
  for (let row = headerRowCount(table); row < table.childCount; row++) {
    values.add(table.child(row).maybeChild(column)?.textContent ?? "");
  }
  return [...values].sort(compareCellText);
}

export function sortHeaderColumnCommand(tablePos: number, column: number) {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type.name !== "table" || headerRowCount(table) === 0 || table.childCount - headerRowCount(table) < 2) return false;
    const map = TableMap.get(table);
    if (column >= map.width || new Set(map.map).size !== map.width * map.height) return false;
    const direction = table.attrs.sortColumn === column && table.attrs.sortDirection === "asc" ? "desc" : "asc";
    const sorted = sortTableNode(table, column, direction);
    const next = sorted.type.create({ ...sorted.attrs, sortColumn: column, sortDirection: direction }, sorted.content, sorted.marks);
    if (dispatch) {
      const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, next);
      const cellPos = cellPositions(next, tablePos + 1, 0, column);
      tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
      dispatch(tr);
    }
    return true;
  };
}

export function filterHeaderColumnCommand(tablePos: number, column: number, value: string | null) {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type.name !== "table" || headerRowCount(table) === 0 || column >= TableMap.get(table).width) return false;
    const filters = { ...(table.attrs.columnFilters as Record<string, string> ?? {}) };
    if (value === null) delete filters[column];
    else filters[column] = value;
    if (dispatch) dispatch(state.tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, columnFilters: filters }));
    return true;
  };
}

/** Grow the table at the caret and move into the new cell. */
export function growTableCommand(axis: "column" | "row") {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    if (!state.selection.empty || state.selection instanceof CellSelection) return false;
    const context = getTableContext(state);
    if (!context || (axis === "column" && context.rect.right !== context.map.width)) return false;
    const row = context.rect.top + (axis === "row" ? 1 : 0);
    const col = context.rect.left + (axis === "column" ? 1 : 0);
    const command = axis === "column" ? addColumnAfter : addRowAfter;
    return command(state, dispatch && ((tr) => {
      const table = tr.doc.nodeAt(context.tablePos);
      if (!table) return;
      const pos = cellPositions(table, context.tableStart, row, col);
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView();
      dispatch(tr);
    }));
  };
}

/** Delete whole selected rows or columns; a full-table selection removes the table. */
export function deleteSelectedTableAxisCommand(state: EditorState, dispatch: Dispatch): boolean {
  if (!(state.selection instanceof CellSelection)) return false;
  const context = getTableContext(state);
  if (!context) return false;
  const fullRows = context.rect.left === 0 && context.rect.right === context.map.width;
  const fullColumns = context.rect.top === 0 && context.rect.bottom === context.map.height;
  if (!fullRows && !fullColumns) return false;
  if (fullRows && fullColumns) return deleteTable(state, dispatch);
  return (fullColumns ? deleteColumn : deleteRow)(state, dispatch);
}

export function sortTableCommand(direction: "asc" | "desc") {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const context = getTableContext(state);
    if (!context || context.hasMergedCells || context.map.height - headerRowCount(context.table) < 2) return false;
    const sorted = sortTableNode(context.table, context.rect.left, direction);
    if (sorted.eq(context.table)) return true;
    if (dispatch) {
      const tr = state.tr.replaceWith(context.tablePos, context.tablePos + context.table.nodeSize, sorted);
      const cellPos = cellPositions(sorted, context.tableStart, Math.min(context.rect.top, sorted.childCount - 1), context.rect.left);
      tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
      dispatch(tr);
    }
    return true;
  };
}

/** Write TSV data from the selection's top-left cell, growing the table and selecting the pasted block. */
export function pasteTsvCommand(text: string) {
  return (state: EditorState, dispatch: Dispatch): boolean => {
    const context = getTableContext(state);
    const data = parseTsv(text);
    if (!context || context.hasMergedCells || data.length === 0) return false;
    const { rect, tablePos, tableStart } = context;
    const filled = fillTableNode(context.table, state.schema, rect.top, rect.left, data);
    if (dispatch) {
      const tr = state.tr.replaceWith(tablePos, tablePos + context.table.nodeSize, filled);
      const width = Math.max(...data.map((row) => row.length));
      const anchor = cellPositions(filled, tableStart, rect.top, rect.left);
      const head = cellPositions(filled, tableStart, rect.top + data.length - 1, rect.left + width - 1);
      tr.setSelection(anchor === head
        ? TextSelection.near(tr.doc.resolve(anchor + 1))
        : CellSelection.create(tr.doc, anchor, head));
      dispatch(tr);
    }
    return true;
  };
}

export function runTableCommand(editor: Editor, command: (state: EditorState, dispatch: Dispatch) => boolean): boolean {
  return run(editor, command);
}

// ── Grid mode keyboard ──────────────────────────────────────────────────────

function activeTableNode(state: EditorState): ProseMirrorNode | null {
  const $cell = state.selection instanceof CellSelection ? state.selection.$headCell : cellAround(state.selection.$head);
  if (!$cell) return null;
  return $cell.node(-1);
}

function gridModeOn(state: EditorState): boolean {
  return Boolean(activeTableNode(state)?.attrs.gridMode);
}

function moveToCell(state: EditorState, dispatch: Dispatch, axis: "horiz" | "vert", dir: -1 | 1): boolean {
  const $cell = state.selection instanceof CellSelection ? state.selection.$headCell : cellAround(state.selection.$head);
  if (!$cell) return false;
  const $next = nextCell($cell, axis, dir);
  if (!$next) return state.selection instanceof CellSelection;
  const cell = $next.nodeAfter!;
  if (dispatch) {
    const end = $next.pos + cell.nodeSize - 1;
    dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(end), -1)).scrollIntoView());
  }
  return true;
}

function extendCellSelection(state: EditorState, dispatch: Dispatch, axis: "horiz" | "vert", dir: -1 | 1): boolean {
  const selection = state.selection;
  const $anchor = selection instanceof CellSelection ? selection.$anchorCell : cellAround(selection.$head);
  const $head = selection instanceof CellSelection ? selection.$headCell : $anchor;
  if (!$anchor || !$head) return false;
  const $next = nextCell($head, axis, dir);
  if (!$next) return true;
  if (dispatch) dispatch(state.tr.setSelection(new CellSelection($anchor, $next)).scrollIntoView());
  return true;
}

function caretAtCellEdge(state: EditorState, side: -1 | 1): boolean {
  const { selection } = state;
  if (selection instanceof CellSelection) return true;
  if (!selection.empty) return false;
  const $cell = cellAround(selection.$head);
  if (!$cell) return false;
  const cell = $cell.nodeAfter!;
  const edge = side < 0
    ? TextSelection.near(state.doc.resolve($cell.pos + 1), 1).from
    : TextSelection.near(state.doc.resolve($cell.pos + cell.nodeSize - 1), -1).from;
  return selection.head === edge;
}

/**
 * Per-table modes and Excel-like behaviour: grid-mode keys, numeric cells in
 * Data mode, TSV clipboard for cell selections, and TSV paste into cells.
 */
export const TableRibbonSupport = Extension.create({
  name: "tableRibbonSupport",
  priority: 150,

  addGlobalAttributes() {
    const modeAttr = (attr: TableModeAttr) => ({
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute(TABLE_MODE_ATTRS[attr]) === "true",
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes[attr] ? { [TABLE_MODE_ATTRS[attr]]: "true" } : {},
    });
    return [
      {
        types: ["table"],
        attributes: {
          gridMode: modeAttr("gridMode"), dataMode: modeAttr("dataMode"), expanded: modeAttr("expanded"),
          columnFilters: {
            default: {},
            parseHTML: (element: HTMLElement) => {
              try {
                const value = JSON.parse(element.getAttribute("data-column-filters") || "{}");
                return value && typeof value === "object" && !Array.isArray(value) ? value : {};
              } catch { return {}; }
            },
            renderHTML: (attributes: Record<string, unknown>) => Object.keys(attributes.columnFilters as object ?? {}).length
              ? { "data-column-filters": JSON.stringify(attributes.columnFilters) } : {},
          },
          sortColumn: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.getAttribute("data-sort-column");
              if (raw === null) return null;
              const value = Number(raw);
              return Number.isInteger(value) && value >= 0 ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => attributes.sortColumn !== null
              ? { "data-sort-column": String(attributes.sortColumn) } : {},
          },
          sortDirection: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-sort-direction");
              return value === "asc" || value === "desc" ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => attributes.sortDirection
              ? { "data-sort-direction": attributes.sortDirection } : {},
          },
        },
      },
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          align: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-align");
              return value === "left" || value === "center" || value === "right" ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.align ? { "data-align": attributes.align } : {},
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    const grid = (fn: (state: EditorState, dispatch: Dispatch) => boolean) => () => {
      const { state, view } = this.editor;
      if (!gridModeOn(state)) return false;
      return fn(state, view.dispatch);
    };
    return {
      Delete: () => deleteSelectedTableAxisCommand(this.editor.state, this.editor.view.dispatch),
      Tab: () => growTableCommand("column")(this.editor.state, this.editor.view.dispatch),
      ArrowUp: grid((state, dispatch) => moveToCell(state, dispatch, "vert", -1)),
      ArrowDown: grid((state, dispatch) => moveToCell(state, dispatch, "vert", 1)),
      ArrowLeft: grid((state, dispatch) => caretAtCellEdge(state, -1) && moveToCell(state, dispatch, "horiz", -1)),
      ArrowRight: grid((state, dispatch) => caretAtCellEdge(state, 1) && moveToCell(state, dispatch, "horiz", 1)),
      Enter: () => growTableCommand("row")(this.editor.state, this.editor.view.dispatch),
      "Shift-Enter": grid((state, dispatch) => moveToCell(state, dispatch, "vert", -1)),
      "Shift-ArrowUp": grid((state, dispatch) => extendCellSelection(state, dispatch, "vert", -1)),
      "Shift-ArrowDown": grid((state, dispatch) => extendCellSelection(state, dispatch, "vert", 1)),
      "Shift-ArrowLeft": grid((state, dispatch) => extendCellSelection(state, dispatch, "horiz", -1)),
      "Shift-ArrowRight": grid((state, dispatch) => extendCellSelection(state, dispatch, "horiz", 1)),
    };
  },

  addProseMirrorPlugins() {
    const numericKey = new PluginKey<DecorationSet>("tableDataModeNumbers");
    const numericDecorations = (doc: ProseMirrorNode) => {
      const decorations: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (node.type.name !== "table") return true;
        const width = node.firstChild?.childCount ?? 0;
        // Ignore filters for columns that no longer exist (e.g. after a column delete).
        const filters = Object.entries(node.attrs.columnFilters as Record<string, string> ?? {})
          .filter(([column]) => Number.isInteger(Number(column)) && Number(column) < width);
        if (filters.length) {
          let rowPos = pos + 1;
          for (let row = 0; row < node.childCount; row++) {
            const rowNode = node.child(row);
            if (row >= headerRowCount(node) && filters.some(([column, value]) => rowNode.maybeChild(Number(column))?.textContent !== value)) {
              decorations.push(Decoration.node(rowPos, rowPos + rowNode.nodeSize, { style: "display: none" }));
            }
            rowPos += rowNode.nodeSize;
          }
        }
        if (!node.attrs.dataMode) return false;
        node.descendants((cell, offset) => {
          const role = cell.type.spec.tableRole;
          if (role !== "cell" && role !== "header_cell") return true;
          if (parseCellNumber(cell.textContent) !== null) {
            decorations.push(Decoration.node(pos + 1 + offset, pos + 1 + offset + cell.nodeSize, { class: "numericCell" }));
          }
          return false;
        });
        return false;
      });
      return DecorationSet.create(doc, decorations);
    };
    return [
      new Plugin<DecorationSet>({
        key: numericKey,
        state: {
          init: (_, state) => numericDecorations(state.doc),
          apply: (tr, value) => (tr.docChanged ? numericDecorations(tr.doc) : value),
        },
        props: {
          decorations: (state) => numericKey.getState(state),
          clipboardTextSerializer: (_slice, view) => {
            if (!(view.state.selection instanceof CellSelection)) return "";
            return toTsv(selectionMatrix(view.state));
          },
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const html = event.clipboardData?.getData("text/html") ?? "";
            if (!looksLikeTsv(text) || /<table[\s>]/i.test(html)) return false;
            if (!getTableContext(view.state)) return false;
            return pasteTsvCommand(text)(view.state, view.dispatch);
          },
        },
      }),
    ];
  },
});
