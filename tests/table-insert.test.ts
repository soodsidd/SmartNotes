/** @jest-environment jsdom */
import { Editor } from "@tiptap/core";
import { createEditorExtensions, setEditorHtmlSilent } from "@/lib/rich-text-editor-config";
import { tableCellCount, tableDimension } from "@/lib/table-insert";

function makeEditor(content = "<p>Main flow</p>") {
  return new Editor({ element: document.createElement("div"), extensions: createEditorExtensions(), content });
}

describe("Insert table options", () => {
  test("shortcut inserts a minimal header table; Tab and Enter grow editable cells", () => {
    const editor = makeEditor();
    const press = (key: string, ctrlKey = false, altKey = false) => editor.view.someProp(
      "handleKeyDown",
      (handler) => handler(editor.view, new KeyboardEvent("keydown", { key, ctrlKey, altKey, bubbles: true, cancelable: true })),
    ) ?? false;
    editor.commands.setTextSelection(editor.state.doc.content.size);
    expect(press("t", true, true)).toBe(true);
    let table = editor.getJSON().content?.find((node) => node.type === "table");
    expect(table?.content).toHaveLength(2);
    expect(table?.content?.map((row) => row.content?.map((cell) => cell.type))).toEqual([["tableHeader"], ["tableCell"]]);
    const bodyCell = editor.state.doc.resolve(editor.state.selection.from);
    expect(bodyCell.parent.type.name).toBe("paragraph");
    expect(press("Tab")).toBe(true);
    table = editor.getJSON().content?.find((node) => node.type === "table");
    expect(table?.content?.map((row) => row.content?.length)).toEqual([2, 2]);
    editor.commands.insertContent("new column");
    expect(press("Enter")).toBe(true);
    table = editor.getJSON().content?.find((node) => node.type === "table");
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0].content?.[1].content?.[0].content?.[0].text).toBe("new column");
    editor.commands.insertContent("new row");
    expect(editor.getHTML()).toContain("new row");
    const second = makeEditor();
    setEditorHtmlSilent(second, editor.getHTML());
    expect(second.getJSON()).toEqual(editor.getJSON());
    second.destroy();
    editor.destroy();
  });
  test("accepts whole dimensions and updates the live cell count", () => {
    expect(tableDimension("3")).toBe(3);
    expect(tableCellCount("3", "3")).toBe(9);
    expect(tableCellCount("2", "4")).toBe(8);
    for (const value of ["", "0", "1.5", "-2", "51", "Infinity"]) {
      expect(tableDimension(value)).toBeNull();
    }
    expect(tableCellCount("", "4")).toBe(0);
  });

  test.each([true, false])("inserts chosen dimensions and header=%s in the main flow", (withHeaderRow) => {
    const first = makeEditor();
    first.commands.setTextSelection(first.state.doc.content.size);
    expect(first.chain().focus().insertTable({ rows: 2, cols: 4, withHeaderRow }).run()).toBe(true);
    const table = first.getJSON().content?.find((node) => node.type === "table");
    expect(table?.content).toHaveLength(2);
    expect(table?.content?.[0].content).toHaveLength(4);
    expect(table?.content?.[0].content?.[0].type).toBe(withHeaderRow ? "tableHeader" : "tableCell");
    const second = makeEditor();
    setEditorHtmlSilent(second, first.getHTML());
    expect(second.getJSON()).toEqual(first.getJSON());
    first.destroy();
    second.destroy();
  });

  test("inserts a table inside a floating box and restores it from HTML", () => {
    const first = makeEditor('<p>Main flow</p><div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p>Box text</p></div></div>');
    let boxPosition = -1;
    first.state.doc.descendants((node, pos) => {
      if (node.type.name === "floatingTextBox") boxPosition = pos;
    });
    first.commands.setTextSelection(boxPosition + 2);
    expect(first.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()).toBe(true);
    const box = first.getJSON().content?.find((node) => node.type === "floatingTextBox");
    const table = box?.content?.find((node) => node.type === "table");
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0].content?.[0].type).toBe("tableHeader");
    expect(first.view.dom.querySelector('.floating-text-box .activeCell')).not.toBeNull();
    const second = makeEditor(first.getHTML());
    expect(second.getJSON()).toEqual(first.getJSON());
    first.destroy();
    second.destroy();
  });
});
