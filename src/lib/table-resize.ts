import type { Editor } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";

export const TABLE_MIN_COLUMN_WIDTH = 48;

/** Resolve the document table corresponding to a rendered table. */
export function tablePosition(editor: Editor, element: HTMLTableElement): number | null {
  const cell = element.querySelector("th,td");
  if (!cell) return null;
  const $pos = editor.state.doc.resolve(editor.view.posAtDOM(cell, 0));
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "table") return $pos.before(depth);
  }
  return null;
}

/** Commit explicit widths and heights to table nodes so page HTML retains them. */
export function setTableSizes(editor: Editor, tablePos: number, widths?: number[], heights?: number[], options: { history?: boolean } = {}): boolean {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  const map = TableMap.get(table);
  const tr = editor.state.tr;
  let changed = false;
  if (widths && widths.length === map.width) {
    const seen = new Set<number>();
    for (const offset of map.map) {
      if (seen.has(offset)) continue;
      seen.add(offset);
      const cell = table.nodeAt(offset);
      if (!cell) continue;
      const start = map.colCount(offset);
      const next = Array.from({ length: cell.attrs.colspan ?? 1 }, (_, index) =>
        Math.max(TABLE_MIN_COLUMN_WIDTH, Math.round(widths[start + index])));
      if (JSON.stringify(cell.attrs.colwidth) === JSON.stringify(next)) continue;
      tr.setNodeMarkup(tablePos + 1 + offset, undefined, { ...cell.attrs, colwidth: next });
      changed = true;
    }
  }
  if (heights && heights.length === table.childCount) {
    let rowPos = tablePos + 1;
    table.forEach((row, _offset, index) => {
      const next = Math.max(1, Math.round(heights[index]));
      if (row.attrs.rowHeight !== next) {
        tr.setNodeMarkup(rowPos, undefined, { ...row.attrs, rowHeight: next });
        changed = true;
      }
      rowPos += row.nodeSize;
    });
  }
  if (changed && options.history === false) tr.setMeta("addToHistory", false);
  if (changed) editor.view.dispatch(tr);
  return changed;
}

/** Measure unwrapped cell content, including rich text and embedded assets. */
export function contentColumnWidths(table: HTMLTableElement): number[] {
  const probe = document.createElement("div");
  probe.className = "editor-content";
  probe.style.cssText = "position: fixed; left: -100000px; top: 0; visibility: hidden; width: max-content";
  const copy = table.cloneNode(true) as HTMLTableElement;
  copy.querySelector("colgroup")?.remove();
  copy.style.width = "max-content";
  copy.style.minWidth = "0";
  copy.style.tableLayout = "auto";
  for (const row of Array.from(copy.rows)) {
    row.style.display = "table-row";
    row.style.height = "auto";
    for (const cell of Array.from(row.cells)) {
      cell.style.width = "auto";
      cell.style.whiteSpace = "nowrap";
    }
  }
  probe.appendChild(copy);
  document.body.appendChild(probe);
  const columnCount = Array.from(table.rows[0]?.cells ?? []).reduce((count, cell) => count + cell.colSpan, 0);
  const widths = Array.from({ length: columnCount }, () => TABLE_MIN_COLUMN_WIDTH);
  for (const row of Array.from(copy.rows)) {
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      const perColumn = Math.ceil(cell.getBoundingClientRect().width / cell.colSpan);
      for (let index = 0; index < cell.colSpan; index++) {
        widths[column + index] = Math.max(widths[column + index] ?? TABLE_MIN_COLUMN_WIDTH, perColumn);
      }
      column += cell.colSpan;
    }
  }
  probe.remove();
  return widths;
}

/** Measure cell blocks directly so an explicit tr height cannot inflate the fit result. */
export function contentRowHeights(table: HTMLTableElement): number[] {
  return Array.from(table.rows, (row) => {
    return Math.ceil(Math.max(...Array.from(row.cells, (cell) => {
      const style = getComputedStyle(cell);
      const children = Array.from(cell.children) as HTMLElement[];
      const blocks = children.reduce((total, child) => {
        const childStyle = getComputedStyle(child);
        return total + child.getBoundingClientRect().height
          + (parseFloat(childStyle.marginTop) || 0) + (parseFloat(childStyle.marginBottom) || 0);
      }, 0);
      return Math.max(parseFloat(style.fontSize) * 2.25,
        blocks + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0) + 2);
    })));
  });
}
