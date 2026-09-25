/**
 * @jest-environment jsdom
 */

import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";

function makeEditor(content = "<p></p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content,
  });
}

describe("image resize handles (SN-112)", () => {
  test("selected image uses TipTap native resize node view", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.setImage({ src: "/vault/nb/sec/page.assets/chart.png", alt: "chart" });

    let imagePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") imagePos = pos;
    });
    expect(imagePos).toBeGreaterThanOrEqual(0);

    editor.commands.setNodeSelection(imagePos);
    editor.commands.focus();

    const resizeContainer = editor.view.dom.querySelector('[data-resize-container][data-node="image"]');
    expect(resizeContainer).not.toBeNull();
    expect(resizeContainer?.querySelector('[data-resize-handle="right"]')).not.toBeNull();

    editor.destroy();
  });

  test("resize updates width attribute through setImageWidth", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.setImage({ src: "/vault/nb/sec/page.assets/chart.png", alt: "chart" });

    let imagePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") imagePos = pos;
    });

    editor.chain().focus().setNodeSelection(imagePos).setImageWidth("60%").run();

    expect(editor.getAttributes("image").width).toBe("60%");
    const html = editor.getHTML();
    expect(html).toContain('width="60%"');

    editor.destroy();
  });

  test("native resize accepts pixel widths from drag commit", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.setImage({ src: "/vault/nb/sec/page.assets/chart.png", alt: "chart" });

    let imagePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") imagePos = pos;
    });

    editor.chain().focus().setNodeSelection(imagePos).updateAttributes("image", { width: 240 }).run();

    expect(editor.getAttributes("image").width).toBe(240);
    expect(editor.getHTML()).toContain('width="240px"');

    editor.destroy();
  });
});
