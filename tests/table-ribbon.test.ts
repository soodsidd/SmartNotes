/** @jest-environment jsdom */
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { createEditorExtensions, setEditorHtmlSilent } from "@/lib/rich-text-editor-config";
import {
  alignCellsCommand,
  clearCellContentsCommand,
  compareCellText,
  computeSelectionStats,
  formatSelectionStats,
  moveColumnCommand,
  moveRowCommand,
  parseCellNumber,
  parseTsv,
  pasteTsvCommand,
  resizeColumnsCommand,
  selectCellsCommand,
  selectionMatrix,
  selectionStatsForState,
  setTableModeCommand,
  sortTableCommand,
  toTsv,
} from "@/lib/table-ribbon";

const TABLE = [
  "<table><tbody>",
  "<tr><th><p>Name</p></th><th><p>Qty</p></th></tr>",
  "<tr><td><p>pear</p></td><td><p>10</p></td></tr>",
  "<tr><td><p>apple</p></td><td><p>2.5</p></td></tr>",
  "<tr><td><p>fig</p></td><td><p></p></td></tr>",
  "</tbody></table>",
].join("");

function makeEditor(content = TABLE) {
  return new Editor({ element: document.createElement("div"), extensions: createEditorExtensions(), content });
}

/** Position just inside the cell at (row, col) of the first table. */
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

function caretIn(editor: Editor, row: number, col: number) {
  editor.commands.setTextSelection(cellPos(editor, row, col) + 2);
}

function selectRange(editor: Editor, from: [number, number], to: [number, number]) {
  const tr = editor.state.tr.setSelection(
    CellSelection.create(editor.state.doc, cellPos(editor, ...from), cellPos(editor, ...to)),
  );
  editor.view.dispatch(tr);
}

function exec(editor: Editor, command: (state: Editor["state"], dispatch: Editor["view"]["dispatch"]) => boolean) {
  return command(editor.state, editor.view.dispatch);
}

function columnTexts(editor: Editor, col: number): string[] {
  const table = editor.getJSON().content!.find((node) => node.type === "table")!;
  return table.content!.map((row) => (row.content![col].content?.[0]?.content?.[0]?.text as string | undefined) ?? "");
}

function roundTrip(editor: Editor) {
  const second = makeEditor("<p></p>");
  setEditorHtmlSilent(second, editor.getHTML());
  expect(second.getJSON()).toEqual(editor.getJSON());
  second.destroy();
}

describe("selection stats", () => {
  test("parses literal numbers only (no formulas)", () => {
    expect(parseCellNumber("1,234.5")).toBe(1234.5);
    expect(parseCellNumber(" -3 ")).toBe(-3);
    expect(parseCellNumber("$12")).toBe(12);
    expect(parseCellNumber("45%")).toBeCloseTo(0.45);
    expect(parseCellNumber("(7)")).toBe(-7);
    expect(parseCellNumber(".5")).toBe(0.5);
    for (const text of ["", "abc", "=1+2", "=SUM(A1:A2)", "1,23", "1e5", "12abc"]) {
      expect(parseCellNumber(text)).toBeNull();
    }
  });

  test("formats the fork status line, with dashes when nothing is numeric", () => {
    expect(formatSelectionStats(computeSelectionStats([""]))).toBe(
      "Count: 1 | Numbers: 0 | Sum: - | Average: - | Min: - | Max: -",
    );
    expect(formatSelectionStats(computeSelectionStats(["10", "2.5", "", "pear", "0.1", "0.2"]))).toBe(
      "Count: 6 | Numbers: 4 | Sum: 12.8 | Average: 3.2 | Min: 0.1 | Max: 10",
    );
  });

  test("reads the active cell or the cell selection from editor state", () => {
    const editor = makeEditor();
    caretIn(editor, 3, 1);
    expect(selectionStatsForState(editor.state)).toMatchObject({ count: 1, numbers: 0, sum: null });
    selectRange(editor, [1, 1], [3, 1]);
    expect(selectionStatsForState(editor.state)).toMatchObject({ count: 3, numbers: 2, sum: 12.5, min: 2.5, max: 10 });
    editor.commands.setTextSelection(1);
    editor.commands.insertContentAt(0, "<p>outside</p>");
    editor.commands.setTextSelection(2);
    expect(selectionStatsForState(editor.state)).toBeNull();
    editor.destroy();
  });
});

describe("ribbon commands", () => {
  test("Rows: move row up/down reorders and persists", () => {
    const editor = makeEditor();
    caretIn(editor, 2, 0);
    expect(exec(editor, moveRowCommand(-1))).toBe(true);
    expect(columnTexts(editor, 0)).toEqual(["Name", "apple", "pear", "fig"]);
    caretIn(editor, 3, 0);
    expect(moveRowCommand(1)(editor.state, undefined)).toBe(false);
    roundTrip(editor);
    editor.destroy();
  });

  test("Columns: move, widen, narrow, and auto width persist colwidth", () => {
    const editor = makeEditor();
    caretIn(editor, 1, 0);
    expect(exec(editor, moveColumnCommand(1))).toBe(true);
    expect(columnTexts(editor, 0)).toEqual(["Qty", "10", "2.5", ""]);
    caretIn(editor, 1, 1);
    expect(moveColumnCommand(1)(editor.state, undefined)).toBe(false);
    expect(exec(editor, resizeColumnsCommand(40))).toBe(true);
    expect(editor.getHTML()).toContain('colwidth="160"');
    roundTrip(editor);
    caretIn(editor, 1, 1);
    exec(editor, resizeColumnsCommand(-200));
    expect(editor.getHTML()).toContain('colwidth="48"');
    caretIn(editor, 1, 1);
    expect(exec(editor, resizeColumnsCommand(null))).toBe(true);
    expect(editor.getHTML()).not.toContain("colwidth=");
    editor.destroy();
  });

  test("Cells and Format: clear contents and align persist", () => {
    const editor = makeEditor();
    selectRange(editor, [1, 1], [2, 1]);
    expect(exec(editor, alignCellsCommand("right"))).toBe(true);
    expect(editor.getHTML().match(/data-align="right"/g)).toHaveLength(2);
    expect(exec(editor, clearCellContentsCommand)).toBe(true);
    expect(columnTexts(editor, 1)).toEqual(["Qty", "", "", ""]);
    roundTrip(editor);
    editor.destroy();
  });

  test("Select: row, column, and table become cell selections", () => {
    const editor = makeEditor();
    caretIn(editor, 2, 1);
    exec(editor, selectCellsCommand("row"));
    expect(selectionMatrix(editor.state)).toEqual([["apple", "2.5"]]);
    caretIn(editor, 2, 1);
    exec(editor, selectCellsCommand("column"));
    expect(selectionMatrix(editor.state)).toEqual([["Qty"], ["10"], ["2.5"], [""]]);
    exec(editor, selectCellsCommand("table"));
    expect(selectionStatsForState(editor.state)?.count).toBe(8);
    editor.destroy();
  });

  test("Data: sort keeps the header row, sorts numbers numerically, blanks last", () => {
    expect(["b", "", "10", "9", "a"].sort(compareCellText)).toEqual(["9", "10", "a", "b", ""]);
    const editor = makeEditor();
    caretIn(editor, 1, 1);
    expect(exec(editor, sortTableCommand("asc"))).toBe(true);
    expect(columnTexts(editor, 0)).toEqual(["Name", "apple", "pear", "fig"]);
    caretIn(editor, 1, 1);
    exec(editor, sortTableCommand("desc"));
    expect(columnTexts(editor, 0)).toEqual(["Name", "pear", "apple", "fig"]);
    caretIn(editor, 1, 0);
    exec(editor, sortTableCommand("asc"));
    expect(columnTexts(editor, 0)).toEqual(["Name", "apple", "fig", "pear"]);
    roundTrip(editor);
    editor.destroy();
  });

  test("Data: copy is TSV and pasting TSV grows the table from the active cell", () => {
    expect(parseTsv("a\tb\r\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(toTsv([["a\tb", "c"], ["d\ne", ""]])).toBe("a b\tc\nd e\t");
    const editor = makeEditor();
    selectRange(editor, [1, 0], [2, 1]);
    expect(toTsv(selectionMatrix(editor.state))).toBe("pear\t10\napple\t2.5");
    caretIn(editor, 3, 1);
    expect(exec(editor, pasteTsvCommand("7\tx\n8\ty"))).toBe(true);
    expect(columnTexts(editor, 1)).toEqual(["Qty", "10", "2.5", "7", "8"]);
    expect(columnTexts(editor, 2)).toEqual(["", "", "", "x", "y"]);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect(selectionStatsForState(editor.state)).toMatchObject({ count: 4, numbers: 2, sum: 15 });
    roundTrip(editor);
    editor.destroy();
  });

  test("merged cells disable reorder, sort, and TSV paste", () => {
    const editor = makeEditor();
    selectRange(editor, [1, 0], [1, 1]);
    expect(editor.commands.mergeCells()).toBe(true);
    caretIn(editor, 2, 0);
    expect(moveRowCommand(-1)(editor.state, undefined)).toBe(false);
    expect(sortTableCommand("asc")(editor.state, undefined)).toBe(false);
    expect(pasteTsvCommand("a\tb")(editor.state, undefined)).toBe(false);
    editor.destroy();
  });
});

describe("table modes", () => {
  test("Grid mode, Data mode, and Expand table persist per table and mirror onto the wrapper", () => {
    const editor = makeEditor();
    caretIn(editor, 1, 1);
    exec(editor, setTableModeCommand("gridMode", true));
    exec(editor, setTableModeCommand("dataMode", true));
    exec(editor, setTableModeCommand("expanded", true));
    const html = editor.getHTML();
    expect(html).toContain('data-grid-mode="true"');
    expect(html).toContain('data-data-mode="true"');
    expect(html).toContain('data-expanded="true"');
    const wrapper = editor.view.dom.querySelector(".tableWrapper")!;
    expect(wrapper.getAttribute("data-expanded")).toBe("true");
    expect(editor.view.dom.querySelectorAll(".numericCell")).toHaveLength(2);
    roundTrip(editor);
    exec(editor, setTableModeCommand("expanded", false));
    expect(wrapper.hasAttribute("data-expanded")).toBe(false);
    expect(editor.getHTML()).not.toContain("data-expanded");
    editor.destroy();
  });

  test("Grid mode: arrows and Enter move between cells; Shift+arrows extend a cell selection", () => {
    const editor = makeEditor();
    const press = (key: string, shiftKey = false) => {
      const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
      return editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event)) ?? false;
    };
    caretIn(editor, 1, 0);
    exec(editor, setTableModeCommand("gridMode", true));
    caretIn(editor, 1, 0);
    expect(press("ArrowDown")).toBe(true);
    expect(selectionMatrix(editor.state)).toEqual([["apple"]]);
    expect(press("Enter")).toBe(true);
    expect(selectionMatrix(editor.state)).toEqual([["fig"]]);
    expect(press("ArrowRight")).toBe(true);
    expect(selectionMatrix(editor.state)).toEqual([[""]]);
    expect(press("ArrowUp", true)).toBe(true);
    expect(press("ArrowLeft", true)).toBe(true);
    expect(selectionMatrix(editor.state)).toEqual([["apple", "2.5"], ["fig", ""]]);
    editor.destroy();
  });
});
