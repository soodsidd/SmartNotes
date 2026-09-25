/**
 * @jest-environment jsdom
 */

import { Editor } from "@tiptap/core";
import {
  buildEditorContextMenuActions,
  shouldOpenEditorContextMenu,
} from "@/lib/editor-context-menu";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";

function makeEditor(content = "<p>Hello world</p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content,
  });
}

describe("editor context menu actions", () => {
  test("opens the full editor menu only for desktop mouse context menus", () => {
    expect(
      shouldOpenEditorContextMenu({
        pointerType: "mouse",
        coarsePointer: false,
        viewportWidth: 1280,
      })
    ).toBe(true);

    expect(
      shouldOpenEditorContextMenu({
        pointerType: "touch",
        coarsePointer: false,
        viewportWidth: 1280,
      })
    ).toBe(false);
    expect(
      shouldOpenEditorContextMenu({
        pointerType: "mouse",
        coarsePointer: true,
        viewportWidth: 1280,
      })
    ).toBe(false);
    expect(
      shouldOpenEditorContextMenu({
        pointerType: "mouse",
        coarsePointer: false,
        viewportWidth: 390,
      })
    ).toBe(false);
  });

  test("includes formatting, copy, and a single Add comment action", () => {
    const editor = makeEditor("<p>Select me</p>");
    editor.commands.selectAll();

    const actions = buildEditorContextMenuActions(editor, {
      canAddComment: true,
      canCopy: true,
      canPaste: true,
      onAddComment: jest.fn(),
      onCopy: jest.fn(),
      onPaste: jest.fn(),
      onSelectAll: jest.fn(),
      onOpenLink: jest.fn(),
    });

    expect(actions.map((action) => action.testId)).toEqual([
      "ctx-copy",
      "ctx-paste",
      "ctx-select-all",
      "ctx-bold",
      "ctx-italic",
      "ctx-strike",
      "ctx-code",
      "ctx-h1",
      "ctx-h2",
      "ctx-h3",
      "ctx-bullet",
      "ctx-ordered",
      "ctx-task",
      "ctx-link",
      "ctx-add-comment",
    ]);
    expect(actions.filter((action) => action.label === "Add comment")).toHaveLength(1);

    editor.destroy();
  });
});
