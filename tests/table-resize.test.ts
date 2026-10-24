/** @jest-environment jsdom */
import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";
import { setTableSizes } from "@/lib/table-resize";

const CONTENT = '<table><tbody><tr><th><p>Item</p></th><th><p>Count</p></th></tr><tr><td><p>Long value</p></td><td><p>2</p></td></tr></tbody></table>';

test("table column widths and row heights survive the page HTML round trip", () => {
  const editor = new Editor({ element: document.createElement("div"), extensions: createEditorExtensions(), content: CONTENT });
  let tablePos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "table") tablePos = pos;
  });
  expect(setTableSizes(editor, tablePos, [170, 90], [45, 60])).toBe(true);
  const table = editor.getJSON().content?.find((node) => node.type === "table");
  expect(table?.content?.map((row) => row.attrs?.rowHeight)).toEqual([45, 60]);
  expect(table?.content?.[0].content?.map((cell) => cell.attrs?.colwidth)).toEqual([[170], [90]]);
  const html = editor.getHTML();
  expect(html).toContain('data-row-height="45"');
  expect(html).toContain('colwidth="170"');
  const restored = new Editor({ element: document.createElement("div"), extensions: createEditorExtensions(), content: html });
  expect(restored.getJSON()).toEqual(editor.getJSON());
  restored.destroy();
  editor.destroy();
});
