"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { contentColumnWidths, contentRowHeights, setTableSizes, tablePosition, TABLE_MIN_COLUMN_WIDTH } from "@/lib/table-resize";

type Corner = "nw" | "ne" | "sw" | "se";

function columnWidths(table: HTMLTableElement): number[] {
  return Array.from(table.querySelectorAll("colgroup > col"), (col) =>
    Math.max(TABLE_MIN_COLUMN_WIDTH, col.getBoundingClientRect().width));
}

function fitRow(editor: Editor, table: HTMLTableElement, rowIndex: number) {
  const tablePos = tablePosition(editor, table);
  if (tablePos === null) return;
  const heights = Array.from(table.rows, (row) => row.getBoundingClientRect().height);
  heights[rowIndex] = contentRowHeights(table)[rowIndex];
  setTableSizes(editor, tablePos, undefined, heights);
}

/** Column drag uses TipTap's persisted colwidth plugin; these controls add fit and whole-table resize. */
export function TableResizeControls({ editor }: { editor: Editor | null }) {
  const [wrappers, setWrappers] = React.useState<HTMLDivElement[]>([]);

  React.useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      const next = Array.from(editor.view.dom.querySelectorAll<HTMLDivElement>(".tableWrapper"));
      setWrappers(next);
    };
    refresh();
    editor.on("update", refresh);
    return () => { editor.off("update", refresh); };
  }, [editor]);

  React.useEffect(() => {
    if (!editor) return;
    const onDoubleClick = (event: MouseEvent) => {
      const cell = event.target instanceof Element ? event.target.closest("th,td") : null;
      const table = cell?.closest("table");
      if (!(cell instanceof HTMLTableCellElement) || !(table instanceof HTMLTableElement) || !editor.view.dom.contains(table)) return;
      const tablePos = tablePosition(editor, table);
      if (tablePos === null) return;
      const rect = cell.getBoundingClientRect();
      const atColumnDivider = Math.abs(event.clientX - rect.right) <= 8;
      const atRowDivider = Math.abs(event.clientY - rect.bottom) <= 8;
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
        const rowIndex = (cell.parentElement as HTMLTableRowElement).rowIndex;
        fitRow(editor, table, rowIndex);
      }
    };
    editor.view.dom.addEventListener("dblclick", onDoubleClick, true);
    return () => editor.view.dom.removeEventListener("dblclick", onDoubleClick, true);
  }, [editor]);

  const startResize = (event: React.PointerEvent<HTMLButtonElement>, wrapper: HTMLDivElement, corner: Corner) => {
    if (!editor || event.button !== 0) return;
    const table = wrapper.querySelector("table");
    if (!(table instanceof HTMLTableElement)) return;
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
    const minScale = Math.max(0.1,
      ...widths.map((width, index) => (minWidths[index] ?? TABLE_MIN_COLUMN_WIDTH) / width),
      ...heights.map((height, index) => (minHeights[index] ?? 1) / height));
    const xSign = corner.endsWith("e") ? 1 : -1;
    const ySign = corner.startsWith("s") ? 1 : -1;
    const move = (pointer: PointerEvent) => {
      const dx = xSign * (pointer.clientX - startX) / Math.max(rect.width, 1);
      const dy = ySign * (pointer.clientY - startY) / Math.max(rect.height, 1);
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      const scale = Math.max(minScale, Math.min(5, 1 + delta));
      setTableSizes(editor, tablePos, widths.map((width) => width * scale), heights.map((height) => height * scale));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  return <>{wrappers.map((wrapper) => createPortal(
    <>{Array.from(wrapper.querySelector("table")?.rows ?? [], (row, index) => {
      const table = row.closest("table") as HTMLTableElement;
      const top = row.getBoundingClientRect().bottom - wrapper.getBoundingClientRect().top + wrapper.scrollTop;
      return <button key={`row-${index}`} type="button" contentEditable={false} className="table-row-divider"
        style={{ top }} data-testid={`table-row-divider-${index}`} aria-label={`Fit row ${index + 1} to content`}
        title="Double-click to fit row to content" onMouseDown={(event) => event.preventDefault()}
        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); if (editor) fitRow(editor, table, index); }} />;
    })}{(["nw", "ne", "sw", "se"] as const).map((corner) => {
      const table = wrapper.querySelector("table");
      const bounds = table?.getBoundingClientRect();
      const wrapperBounds = wrapper.getBoundingClientRect();
      const left = bounds ? (corner.endsWith("e") ? bounds.right - wrapperBounds.left + wrapper.scrollLeft - 16 : bounds.left - wrapperBounds.left + wrapper.scrollLeft) : 0;
      const top = bounds ? (corner.startsWith("s") ? bounds.bottom - wrapperBounds.top + wrapper.scrollTop - 16 : bounds.top - wrapperBounds.top + wrapper.scrollTop) : 0;
      return <button key={corner} type="button" contentEditable={false} className={`table-resize-corner table-resize-corner--${corner}`}
        style={{ left, top }} data-testid={`table-resize-${corner}`} aria-label={`Resize table from ${corner} corner`}
        title="Drag to resize the whole table" onPointerDown={(event) => startResize(event, wrapper, corner)} />;
    })}</>,
    wrapper,
  ))}</>;
}
