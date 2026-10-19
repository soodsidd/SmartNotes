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

function selectImage(editor: Editor) {
  let imagePos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image") imagePos = pos;
  });
  expect(imagePos).toBeGreaterThanOrEqual(0);
  editor.commands.setNodeSelection(imagePos);
  return imagePos;
}

describe("image layout extension (SN-59)", () => {
  test("persists width and alignment attributes through getHTML", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.setImage({ src: "/vault/nb/sec/page.assets/chart.png", alt: "chart" });
    // Inline images leave a text caret after insert — select the node before layout cmds.
    // Align and width each need a fresh NodeSelection — chaining both after one
    // setNodeSelection can drop the second updateAttributes for inline images.
    const imagePos = selectImage(editor);
    editor.chain().focus().setNodeSelection(imagePos).setImageAlign("center").run();
    editor.chain().focus().setNodeSelection(imagePos).setImageWidth("50%").run();

    const html = editor.getHTML();
    expect(html).toContain('data-align="center"');
    expect(html).toMatch(/width="50%"/);
    expect(html).toContain('style="width: 50%; height: auto;"');

    editor.destroy();
  });

  test("reloads saved image layout markup", () => {
    const html =
      '<img class="editor-image" src="/vault/nb/sec/page.assets/chart.png" alt="chart" data-align="right" width="75%" style="width: 75%; height: auto;">';
    const editor = makeEditor(html);
    selectImage(editor);
    expect(editor.getAttributes("image").align).toBe("right");
    expect(editor.getAttributes("image").width).toBe("75%");
    editor.destroy();
  });
});
