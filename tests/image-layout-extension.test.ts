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

describe("image layout extension (SN-59)", () => {
  test("persists width and alignment attributes through getHTML", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.setImage({ src: "/vault/nb/sec/page.assets/chart.png", alt: "chart" });
    editor.commands.setImageAlign("center");
    editor.commands.setImageWidth("50%");

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
    expect(editor.getAttributes("image").align).toBe("right");
    expect(editor.getAttributes("image").width).toBe("75%");
    editor.destroy();
  });
});
