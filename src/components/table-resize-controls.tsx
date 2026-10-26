"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { contentColumnWidths, contentRowHeights, setTableSizes, tablePosition, TABLE_MIN_COLUMN_WIDTH } from "@/lib/table-resize";

type Corner = "nw" | "ne" | "sw" | "se";
type Zone = { kind: "corner"; corner: Corner } | { kind: "row"; row: number };
interface Hot { table: HTMLTableElement; zone: Zone }

/** Pointer distance (px) from a table corner that reveals that corner's handle. */
const CORNER_REACH = 10;
/** Pointer distance (px) from a row border that reveals the row divider. */
const ROW_REACH = 4;

function columnWidths(table: HTMLTableElement): number[] {
  return Array.from(table.querySelectorAll("colgroup > col"), (col) =>
    Math.max(TABLE_MIN_COLUMN_WIDTH, col.getBoundingClientRect().width));
}

/** Round exactly as setTableSizes does, so the committed table matches the last previewed frame. */
const snapWidths = (widths: number[]) => widths.map((width) => Math.max(TABLE_MIN_COLUMN_WIDTH, Math.round(width)));
const snapHeights = (heights: number[]) => heights.map((height) => Math.max(1, Math.round(height)));
let previewSeq = 0;

/**
 * SN-394: a corner/row gesture previews sizes on the live DOM and commits one transaction on
 * release. Dispatching per pointermove made ProseMirror rebuild every cell and row (the flash).
 * Cols and the table element sit outside TableView's contentDOM, whose mutations it ignores; row
 * heights go through a head stylesheet so ProseMirror never observes a change inside the rows.
 */
function livePreview(table: HTMLTableElement) {
  const wrapper = table.closest<HTMLElement>(".tableWrapper");
  const cols = Array.from(table.querySelectorAll<HTMLTableColElement>("colgroup > col"));
  const saved = { table: table.style.cssText, cols: cols.map((col) => col.style.cssText), fixed: wrapper?.getAttribute("data-fixed-widths") ?? null };
  const id = String(++previewSeq);
  const sheet = document.head.appendChild(document.createElement("style"));
  wrapper?.setAttribute("data-table-resize-live", id);
  return {
    apply(widths?: number[], heights?: number[]) {
      if (widths) {
        widths.forEach((width, index) => cols[index]?.style.setProperty("width", `${width}px`));
        table.style.minWidth = "";
        table.style.width = `${widths.reduce((total, width) => total + width, 0)}px`;
        wrapper?.setAttribute("data-fixed-widths", "true");
      }
      if (heights) {
        sheet.textContent = heights.map((height, index) =>
          `.tableWrapper[data-table-resize-live="${id}"] > table > tbody > tr:nth-of-type(${index + 1}) { height: ${height}px !important; }`).join("\n");
      }
    },
    restore() {
      table.style.cssText = saved.table;
      cols.forEach((col, index) => { col.style.cssText = saved.cols[index]; });
      if (saved.fixed === null) wrapper?.removeAttribute("data-fixed-widths");
      else wrapper?.setAttribute("data-fixed-widths", saved.fixed);
      wrapper?.removeAttribute("data-table-resize-live");
      sheet.remove();
    },
  };
}

/** Coalesce pointermoves to one preview per frame; `finish` restores the DOM and commits the last sizes. */
function previewGesture(editor: Editor, table: HTMLTableElement, onFrame: () => void) {
  const preview = livePreview(table);
  let latest: { widths?: number[]; heights?: number[] } | null = null;
  let frame = 0;
  return {
    update(widths?: number[], heights?: number[]) {
      latest = { widths: widths && snapWidths(widths), heights: heights && snapHeights(heights) };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (latest) preview.apply(latest.widths, latest.heights);
        onFrame();
      });
    },
    finish() {
      cancelAnimationFrame(frame);
      preview.restore();
      // Same task as restore: TableView repaints the committed sizes before the browser paints.
      const tablePos = latest ? tablePosition(editor, table) : null;
      if (latest && tablePos !== null) setTableSizes(editor, tablePos, latest.widths, latest.heights);
      onFrame();
    },
  };
}

function fitRow(editor: Editor, table: HTMLTableElement, rowIndex: number) {
  const tablePos = tablePosition(editor, table);
  if (tablePos === null) return;
  const heights = Array.from(table.rows, (row) => row.getBoundingClientRect().height);
  heights[rowIndex] = contentRowHeights(table)[rowIndex];
  setTableSizes(editor, tablePos, undefined, heights);
}

/**
 * The table's on-screen box: a table wider than its scrolling wrapper is clipped, so handles sit
 * on the visible edge (a grown table can always be shrunk back from the corner it was grown by).
 */
function visibleRect(table: HTMLTableElement) {
  const rect = table.getBoundingClientRect();
  const view = (table.closest(".tableWrapper") ?? table).getBoundingClientRect();
  return { left: Math.max(rect.left, view.left), right: Math.min(rect.right, view.right), top: rect.top, bottom: rect.bottom };
}

function hotZone(table: HTMLTableElement, x: number, y: number): Zone | null {
  const rect = visibleRect(table);
  if (x < rect.left - CORNER_REACH || x > rect.right + CORNER_REACH || y < rect.top - CORNER_REACH || y > rect.bottom + CORNER_REACH) return null;
  const nearX = Math.abs(x - rect.left) <= CORNER_REACH ? "w" : Math.abs(x - rect.right) <= CORNER_REACH ? "e" : null;
  const nearY = Math.abs(y - rect.top) <= CORNER_REACH ? "n" : Math.abs(y - rect.bottom) <= CORNER_REACH ? "s" : null;
  if (nearX && nearY) return { kind: "corner", corner: `${nearY}${nearX}` as Corner };
  if (x < rect.left || x > rect.right) return null;
  const rows = Array.from(table.rows);
  for (let index = 0; index < rows.length; index++) {
    if (Math.abs(y - rows[index].getBoundingClientRect().bottom) <= ROW_REACH) return { kind: "row", row: index };
  }
  return null;
}

/**
 * SN-357 resize chrome. Column drag is TipTap's colwidth plugin (thin divider line); this adds
 * row-divider fit and whole-table corner resize as a body-level fixed overlay positioned from live
 * rects and shown only for the hot zone under the pointer. Never render React into ProseMirror's
 * table DOM: the node view does not own those children and positions computed at render go stale.
 */
export function TableResizeControls({ editor, onLiveResize }: { editor: Editor | null; onLiveResize?: () => void }) {
  const [hot, setHot] = React.useState<Hot | null>(null);
  const [, setTick] = React.useState(0);
  const dragging = React.useRef(false);
  const liveResize = React.useRef(onLiveResize);
  liveResize.current = onLiveResize;
  // Live gestures dispatch nothing, so re-place the chrome and let the editor frame follow per frame.
  const onFrame = React.useCallback(() => {
    setTick((tick) => tick + 1);
    liveResize.current?.();
  }, []);

  React.useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const onMove = (event: PointerEvent) => {
      if (dragging.current) return;
      if (event.buttons !== 0) { setHot(null); return; }
      // Recompute every move (corners win over row dividers); each zone covers its own chrome.
      for (const table of Array.from(root.querySelectorAll<HTMLTableElement>(".tableWrapper table"))) {
        const zone = hotZone(table, event.clientX, event.clientY);
        if (zone) {
          setHot((current) => current?.table === table && JSON.stringify(current.zone) === JSON.stringify(zone) ? current : { table, zone });
          return;
        }
      }
      setHot((current) => current ? null : current);
    };
    const clear = () => { if (!dragging.current) setHot(null); };
    const rerender = () => setTick((tick) => tick + 1);
    // Columns without a stored width absorb any divider drag; freeze them all at their rendered
    // widths so a drag resizes exactly the dragged column (Excel-like) and the table width follows.
    // Freeze when the pointer reaches a divider (plugin just set resize-cursor), never in mousedown:
    // the colwidth change redraws the cells, detaching the mousedown target, and ProseMirror then
    // drops the event before the resize plugin sees it. Visually identical, so kept out of undo.
    const onMouseMove = (event: MouseEvent) => {
      if (event.buttons !== 0 || !root.classList.contains("resize-cursor")) return;
      const table = (event.target as Element | null)?.closest?.("table");
      if (!(table instanceof HTMLTableElement) || !root.contains(table)) return;
      const cols = Array.from(table.querySelectorAll("colgroup > col")) as HTMLTableColElement[];
      if (cols.length && cols.every((col) => col.style.width)) return;
      const tablePos = tablePosition(editor, table);
      if (tablePos !== null) setTableSizes(editor, tablePos, columnWidths(table), undefined, { history: false });
    };
    // The colwidth plugin drags columns on the DOM until mouseup; let the editor frame grow with it
    // so the wrapper never clips the table behind a scrollbar mid-drag (SN-394).
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !root.classList.contains("resize-cursor")) return;
      let frame = 0;
      const follow = () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; liveResize.current?.(); });
      };
      const stop = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("mousemove", follow);
        window.removeEventListener("mouseup", stop);
      };
      window.addEventListener("mousemove", follow);
      window.addEventListener("mouseup", stop);
    };
    const onDoubleClick = (event: MouseEvent) => {
      const cell = event.target instanceof Element ? event.target.closest("th,td") : null;
      const table = cell?.closest("table");
      if (!(cell instanceof HTMLTableCellElement) || !(table instanceof HTMLTableElement) || !root.contains(table)) return;
      const tablePos = tablePosition(editor, table);
      if (tablePos === null) return;
      const rect = cell.getBoundingClientRect();
      const atColumnDivider = Math.abs(event.clientX - rect.right) <= 8;
      const atRowDivider = Math.abs(event.clientY - rect.bottom) <= ROW_REACH;
      if (!atColumnDivider && !atRowDivider) return;
      event.preventDefault();
      event.stopPropagation();
      if (atColumnDivider) {
        const column = Array.from(cell.parentElement?.children ?? []).slice(0, cell.cellIndex)
          .reduce((count, sibling) => count + (sibling as HTMLTableCellElement).colSpan, 0) + cell.colSpan - 1;
        const widths = columnWidths(table);
        widths[column] = contentColumnWidths(table)[column];
        setTableSizes(editor, tablePos, widths);
      } else {
        fitRow(editor, table, (cell.parentElement as HTMLTableRowElement).rowIndex);
      }
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    editor.on("transaction", rerender);
    root.addEventListener("mousemove", onMouseMove);
    root.addEventListener("mousedown", onMouseDown);
    root.addEventListener("dblclick", onDoubleClick, true);
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
      editor.off("transaction", rerender);
      root.removeEventListener("mousemove", onMouseMove);
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("dblclick", onDoubleClick, true);
    };
  }, [editor]);

  const startResize = (event: React.PointerEvent<HTMLElement>, table: HTMLTableElement, corner: Corner) => {
    if (!editor || event.button !== 0) return;
    const tablePos = tablePosition(editor, table);
    if (tablePos === null) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = table.getBoundingClientRect();
    const widths = columnWidths(table);
    const heights = Array.from(table.rows, (row) => row.getBoundingClientRect().height);
    const minWidths = contentColumnWidths(table);
    const minHeights = contentRowHeights(table);
    const minWidthScale = Math.max(0.1,
      ...widths.map((width, index) => (minWidths[index] ?? TABLE_MIN_COLUMN_WIDTH) / width));
    const minHeightScale = Math.max(0.1,
      ...heights.map((height, index) => (minHeights[index] ?? 1) / height));
    const xSign = corner.endsWith("e") ? 1 : -1;
    const ySign = corner.startsWith("s") ? 1 : -1;
    dragging.current = true;
    const gesture = previewGesture(editor, table, onFrame);
    const move = (pointer: PointerEvent) => {
      const dx = xSign * (pointer.clientX - startX) / Math.max(rect.width, 1);
      const dy = ySign * (pointer.clientY - startY) / Math.max(rect.height, 1);
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      const scale = Math.min(5, 1 + delta);
      // Once rows reach their content height, columns can still shrink toward text (and vice versa).
      gesture.update(
        widths.map((width) => width * Math.max(minWidthScale, scale)),
        heights.map((height) => height * Math.max(minHeightScale, scale)));
    };
    const finish = () => {
      dragging.current = false;
      gesture.finish();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setHot(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const startRowResize = (event: React.PointerEvent<HTMLElement>, table: HTMLTableElement, rowIndex: number) => {
    if (!editor || event.button !== 0) return;
    const tablePos = tablePosition(editor, table);
    if (tablePos === null) return;
    event.stopPropagation();
    const startY = event.clientY;
    const heights = Array.from(table.rows, (row) => row.getBoundingClientRect().height);
    const minHeight = contentRowHeights(table)[rowIndex];
    dragging.current = true;
    const gesture = previewGesture(editor, table, onFrame);
    let moved = false;
    const move = (pointer: PointerEvent) => {
      if (!moved && Math.abs(pointer.clientY - startY) <= 2) return;
      moved = true;
      const next = [...heights];
      next[rowIndex] = Math.max(minHeight, heights[rowIndex] + pointer.clientY - startY);
      gesture.update(undefined, next);
    };
    const finish = () => {
      dragging.current = false;
      gesture.finish();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (moved) setHot(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  if (!editor || !hot || !hot.table.isConnected) return null;
  const rect = visibleRect(hot.table);
  if (hot.zone.kind === "corner") {
    const { corner } = hot.zone;
    const left = corner.endsWith("e") ? rect.right : rect.left;
    const top = corner.startsWith("s") ? rect.bottom : rect.top;
    return createPortal(
      <span data-table-resize-chrome="" className={`table-resize-corner table-resize-corner--${corner}`} style={{ left, top }}
        data-testid={`table-resize-${corner}`} role="separator" aria-label={`Resize table from ${corner} corner`}
        title="Drag to resize the whole table" onPointerDown={(event) => startResize(event, hot.table, corner)} />,
      document.body,
    );
  }
  const row = hot.table.rows[hot.zone.row];
  if (!row) return null;
  const rowIndex = hot.zone.row;
  const table = hot.table;
  return createPortal(
    <span data-table-resize-chrome="" className="table-row-divider" style={{ left: rect.left, top: row.getBoundingClientRect().bottom, width: rect.right - rect.left }}
      data-testid={`table-row-divider-${rowIndex}`} role="separator" aria-label={`Fit row ${rowIndex + 1} to content`}
      title="Drag row height or double-click to fit" onPointerDown={(event) => startRowResize(event, table, rowIndex)}
      onMouseDown={(event) => event.preventDefault()}
      onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); fitRow(editor, table, rowIndex); }} />,
    document.body,
  );
}
