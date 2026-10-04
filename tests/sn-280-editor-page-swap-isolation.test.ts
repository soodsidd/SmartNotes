/**
 * @jest-environment jsdom
 */

import { Editor } from "@tiptap/core";
import {
  assertEditorUploadPageAffinity,
  createEditorExtensions,
  EditorUploadPageAffinityError,
  setEditorHtmlSilent,
} from "@/lib/rich-text-editor-config";

function makeEditor(content = "<p></p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content,
  });
}

function imageSrcFromDom(editor: Editor): string | null {
  const img = editor.view.dom.querySelector("img");
  return img?.getAttribute("src") ?? null;
}

describe("SN-280 text-page image isolation across navigation", () => {
  test("image NodeView rebuilds so swapped content does not keep the previous src", () => {
    const srcA = "/vault/nb/sec/page-a.assets/alpha.png";
    const srcB = "/vault/nb/sec/page-b.assets/beta.png";
    const editor = makeEditor(
      `<img class="editor-image" src="${srcA}" alt="alpha">`
    );

    expect(imageSrcFromDom(editor)).toBe(srcA);

    setEditorHtmlSilent(
      editor,
      `<img class="editor-image" src="${srcB}" alt="beta">`
    );

    expect(editor.getHTML()).toContain(srcB);
    expect(editor.getHTML()).not.toContain(srcA);
    expect(imageSrcFromDom(editor)).toBe(srcB);

    const img = editor.view.dom.querySelector("img");
    expect(img?.getAttribute("src")).toBe(srcB);
    expect(img?.getAttribute("alt")).toBe("beta");

    editor.destroy();
  });

  test("setEditorHtmlSilent / swapContent path does not emit onUpdate", () => {
    let updateCount = 0;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: createEditorExtensions(),
      content: "<p>page-a</p>",
      onUpdate: () => {
        updateCount += 1;
      },
    });

    expect(updateCount).toBe(0);
    setEditorHtmlSilent(editor, "<p>page-b</p>");
    expect(editor.getHTML()).toContain("page-b");
    expect(updateCount).toBe(0);

    // Contrast: default TipTap v3 emitUpdate:true would fire onUpdate.
    editor.commands.setContent("<p>page-c</p>", { emitUpdate: true });
    expect(updateCount).toBe(1);

    editor.destroy();
    el.remove();
  });

  test("upload page-affinity assert aborts when active page or generation changes", () => {
    expect(() =>
      assertEditorUploadPageAffinity({
        uploadPagePath: "Notebook/A.html",
        uploadGeneration: 1,
        activePagePath: "Notebook/A.html",
        activeGeneration: 1,
      })
    ).not.toThrow();

    expect(() =>
      assertEditorUploadPageAffinity({
        uploadPagePath: "Notebook/A.html",
        uploadGeneration: 1,
        activePagePath: "Notebook/B.html",
        activeGeneration: 1,
      })
    ).toThrow(EditorUploadPageAffinityError);

    expect(() =>
      assertEditorUploadPageAffinity({
        uploadPagePath: "Notebook/A.html",
        uploadGeneration: 1,
        activePagePath: "Notebook/A.html",
        activeGeneration: 2,
      })
    ).toThrow(EditorUploadPageAffinityError);

    expect(() =>
      assertEditorUploadPageAffinity({
        uploadPagePath: "Notebook/A.html",
        uploadGeneration: 1,
        activePagePath: null,
        activeGeneration: 1,
      })
    ).toThrow(EditorUploadPageAffinityError);
  });
});
