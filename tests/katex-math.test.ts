/**
 * @jest-environment jsdom
 *
 * Tests for KaTeX / Mathematics extension integration.
 * Covers inline math insertion, block math insertion, and that
 * the extension registers correctly alongside StarterKit.
 */

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Mathematics } from "@tiptap/extension-mathematics";

function makeEditor(content = "<p>Hello</p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [StarterKit, Mathematics],
    content,
  });
}

describe("Mathematics extension registration", () => {
  test("extension is loaded and named correctly", () => {
    const editor = makeEditor();
    const ext = editor.extensionManager.extensions.find((e) => e.name === "Mathematics" || e.name === "inlineMath" || e.name === "blockMath");
    expect(ext).toBeDefined();
    editor.destroy();
  });

  test("insertInlineMath command exists", () => {
    const editor = makeEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (editor.commands as any).insertInlineMath).toBe("function");
    editor.destroy();
  });

  test("insertBlockMath command exists", () => {
    const editor = makeEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (editor.commands as any).insertBlockMath).toBe("function");
    editor.destroy();
  });
});

describe("Inline math insertion", () => {
  test("inserts an inlineMath node with correct latex attribute", () => {
    const editor = makeEditor("<p>Before </p>");
    editor.commands.selectAll();
    editor.commands.setTextSelection({ from: 8, to: 8 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.commands as any).insertInlineMath({ latex: "E = mc^2" });
    const doc = editor.getJSON();
    const para = doc.content?.[0];
    const mathNode = para?.content?.find((n: { type: string }) => n.type === "inlineMath");
    expect(mathNode).toBeDefined();
    expect(mathNode?.attrs?.latex).toBe("E = mc^2");
    editor.destroy();
  });

  test("empty latex string does not insert a node", () => {
    const editor = makeEditor("<p>Hello</p>");
    const before = JSON.stringify(editor.getJSON());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (editor.commands as any).insertInlineMath({ latex: "" });
    expect(result).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    editor.destroy();
  });
});

describe("Block math insertion", () => {
  test("inserts a blockMath node with correct latex attribute", () => {
    const editor = makeEditor("<p>Hello</p>");
    editor.commands.setTextSelection({ from: 6, to: 6 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.commands as any).insertBlockMath({ latex: "\\frac{a}{b}" });
    const doc = editor.getJSON();
    const mathBlock = doc.content?.find((n: { type: string }) => n.type === "blockMath");
    expect(mathBlock).toBeDefined();
    expect(mathBlock?.attrs?.latex).toBe("\\frac{a}{b}");
    editor.destroy();
  });

  test("empty latex string does not insert a node", () => {
    const editor = makeEditor("<p>Hello</p>");
    const before = JSON.stringify(editor.getJSON());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (editor.commands as any).insertBlockMath({ latex: "" });
    expect(result).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    editor.destroy();
  });
});

describe("Normalized HTML round-trip (SN-71)", () => {
  test("editor parses normalized inline-math span to inlineMath node", () => {
    const html = '<p>Value: <span data-type="inline-math" data-latex="E = mc^2"></span>.</p>';
    const editor = makeEditor(html);
    const json = editor.getJSON();
    const para = json.content?.[0];
    const mathNode = para?.content?.find((n: { type: string }) => n.type === "inlineMath");
    expect(mathNode).toBeDefined();
    expect(mathNode?.attrs?.latex).toBe("E = mc^2");
    editor.destroy();
  });

  test("editor parses normalized block-math div to blockMath node", () => {
    const html = '<div data-type="block-math" data-latex="\\frac{a}{b}"></div>';
    const editor = makeEditor(html);
    const json = editor.getJSON();
    const mathBlock = json.content?.find((n: { type: string }) => n.type === "blockMath");
    expect(mathBlock).toBeDefined();
    expect(mathBlock?.attrs?.latex).toBe("\\frac{a}{b}");
    editor.destroy();
  });
});

describe("Math latex preservation", () => {
  test("complex inline formula preserves latex string exactly", () => {
    const editor = makeEditor("<p></p>");
    const latex = "\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.commands as any).insertInlineMath({ latex });
    const doc = editor.getJSON();
    const para = doc.content?.[0];
    const mathNode = para?.content?.find((n: { type: string }) => n.type === "inlineMath");
    expect(mathNode?.attrs?.latex).toBe(latex);
    editor.destroy();
  });

  test("complex block formula preserves latex string exactly", () => {
    const editor = makeEditor("<p></p>");
    const latex = "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.commands as any).insertBlockMath({ latex });
    const doc = editor.getJSON();
    const mathBlock = doc.content?.find((n: { type: string }) => n.type === "blockMath");
    expect(mathBlock?.attrs?.latex).toBe(latex);
    editor.destroy();
  });
});
