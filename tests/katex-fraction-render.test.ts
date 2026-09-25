/**
 * @jest-environment jsdom
 */

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Mathematics } from "@tiptap/extension-mathematics";

function makeEditor(content = "<p></p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [StarterKit, Mathematics],
    content,
  });
}

describe("inline math fraction rendering", () => {
  test("\\frac{a}{b} renders stacked fraction via KaTeX", () => {
    const editor = makeEditor("<p></p>");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.commands as any).insertInlineMath({ latex: "\\frac{a}{b}" });
    const root = editor.view.dom;
    expect(root.querySelector(".mfrac")).toBeTruthy();
    editor.destroy();
  });

  test("normalized HTML round-trip preserves fraction rendering", () => {
    const html = '<p><span data-type="inline-math" data-latex="\\frac{a}{b}"></span></p>';
    const editor = makeEditor(html);
    const root = editor.view.dom;
    expect(root.querySelector(".mfrac")).toBeTruthy();
    editor.destroy();
  });
});
