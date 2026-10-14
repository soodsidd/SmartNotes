/**
 * SN-308: context-aware right-click (long-press on mobile) menu inside tables.
 *
 * Pure layout lives in `tableContextMenuLayout` so the "which items show for
 * this selection" rules are unit-testable without a live editor. Commands are
 * the same ones the SN-278 table ribbon runs.
 */
import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { EditorContextMenuAction } from "@/lib/editor-context-menu";
import {
  alignCellsCommand,
  clearCellContentsCommand,
  getTableContext,
  pasteTsvCommand,
  selectCellsCommand,
  selectionMatrix,
  sortTableCommand,
  toTsv,
} from "@/lib/table-ribbon";

export type TableMenuItemId =
  | "copy"
  | "paste"
  | "pasteTable"
  | "rowAbove"
  | "rowBelow"
  | "colLeft"
  | "colRight"
  | "deleteRow"
  | "deleteCol"
  | "merge"
  | "split"
  | "headerRow"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "sortAsc"
  | "sortDesc"
  | "clear"
  | "selectRow"
  | "selectCol"
  | "selectTable"
  | "comment"
  | "deleteTable";

/** Facts about the current table selection that decide which items appear. */
export interface TableMenuState {
  /** Rows / columns covered by the selection (1 x 1 for a caret). */
  selectedRows: number;
  selectedCols: number;
  canMerge: boolean;
  canSplit: boolean;
  /** Selection touches the table's first row (header-row toggle is offered there). */
  inFirstRow: boolean;
  headerRowOn: boolean;
  canSort: boolean;
  canPasteTable: boolean;
  canComment: boolean;
}

/**
 * Groups of item ids to render, in order. Items that do not apply to the
 * selection are omitted rather than shown disabled, so the menu stays short.
 */
export function tableContextMenuLayout(state: TableMenuState, mobile: boolean): TableMenuItemId[][] {
  const conditional: TableMenuItemId[] = [];
  if (state.canMerge) conditional.push("merge");
  if (state.canSplit) conditional.push("split");
  if (state.inFirstRow) conditional.push("headerRow");

  const groups: TableMenuItemId[][] = [
    state.canPasteTable ? ["copy", "paste", "pasteTable"] : ["copy", "paste"],
    ["rowAbove", "rowBelow", "colLeft", "colRight"],
    ["deleteRow", "deleteCol"],
    conditional,
  ];
  if (!mobile) {
    groups.push(["alignLeft", "alignCenter", "alignRight"]);
  }
  groups.push(state.canSort ? ["sortAsc", "sortDesc", "clear"] : ["clear"]);
  if (!mobile) {
    groups.push(["selectRow", "selectCol", "selectTable"]);
  }
  if (state.canComment) groups.push(["comment"]);
  groups.push(["deleteTable"]);
  return groups.filter((group) => group.length > 0);
}

function plural(count: number, one: string, many: string): string {
  return count > 1 ? `${count} ${many}` : one;
}

export function tableMenuLabel(id: TableMenuItemId, state: TableMenuState): string {
  switch (id) {
    case "copy": return "Copy";
    case "paste": return "Paste";
    case "pasteTable": return "Paste as table cells";
    case "rowAbove": return "Insert row above";
    case "rowBelow": return "Insert row below";
    case "colLeft": return "Insert column left";
    case "colRight": return "Insert column right";
    case "deleteRow": return state.selectedRows > 1 ? `Delete ${plural(state.selectedRows, "row", "rows")}` : "Delete row";
    case "deleteCol": return state.selectedCols > 1 ? `Delete ${plural(state.selectedCols, "column", "columns")}` : "Delete column";
    case "merge": return "Merge cells";
    case "split": return "Split cell";
    case "headerRow": return state.headerRowOn ? "Remove header row" : "Make header row";
    case "alignLeft": return "Align left";
    case "alignCenter": return "Align center";
    case "alignRight": return "Align right";
    case "sortAsc": return "Sort column A → Z";
    case "sortDesc": return "Sort column Z → A";
    case "clear": return "Clear contents";
    case "selectRow": return "Select row";
    case "selectCol": return "Select column";
    case "selectTable": return "Select table";
    case "comment": return "Add comment";
    case "deleteTable": return "Delete table";
  }
}

type Dispatch = ((tr: Transaction) => void) | undefined;
type StateCommand = (state: EditorState, dispatch: Dispatch) => boolean;

/** Read the facts for `tableContextMenuLayout` off a live editor. Null outside tables. */
export function tableMenuStateFor(editor: Editor, canComment: boolean, canPasteTable: boolean): TableMenuState | null {
  const context = getTableContext(editor.state);
  if (!context) return null;
  const can = editor.can() as unknown as Record<string, () => boolean>;
  const firstRow = context.table.firstChild;
  let headerRowOn = false;
  if (firstRow && firstRow.childCount > 0) {
    headerRowOn = true;
    firstRow.forEach((cell) => {
      if (cell.type.spec.tableRole !== "header_cell") headerRowOn = false;
    });
  }
  return {
    selectedRows: context.rect.bottom - context.rect.top,
    selectedCols: context.rect.right - context.rect.left,
    canMerge: safe(() => can.mergeCells()),
    canSplit: safe(() => can.splitCell()),
    inFirstRow: context.rect.top === 0,
    headerRowOn,
    canSort: sortTableCommand("asc")(editor.state, undefined),
    canPasteTable: canPasteTable && !context.hasMergedCells,
    canComment,
  };
}

function safe(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

export interface TableMenuHandlers {
  onCopy: () => void;
  onPaste: () => void;
  onAddComment: () => void;
}

/** Build the rendered groups of actions for the table context menu. */
export function buildTableContextMenuGroups(
  editor: Editor,
  state: TableMenuState,
  mobile: boolean,
  handlers: TableMenuHandlers,
): EditorContextMenuAction[][] {
  const runState = (command: StateCommand) => () => {
    if (command(editor.state, (tr) => editor.view.dispatch(tr.scrollIntoView()))) editor.view.focus();
  };
  const runChain = (name: string) => () => {
    (editor.chain().focus() as unknown as Record<string, () => { run: () => boolean }>)[name]().run();
  };

  const runners: Record<TableMenuItemId, () => void> = {
    copy: () => {
      if (editor.state.selection instanceof CellSelection) {
        void copyCellsAsTsv(editor);
      } else {
        handlers.onCopy();
      }
    },
    paste: () => handlers.onPaste(),
    pasteTable: () => void pasteTsvFromClipboard(editor),
    rowAbove: runChain("addRowBefore"),
    rowBelow: runChain("addRowAfter"),
    colLeft: runChain("addColumnBefore"),
    colRight: runChain("addColumnAfter"),
    deleteRow: runChain("deleteRow"),
    deleteCol: runChain("deleteColumn"),
    merge: runChain("mergeCells"),
    split: runChain("splitCell"),
    headerRow: runChain("toggleHeaderRow"),
    alignLeft: runState(alignCellsCommand("left")),
    alignCenter: runState(alignCellsCommand("center")),
    alignRight: runState(alignCellsCommand("right")),
    sortAsc: runState(sortTableCommand("asc")),
    sortDesc: runState(sortTableCommand("desc")),
    clear: runState(clearCellContentsCommand),
    selectRow: runState(selectCellsCommand("row")),
    selectCol: runState(selectCellsCommand("column")),
    selectTable: runState(selectCellsCommand("table")),
    comment: () => handlers.onAddComment(),
    deleteTable: runChain("deleteTable"),
  };

  return tableContextMenuLayout(state, mobile).map((group) =>
    group.map((id) => ({
      id: `table-${id}`,
      label: tableMenuLabel(id, state),
      testId: `ctx-table-${id}`,
      destructive: id === "deleteTable",
      run: runners[id],
    })),
  );
}

async function copyCellsAsTsv(editor: Editor) {
  try {
    await navigator.clipboard.writeText(toTsv(selectionMatrix(editor.state)));
  } catch {
    // Clipboard blocked: Ctrl+C on a cell selection still copies TSV natively.
  }
  editor.view.focus();
}

async function pasteTsvFromClipboard(editor: Editor) {
  try {
    const text = await navigator.clipboard.readText();
    if (text && pasteTsvCommand(text)(editor.state, editor.view.dispatch)) editor.view.focus();
  } catch {
    // Clipboard read blocked: Ctrl+V into a cell still pastes TSV via the editor paste handler.
  }
}

/**
 * Right-click does not move the ProseMirror selection. Before opening the
 * table menu, put the caret in the clicked cell unless the click landed inside
 * the current selection (so a multi-cell selection survives right-click).
 * Returns true when the click target is a table cell in this editor.
 */
export function focusClickedTableCell(editor: Editor, target: Element | null, clientX: number, clientY: number): boolean {
  const cell = target?.closest("td, th");
  if (!cell || !editor.view.dom.contains(cell)) return false;
  const hit = editor.view.posAtCoords({ left: clientX, top: clientY });
  if (!hit) return true;
  const { selection } = editor.state;
  let inside = false;
  if (selection instanceof CellSelection) {
    selection.forEachCell((node, pos) => {
      if (hit.pos > pos && hit.pos < pos + node.nodeSize) inside = true;
    });
  } else {
    inside = !selection.empty && hit.pos >= selection.from && hit.pos <= selection.to;
  }
  if (!inside) {
    const $pos = editor.state.doc.resolve(hit.pos);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));
  }
  return true;
}
