/** @jest-environment jsdom */
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";
import {
  buildTableContextMenuGroups,
  tableContextMenuLayout,
  tableMenuLabel,
  tableMenuStateFor,
  type TableMenuState,
} from "@/lib/table-context-menu";
import { shortSum } from "@/components/table-ribbon";

const TABLE = [
  "<p>Before</p>",
  "<table><tbody>",
  "<tr><th><p>Name</p></th><th><p>Qty</p></th></tr>",
  "<tr><td><p>pear</p></td><td><p>10</p></td></tr>",
  "<tr><td><p>apple</p></td><td><p>2.5</p></td></tr>",
  "</tbody></table>",
  "<p>After</p>",
].join("");

function makeEditor(content = TABLE) {
  return new Editor({ element: document.createElement("div"), extensions: createEditorExtensions(), content });
}

function cellPos(editor: Editor, row: number, col: number): number {
  let found = -1;
  let index = 0;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      const width = editor.state.doc.resolve(pos).node().childCount;
      if (Math.floor(index / width) === row && index % width === col) found = pos;
      index++;
      return false;
    }
    return true;
  });
  return found;
}

const noop = { onCopy: () => {}, onPaste: () => {}, onAddComment: () => {} };

const BASE: TableMenuState = {
  selectedRows: 1,
  selectedCols: 1,
  canMerge: false,
  canSplit: false,
  inFirstRow: false,
  headerRowOn: true,
  canSort: true,
  canPasteTable: true,
  canComment: false,
};

describe("SN-308 table context menu layout", () => {
  it("always ends with Delete table and keeps insert/delete row and column", () => {
    const flat = tableContextMenuLayout(BASE, false).flat();
    expect(flat[flat.length - 1]).toBe("deleteTable");
    for (const id of ["rowAbove", "rowBelow", "colLeft", "colRight", "deleteRow", "deleteCol"] as const) {
      expect(flat).toContain(id);
    }
    expect(tableContextMenuLayout(BASE, true).flat().pop()).toBe("deleteTable");
  });

  it("only offers merge, split, header row, sort, and comment when they apply", () => {
    const plain = tableContextMenuLayout(BASE, false).flat();
    expect(plain).not.toContain("merge");
    expect(plain).not.toContain("split");
    expect(plain).not.toContain("headerRow");
    expect(plain).not.toContain("comment");

    const rich = tableContextMenuLayout(
      { ...BASE, canMerge: true, canSplit: true, inFirstRow: true, canComment: true },
      false,
    ).flat();
    expect(rich).toEqual(expect.arrayContaining(["merge", "split", "headerRow", "comment"]));

    const unsortable = tableContextMenuLayout({ ...BASE, canSort: false, canPasteTable: false }, false).flat();
    expect(unsortable).not.toContain("sortAsc");
    expect(unsortable).not.toContain("pasteTable");
  });

  it("keeps the mobile menu shorter (no align or select groups)", () => {
    const mobile = tableContextMenuLayout(BASE, true).flat();
    expect(mobile).not.toContain("alignLeft");
    expect(mobile).not.toContain("selectTable");
    expect(mobile.length).toBeLessThan(tableContextMenuLayout(BASE, false).flat().length);
  });

  it("pluralizes delete labels for multi-row/column selections and reflects header state", () => {
    expect(tableMenuLabel("deleteRow", BASE)).toBe("Delete row");
    expect(tableMenuLabel("deleteRow", { ...BASE, selectedRows: 3 })).toBe("Delete 3 rows");
    expect(tableMenuLabel("deleteCol", { ...BASE, selectedCols: 2 })).toBe("Delete 2 columns");
    expect(tableMenuLabel("headerRow", BASE)).toBe("Remove header row");
    expect(tableMenuLabel("headerRow", { ...BASE, headerRowOn: false })).toBe("Make header row");
  });
});

describe("SN-308 table context menu on a live editor", () => {
  it("is null outside a table", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(2);
    expect(tableMenuStateFor(editor, false, true)).toBeNull();
    editor.destroy();
  });

  it("reads selection facts and offers merge for a multi-cell selection", () => {
    const editor = makeEditor();
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cellPos(editor, 1, 0), cellPos(editor, 2, 1))),
    );
    const state = tableMenuStateFor(editor, false, true)!;
    expect(state).toMatchObject({ selectedRows: 2, selectedCols: 2, canMerge: true, inFirstRow: false, headerRowOn: true });
    editor.destroy();
  });

  it("Delete table removes the table and leaves the surrounding text", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(cellPos(editor, 1, 0) + 2);
    const state = tableMenuStateFor(editor, false, true)!;
    const groups = buildTableContextMenuGroups(editor, state, false, noop);
    const del = groups.flat().find((action) => action.id === "table-deleteTable")!;
    expect(del.destructive).toBe(true);
    del.run();
    expect(editor.getHTML()).not.toContain("<table");
    expect(editor.getText()).toContain("Before");
    expect(editor.getText()).toContain("After");
    editor.destroy();
  });

  it("Insert row below adds a row via the shared command", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(cellPos(editor, 1, 0) + 2);
    const groups = buildTableContextMenuGroups(editor, tableMenuStateFor(editor, false, true)!, false, noop);
    groups.flat().find((action) => action.id === "table-rowBelow")!.run();
    expect(editor.getHTML().match(/<tr>/g)).toHaveLength(4);
    editor.destroy();
  });
});

describe("SN-308 mobile stats chip", () => {
  it("shows the sum when numeric, else the count", () => {
    expect(shortSum("Count: 4 | Numbers: 2 | Sum: 12.5 | Average: 6.25 | Min: 2.5 | Max: 10")).toBe("12.5");
    expect(shortSum("Count: 1 | Numbers: 0 | Sum: - | Average: - | Min: - | Max: -")).toBe("1");
  });
});
