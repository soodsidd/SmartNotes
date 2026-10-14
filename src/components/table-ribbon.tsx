"use client";

/**
 * SN-278: table ribbon + selection stats (fork photo #16).
 * Shown only while the selection is inside a table cell. No formulas.
 */
import * as React from "react";
import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { useEditorState } from "@tiptap/react";
import {
  ArrowDownUp,
  ChevronDown,
  Columns3,
  Grid2x2,
  Grid3x3,
  Hash,
  LayoutPanelTop,
  type LucideIcon,
  MoveHorizontal,
  Rows3,
  Sigma,
  SquareDashedMousePointer,
  Type,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  COLUMN_WIDTH_STEP,
  alignCellsCommand,
  clearCellContentsCommand,
  formatSelectionStats,
  getTableContext,
  moveColumnCommand,
  moveRowCommand,
  pasteTsvCommand,
  resizeColumnsCommand,
  selectCellsCommand,
  selectionMatrix,
  selectionStatsForState,
  setTableModeCommand,
  sortTableCommand,
  toTsv,
  type TableModeAttr,
} from "@/lib/table-ribbon";

type StateCommand = (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => boolean;

interface RibbonCommand {
  id: string;
  label: string;
  /** Returns whether the command can run right now. */
  can: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
  separatorBefore?: boolean;
}

function stateCommand(id: string, label: string, command: StateCommand, separatorBefore = false): RibbonCommand {
  return {
    id,
    label,
    separatorBefore,
    can: (editor) => command(editor.state, undefined),
    run: (editor) => {
      if (command(editor.state, (tr) => editor.view.dispatch(tr.scrollIntoView()))) editor.view.focus();
    },
  };
}

function chainCommand(
  id: string,
  label: string,
  name: "addRowBefore" | "addRowAfter" | "deleteRow" | "addColumnBefore" | "addColumnAfter" | "deleteColumn"
    | "mergeCells" | "splitCell" | "toggleHeaderCell" | "toggleHeaderRow" | "toggleHeaderColumn" | "deleteTable"
    | "toggleBold" | "toggleItalic" | "toggleStrike" | "unsetAllMarks",
  separatorBefore = false,
): RibbonCommand {
  return {
    id,
    label,
    separatorBefore,
    can: (editor) => (editor.can() as unknown as Record<string, () => boolean>)[name](),
    run: (editor) => {
      (editor.chain().focus() as unknown as Record<string, () => { run: () => boolean }>)[name]().run();
    },
  };
}

async function copySelectionAsTsv(editor: Editor) {
  const text = toTsv(selectionMatrix(editor.state));
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard permission denied: native Ctrl+C on a cell selection still copies TSV.
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

export const TABLE_RIBBON_TABS: { id: string; label: string; icon: LucideIcon; commands: RibbonCommand[] }[] = [
  {
    id: "rows",
    label: "Rows",
    icon: Rows3,
    commands: [
      chainCommand("row-insert-above", "Insert row above", "addRowBefore"),
      chainCommand("row-insert-below", "Insert row below", "addRowAfter"),
      stateCommand("row-move-up", "Move row up", moveRowCommand(-1), true),
      stateCommand("row-move-down", "Move row down", moveRowCommand(1)),
      chainCommand("row-delete", "Delete row", "deleteRow", true),
    ],
  },
  {
    id: "columns",
    label: "Columns",
    icon: Columns3,
    commands: [
      chainCommand("column-insert-left", "Insert column left", "addColumnBefore"),
      chainCommand("column-insert-right", "Insert column right", "addColumnAfter"),
      stateCommand("column-move-left", "Move column left", moveColumnCommand(-1), true),
      stateCommand("column-move-right", "Move column right", moveColumnCommand(1)),
      stateCommand("column-wider", "Wider column", resizeColumnsCommand(COLUMN_WIDTH_STEP), true),
      stateCommand("column-narrower", "Narrower column", resizeColumnsCommand(-COLUMN_WIDTH_STEP)),
      stateCommand("column-auto-width", "Auto width", resizeColumnsCommand(null)),
      chainCommand("column-delete", "Delete column", "deleteColumn", true),
    ],
  },
  {
    id: "cells",
    label: "Cells",
    icon: Grid2x2,
    commands: [
      chainCommand("cells-merge", "Merge cells", "mergeCells"),
      chainCommand("cells-split", "Split cell", "splitCell"),
      chainCommand("cells-header", "Toggle header cell", "toggleHeaderCell", true),
      stateCommand("cells-clear", "Clear contents", clearCellContentsCommand, true),
    ],
  },
  {
    id: "select",
    label: "Select",
    icon: SquareDashedMousePointer,
    commands: [
      stateCommand("select-cell", "Select cell", selectCellsCommand("cell")),
      stateCommand("select-row", "Select row", selectCellsCommand("row")),
      stateCommand("select-column", "Select column", selectCellsCommand("column")),
      stateCommand("select-table", "Select table", selectCellsCommand("table")),
    ],
  },
  {
    id: "format",
    label: "Format",
    icon: Type,
    commands: [
      chainCommand("format-bold", "Bold", "toggleBold"),
      chainCommand("format-italic", "Italic", "toggleItalic"),
      chainCommand("format-strike", "Strikethrough", "toggleStrike"),
      stateCommand("format-align-left", "Align left", alignCellsCommand("left"), true),
      stateCommand("format-align-center", "Align center", alignCellsCommand("center")),
      stateCommand("format-align-right", "Align right", alignCellsCommand("right")),
      chainCommand("format-clear", "Clear formatting", "unsetAllMarks", true),
    ],
  },
  {
    id: "layout",
    label: "Layout",
    icon: LayoutPanelTop,
    commands: [
      chainCommand("layout-header-row", "Header row", "toggleHeaderRow"),
      chainCommand("layout-header-column", "Header column", "toggleHeaderColumn"),
      stateCommand("layout-fit", "Fit columns to width", resizeColumnsCommand(null, true), true),
      chainCommand("layout-delete-table", "Delete table", "deleteTable", true),
    ],
  },
  {
    id: "data",
    label: "Data",
    icon: ArrowDownUp,
    commands: [
      stateCommand("data-sort-asc", "Sort A → Z", sortTableCommand("asc")),
      stateCommand("data-sort-desc", "Sort Z → A", sortTableCommand("desc")),
      {
        id: "data-copy",
        label: "Copy as tab-separated",
        separatorBefore: true,
        can: (editor) => getTableContext(editor.state) !== null,
        run: (editor) => void copySelectionAsTsv(editor),
      },
      {
        id: "data-paste",
        label: "Paste tab-separated",
        can: (editor) => getTableContext(editor.state)?.hasMergedCells === false,
        run: (editor) => void pasteTsvFromClipboard(editor),
      },
    ],
  },
];

/**
 * Fork photo #16 order: Rows · Columns · Cells · Select · Grid mode · Data mode · Format · Layout · Data · Expand table.
 * SN-308: icon-only controls with dividers between the structure, mode, format, and view groups.
 */
type RibbonEntry = { tab: string } | { mode: TableModeAttr; label: string; icon: LucideIcon } | { divider: string };
const RIBBON_ORDER: RibbonEntry[] = [
  { tab: "rows" },
  { tab: "columns" },
  { tab: "cells" },
  { tab: "select" },
  { divider: "modes" },
  { mode: "gridMode", label: "Grid mode", icon: Grid3x3 },
  { mode: "dataMode", label: "Data mode", icon: Hash },
  { divider: "format" },
  { tab: "format" },
  { tab: "layout" },
  { tab: "data" },
  { divider: "view" },
  { mode: "expanded", label: "Expand table", icon: MoveHorizontal },
];

const MODE_TITLES: Record<TableModeAttr, string> = {
  gridMode: "Grid mode: arrow keys and Enter move between cells; Shift+arrows select cells",
  dataMode: "Data mode: numbers align right with even digit widths",
  expanded: "Expand table: show this table wider than the page column",
};

function RibbonTab({
  editor,
  tab,
  testPrefix,
  mobile,
}: {
  editor: Editor;
  tab: (typeof TABLE_RIBBON_TABS)[number];
  testPrefix: string;
  mobile: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const Icon = tab.icon;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="table-ribbon__tab"
        data-testid={`${testPrefix}-tab-${tab.id}`}
        aria-label={tab.label}
        title={tab.label}
      >
        <Icon aria-hidden="true" />
        {mobile ? null : <ChevronDown className="table-ribbon__caret" aria-hidden="true" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52" data-testid={`${testPrefix}-menu-${tab.id}`} finalFocus={false}>
        {open ? tab.commands.map((command) => (
          <React.Fragment key={command.id}>
            {command.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              data-testid={`${testPrefix}-cmd-${command.id}`}
              disabled={!command.can(editor)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command.run(editor)}
            >
              {command.label}
            </DropdownMenuItem>
          </React.Fragment>
        )) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Primary pointer held anywhere in the document (mouse drag, touch, pen).
 * A ref, set in a capture listener before ProseMirror's mousedown, so renders
 * triggered by the gesture's own selection changes already see it; release
 * bumps state to re-render.
 */
function usePointerPressed(): React.RefObject<boolean> {
  const pressed = React.useRef(false);
  const [, setReleaseTick] = React.useState(0);
  React.useEffect(() => {
    const down = (event: PointerEvent) => {
      if (event.isPrimary) pressed.current = true;
    };
    const up = () => {
      if (!pressed.current) return;
      pressed.current = false;
      setReleaseTick((tick) => tick + 1);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
    };
  }, []);
  return pressed;
}

const CARET_TOP_MARGIN = 32;

function editorScrollArea(editor: Editor): HTMLElement | null {
  try {
    return editor.view.dom.closest<HTMLElement>(".editor-scroll-area");
  } catch {
    return null;
  }
}

export function TableRibbon({ editor, mobile = false }: { editor: Editor | null; mobile?: boolean }) {
  const [statsOpen, setStatsOpen] = React.useState(false);
  const view = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current || !current.isEditable) return null;
      const context = getTableContext(current.state);
      if (!context) return null;
      const stats = selectionStatsForState(current.state);
      return {
        stats: stats ? formatSelectionStats(stats) : "",
        gridMode: Boolean(context.table.attrs.gridMode),
        dataMode: Boolean(context.table.attrs.dataMode),
        expanded: Boolean(context.table.attrs.expanded),
        cellSelection: current.state.selection instanceof CellSelection,
      };
    },
  });
  // Showing or hiding the ribbon moves the page by its height. Never do that
  // mid-gesture (it breaks drag selection, SN-245); wait for pointer release.
  const pressed = usePointerPressed();
  const lastShown = React.useRef(view);
  const shown = pressed.current && Boolean(view) !== Boolean(lastShown.current) ? lastShown.current : view;
  React.useEffect(() => {
    lastShown.current = shown;
  });
  const ribbonRef = React.useRef<HTMLDivElement>(null);
  const isShown = Boolean(editor && shown);
  // Keep the content still while the ribbon pushes it down; undo on hide or unmount.
  React.useLayoutEffect(() => {
    if (!editor || !isShown) return;
    const ribbon = ribbonRef.current;
    const scroller = editorScrollArea(editor);
    if (!ribbon || !scroller || ribbon.offsetHeight === 0) return;
    const shift = ribbon.offsetHeight + parseFloat(getComputedStyle(ribbon).marginTop || "0");
    // Never scroll the active cell up under the ribbon: keep it at least one line below the top.
    let caretTop = Number.POSITIVE_INFINITY;
    try {
      caretTop = editor.view.coordsAtPos(editor.state.selection.head).top;
    } catch {
      // No layout (detached view): compensate fully.
    }
    const room = caretTop - scroller.getBoundingClientRect().top - CARET_TOP_MARGIN;
    const before = scroller.scrollTop;
    scroller.scrollTop += Math.max(0, Math.min(shift, room));
    const applied = scroller.scrollTop - before;
    return () => {
      scroller.scrollTop -= applied;
    };
  }, [editor, isShown]);

  if (!editor || !shown) return null;
  const testPrefix = mobile ? "table-ribbon-mobile" : "table-ribbon";
  return (
    <div
      className={mobile ? "table-ribbon table-ribbon--mobile" : "table-ribbon table-ribbon--desktop"}
      ref={ribbonRef}
      data-testid={testPrefix}
      role="toolbar"
      aria-label="Table"
    >
      <div className="table-ribbon__tabs">
        {RIBBON_ORDER.map((entry) => {
          if ("divider" in entry) {
            return <span key={`divider-${entry.divider}`} className="table-ribbon__divider" role="separator" aria-hidden="true" />;
          }
          if ("tab" in entry) {
            const tab = TABLE_RIBBON_TABS.find((candidate) => candidate.id === entry.tab)!;
            return <RibbonTab key={tab.id} editor={editor} tab={tab} testPrefix={testPrefix} mobile={mobile} />;
          }
          const modeOn = shown[entry.mode];
          const Icon = entry.icon;
          return (
            <button
              key={entry.mode}
              type="button"
              className="table-ribbon__pill"
              aria-pressed={modeOn}
              aria-label={entry.label}
              title={MODE_TITLES[entry.mode]}
              data-testid={`${testPrefix}-mode-${entry.mode}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setTableModeCommand(entry.mode, !modeOn)(editor.state, editor.view.dispatch)}
            >
              <Icon aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {mobile ? (
        <button
          type="button"
          className="table-ribbon__stats-chip"
          aria-expanded={statsOpen}
          aria-label={statsOpen ? "Hide selection stats" : "Show selection stats"}
          data-testid={`${testPrefix}-stats-toggle`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setStatsOpen((open) => !open)}
        >
          <Sigma aria-hidden="true" />
          <span>{shortSum(shown.stats)}</span>
        </button>
      ) : null}
      {!mobile || statsOpen ? (
        <div className="table-ribbon__stats" data-testid={`${testPrefix}-stats`} aria-live="polite">
          {shown.stats}
        </div>
      ) : null}
    </div>
  );
}

/** Compact chip text for the mobile Σ toggle: the selection's Sum, else its Count. */
export function shortSum(stats: string): string {
  const sum = /Sum:\s*([^|]+)/.exec(stats)?.[1]?.trim();
  if (sum && sum !== "-") return sum;
  const count = /Count:\s*([^|]+)/.exec(stats)?.[1]?.trim();
  return count ?? "";
}
