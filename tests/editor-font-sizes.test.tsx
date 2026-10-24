/** @jest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { readEditorFontSizes, useEditorFontSizes } from "@/components/use-editor-font-sizes";

let editor: Editor;
let stylesheet: HTMLStyleElement;

beforeEach(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ".editor-content {font-size:16px} .editor-content h2 {font-size:24px} [data-density=compact] .editor-content {font-size:12px}";
  document.head.appendChild(stylesheet);
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  document.body.innerHTML = "";
  stylesheet.remove();
  document.documentElement.removeAttribute("data-density");
});

function mountEditor(content: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: [StarterKit, TextStyle, FontSize], content, editorProps: { attributes: { class: "editor-content" } } });
}

test("inherited sizes follow preference changes and viewport reflow", async () => {
  mountEditor("<p>Body</p>");
  const { result } = renderHook(() => useEditorFontSizes(editor));
  expect(result.current).toEqual({ selectionSize: "16px", defaultSize: "16px" });
  act(() => document.documentElement.setAttribute("data-density", "compact"));
  await waitFor(() => expect(result.current).toEqual({ selectionSize: "12px", defaultSize: "12px" }));
  act(() => {
    editor.view.dom.style.fontSize = "18px";
    window.dispatchEvent(new Event("resize"));
  });
  expect(result.current).toEqual({ selectionSize: "18px", defaultSize: "18px" });
});

test("custom saved sizes and pending font choices do not fall back to a preset", () => {
  mountEditor('<p><span style="font-size:17px">Custom</span></p>');
  const { result } = renderHook(() => useEditorFontSizes(editor));
  expect(result.current).toEqual({ selectionSize: "17px", defaultSize: "16px" });
  act(() => { editor.commands.setFontSize("19px"); });
  expect(result.current.selectionSize).toBe("19px");
  act(() => { editor.commands.unsetFontSize(); });
  expect(result.current).toEqual({ selectionSize: "16px", defaultSize: "16px" });
});

test("selection labels use heading size while Default remains the body size", () => {
  mountEditor("<h2>Heading</h2><p>Body</p>");
  const { result } = renderHook(() => useEditorFontSizes(editor));
  expect(result.current).toEqual({ selectionSize: "24px", defaultSize: "16px" });
  act(() => { editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 1); });
  expect(result.current).toEqual({ selectionSize: "16px", defaultSize: "16px" });
  expect(readEditorFontSizes(null).selectionSize).toBe("Default");
});
