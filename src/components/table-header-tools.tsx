"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";
import { ArrowDownUp, ListFilter } from "lucide-react";
import { filterHeaderColumnCommand, sortHeaderColumnCommand, tableColumnValues } from "@/lib/table-ribbon";

interface HeaderAnchor {
  cell: HTMLTableCellElement;
  tablePos: number;
  column: number;
  rect: DOMRect;
}

/**
 * Pixels kept clear at the header's right edge for the column-resize divider. prosemirror-tables
 * probes posAtCoords handleWidth (8px) inward from the pointer to find the edge cell; if that point
 * lands on these tools (outside the editor) the header divider cannot be grabbed.
 */
const DIVIDER_CLEARANCE = 14;
const HIDE_DELAY_MS = 150;

function within(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Keep controls visually inside the header without mutating ProseMirror's cell DOM.
 * Visibility is one document-level pointermove hit test: the anchored header cell, the
 * tools, or the open menu keep them shown. Do not pair the editor root's native
 * pointerleave with the portal's React onPointerEnter: React dispatches the portal enter
 * before the native leave, so the hide timer is never cancelled and the tools flash in a
 * show/hide loop under a resting pointer (SN-355 rework 2).
 */
export function TableHeaderTools({ editor }: { editor: Editor | null }) {
  const [anchor, setAnchor] = React.useState<HeaderAnchor | null>(null);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const filterButtonRef = React.useRef<HTMLButtonElement>(null);
  const hideTimer = React.useRef<number | null>(null);
  const anchorRef = React.useRef<HeaderAnchor | null>(null);
  const filterOpenRef = React.useRef(false);
  anchorRef.current = anchor;
  filterOpenRef.current = filterOpen;

  const cancelHide = React.useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);
  const hideSoon = React.useCallback(() => {
    if (hideTimer.current !== null || filterOpenRef.current) return;
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      if (!filterOpenRef.current) setAnchor(null);
    }, HIDE_DELAY_MS);
  }, []);

  React.useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const headerAt = (target: EventTarget | null): HeaderAnchor | null => {
      const cell = target instanceof Element ? target.closest("th") : null;
      const tableElement = cell?.closest("table");
      if (!(cell instanceof HTMLTableCellElement) || !root.contains(cell)
        || !(tableElement instanceof HTMLTableElement) || cell.parentElement !== tableElement.rows[0]) return null;
      const $pos = editor.state.doc.resolve(editor.view.posAtDOM(cell, 0));
      let tablePos = -1;
      for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type.name === "table") { tablePos = $pos.before(depth); break; }
      }
      const table = tablePos < 0 ? null : editor.state.doc.nodeAt(tablePos);
      if (!table) return null;
      const map = TableMap.get(table);
      if (new Set(map.map).size !== map.width * map.height) return null;
      return { cell, tablePos, column: cell.cellIndex, rect: cell.getBoundingClientRect() };
    };
    const onPointerMove = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (toolsRef.current?.contains(target) || menuRef.current?.contains(target))) { cancelHide(); return; }
      const current = anchorRef.current;
      // Overlays (resize chrome, selection) may sit over the cell: keep by geometry too.
      if (current?.cell.isConnected && within(current.cell.getBoundingClientRect(), event.clientX, event.clientY)) {
        cancelHide();
        return;
      }
      // Never pop tools mid-drag (cell selection, column resize).
      const header = event.buttons === 0 ? headerAt(event.target) : null;
      if (header) {
        cancelHide();
        setFilterOpen(false);
        setAnchor(header);
        return;
      }
      if (current) hideSoon();
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      cancelHide();
    };
  }, [editor, cancelHide, hideSoon]);

  React.useEffect(() => {
    if (!editor || !anchor) return;
    const update = () => {
      if (!anchor.cell.isConnected) { setAnchor(null); return; }
      setAnchor((current) => current ? { ...current, rect: current.cell.getBoundingClientRect() } : null);
    };
    const outside = (event: PointerEvent) => {
      if (toolsRef.current?.contains(event.target as Node) || menuRef.current?.contains(event.target as Node) || anchor.cell.contains(event.target as Node)) return;
      setFilterOpen(false);
      setAnchor(null);
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    editor.on("transaction", update);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      editor.off("transaction", update);
      document.removeEventListener("pointerdown", outside);
    };
  }, [editor, anchor?.cell]);

  if (!editor || !anchor) return null;
  const table = editor.state.doc.nodeAt(anchor.tablePos);
  if (!table || table.type.name !== "table") return null;
  const values = tableColumnValues(table, anchor.column);
  const currentValue = (table.attrs.columnFilters as Record<string, string> ?? {})[anchor.column];
  const label = anchor.cell.querySelector("p")?.textContent?.trim() || `Column ${anchor.column + 1}`;
  const filterRect = filterButtonRef.current?.getBoundingClientRect();
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const toolWidth = coarse ? 94 : 62;
  const toolHeight = coarse ? 50 : 34;
  // Inset from the right edge so the column-resize divider zone stays grabbable.
  const left = Math.max(anchor.rect.left, anchor.rect.right - toolWidth - DIVIDER_CLEARANCE);
  const top = anchor.rect.top + Math.max(0, (anchor.rect.height - toolHeight) / 2);
  // Re-anchor to the (possibly re-rendered) header so the tools stay put under the pointer:
  // a second Sort click toggles direction without leaving and re-entering the cell.
  const reanchor = (): HeaderAnchor | null => {
    const next = editor.state.doc.nodeAt(anchor.tablePos);
    if (!next || next.type.name !== "table") return null;
    const map = TableMap.get(next);
    if (anchor.column >= map.width) return null;
    const cell = editor.view.nodeDOM(anchor.tablePos + 1 + map.map[anchor.column]);
    return cell instanceof HTMLTableCellElement
      ? { cell, tablePos: anchor.tablePos, column: anchor.column, rect: cell.getBoundingClientRect() } : null;
  };
  const run = (command: ReturnType<typeof sortHeaderColumnCommand>) => {
    command(editor.state, editor.view.dispatch);
    setAnchor(reanchor());
    setFilterOpen(false);
  };
  const filter = (value: string | null) => {
    filterHeaderColumnCommand(anchor.tablePos, anchor.column, value)(editor.state, editor.view.dispatch);
    setAnchor(reanchor());
    setFilterOpen(false);
  };

  return <>{createPortal(
    <div ref={toolsRef} className="table-header-tools" style={{ left, top }} data-testid="table-header-tools" onPointerDown={(event) => event.preventDefault()}>
      <div className="table-header-tools__buttons">
        <button type="button" aria-label={`Sort ${label} column`} title={`Sort ${label} column`} data-testid="table-header-sort" data-active={table.attrs.sortColumn === anchor.column || undefined} data-direction={table.attrs.sortColumn === anchor.column ? table.attrs.sortDirection ?? undefined : undefined} onClick={() => run(sortHeaderColumnCommand(anchor.tablePos, anchor.column))}>
          <ArrowDownUp aria-hidden="true" />
        </button>
        <button ref={filterButtonRef} type="button" aria-label={`Filter ${label} column`} title={`Filter ${label} column`} data-testid="table-header-filter" data-active={currentValue !== undefined || undefined} aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}>
          <ListFilter aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  )}{filterOpen && filterRect ? createPortal(
      <div ref={menuRef} className="table-header-tools__menu" style={{ top: filterRect.bottom + 2, left: Math.max(0, Math.min(filterRect.left, window.innerWidth - 128)) }} role="menu" aria-label={`Filter ${label} column`} data-testid="table-header-filter-menu" onPointerDown={(event) => event.preventDefault()}>
        <button type="button" role="menuitemradio" aria-checked={currentValue === undefined} onClick={() => filter(null)}>All rows</button>
        {values.map((value, index) => <button key={value} type="button" role="menuitemradio" aria-checked={currentValue === value} data-testid={`table-filter-option-${index}`} onClick={() => filter(value)}>{value || "(Blank)"}</button>)}
      </div>,
      document.body,
    ) : null}</>;
}
