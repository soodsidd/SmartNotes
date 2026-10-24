"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";
import { ArrowDownUp, ListFilter } from "lucide-react";
import { filterHeaderColumnCommand, sortHeaderColumnCommand, tableColumnValues } from "@/lib/table-ribbon";

/** Desktop toolbar height: 28px button + 2px padding x2 + 1px border x2. */
const TOOLS_HEIGHT_PX = 34;

interface HeaderAnchor {
  cell: HTMLTableCellElement;
  tablePos: number;
  column: number;
  rect: DOMRect;
}

/** Pointer affordances for the first header row. The portal stays outside editable table markup. */
export function TableHeaderTools({ editor }: { editor: Editor | null }) {
  const [anchor, setAnchor] = React.useState<HeaderAnchor | null>(null);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const hideTimer = React.useRef<number | null>(null);

  const cancelHide = React.useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);
  const hideSoon = React.useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      if (!filterOpen) setAnchor(null);
    }, 120);
  }, [cancelHide, filterOpen]);

  React.useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const onPointerOver = (event: PointerEvent) => {
      const cell = event.target instanceof Element ? event.target.closest("th") : null;
      const tableElement = cell?.closest("table");
      if (!(cell instanceof HTMLTableCellElement) || !root.contains(cell)
        || !(tableElement instanceof HTMLTableElement) || cell.parentElement !== tableElement.rows[0]) {
        hideSoon();
        return;
      }
      const $pos = editor.state.doc.resolve(editor.view.posAtDOM(cell, 0));
      let tablePos = -1;
      for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type.name === "table") { tablePos = $pos.before(depth); break; }
      }
      if (tablePos < 0) return;
      const table = editor.state.doc.nodeAt(tablePos);
      if (!table || table.childCount < 2) return;
      const map = TableMap.get(table);
      if (new Set(map.map).size !== map.width * map.height) return;
      cancelHide();
      setAnchor((current) => current?.cell === cell ? current : {
        cell, tablePos, column: cell.cellIndex, rect: cell.getBoundingClientRect(),
      });
      if (anchor?.cell !== cell) setFilterOpen(false);
    };
    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerleave", hideSoon);
    return () => {
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerleave", hideSoon);
      cancelHide();
    };
  }, [editor, cancelHide, hideSoon, anchor?.cell]);

  React.useEffect(() => {
    if (!anchor) return;
    const update = () => {
      if (!anchor.cell.isConnected) { setAnchor(null); return; }
      setAnchor((current) => current ? { ...current, rect: current.cell.getBoundingClientRect() } : null);
    };
    const outside = (event: PointerEvent) => {
      if (toolsRef.current?.contains(event.target as Node) || anchor.cell.contains(event.target as Node)) return;
      setFilterOpen(false);
      setAnchor(null);
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      document.removeEventListener("pointerdown", outside);
    };
  }, [anchor?.cell]);

  if (!editor || !anchor) return null;
  const table = editor.state.doc.nodeAt(anchor.tablePos);
  if (!table || table.type.name !== "table") return null;
  const values = tableColumnValues(table, anchor.column);
  const currentValue = (table.attrs.columnFilters as Record<string, string> ?? {})[anchor.column];
  const label = anchor.cell.textContent?.trim() || `Column ${anchor.column + 1}`;
  const left = Math.max(0, Math.min(anchor.rect.right, window.innerWidth));
  // Tools render above the header (translateY(-100%)); keep them on-screen near the viewport top.
  const top = Math.max(TOOLS_HEIGHT_PX, anchor.rect.top);
  const run = (command: ReturnType<typeof sortHeaderColumnCommand>) => {
    command(editor.state, editor.view.dispatch);
    setAnchor(null);
    setFilterOpen(false);
  };
  const filter = (value: string | null) => {
    filterHeaderColumnCommand(anchor.tablePos, anchor.column, value)(editor.state, editor.view.dispatch);
    setAnchor((current) => current ? { ...current } : null);
    setFilterOpen(false);
  };

  return createPortal(
    <div ref={toolsRef} className="table-header-tools" style={{ left, top }} onPointerEnter={cancelHide} onPointerLeave={hideSoon} onPointerDown={(event) => event.preventDefault()}>
      <div className="table-header-tools__buttons">
        <button type="button" aria-label={`Sort ${label} column`} title={`Sort ${label} column`} data-testid="table-header-sort" data-active={table.attrs.sortColumn === anchor.column || undefined} onClick={() => run(sortHeaderColumnCommand(anchor.tablePos, anchor.column))}>
          <ArrowDownUp aria-hidden="true" />
        </button>
        <button type="button" aria-label={`Filter ${label} column`} title={`Filter ${label} column`} data-testid="table-header-filter" data-active={currentValue !== undefined || undefined} aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}>
          <ListFilter aria-hidden="true" />
        </button>
      </div>
      {filterOpen ? <div className="table-header-tools__menu" role="menu" aria-label={`Filter ${label} column`} data-testid="table-header-filter-menu">
        <button type="button" role="menuitemradio" aria-checked={currentValue === undefined} onClick={() => filter(null)}>All rows</button>
        {values.map((value, index) => <button key={value} type="button" role="menuitemradio" aria-checked={currentValue === value} data-testid={`table-filter-option-${index}`} onClick={() => filter(value)}>{value || "(Blank)"}</button>)}
      </div> : null}
    </div>,
    document.body,
  );
}
