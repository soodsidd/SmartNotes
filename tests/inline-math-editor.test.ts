/**
 * @jest-environment jsdom
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";
import { setMathNodeClickHandler } from "@/lib/editor-mathematics";

const RICH_TEXT_EDITOR_SRC = readFileSync(
  path.join(process.cwd(), "src/components/rich-text-editor.tsx"),
  "utf8"
);

function makeEditor(content = "<p>Hello </p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content,
  });
}

describe("inline math editor integration (SN-111)", () => {
  test("Alt+= routes to inline compose instead of top dialog", () => {
    expect(RICH_TEXT_EDITOR_SRC).toContain("startInlineMathCompose");
    expect(RICH_TEXT_EDITOR_SRC).toContain('data-testid="inline-math-compose"');
    expect(RICH_TEXT_EDITOR_SRC).toContain("commitInlineMathCompose");
    expect(RICH_TEXT_EDITOR_SRC).toMatch(/event\.altKey && event\.key === "="[\s\S]*startInlineMathCompose/);
  });

  test("block math insertion still opens the dialog (compose is edit-only)", () => {
    expect(RICH_TEXT_EDITOR_SRC).toContain("openMathDialog(true)");
  });

  test("SN-158: existing-equation edits never open the top-of-page dialog", () => {
    // The legacy edit route is gone; both inline and block edits go through the
    // caret-anchored compose editor.
    expect(RICH_TEXT_EDITOR_SRC).not.toContain("openMathDialogForEdit");
    // Block click/selection routes into the anchored compose with block=true.
    expect(RICH_TEXT_EDITOR_SRC).toMatch(
      /startInlineMathComposeFromNode\([^)]*kind === "block"\)/
    );
    expect(RICH_TEXT_EDITOR_SRC).toMatch(/deleteBlockMath|updateBlockMath|insertBlockMath/);
  });

  test("clicking inline math reopens compose with existing latex", () => {
    expect(RICH_TEXT_EDITOR_SRC).toContain("setMathNodeClickHandler");
    expect(RICH_TEXT_EDITOR_SRC).toContain("updateInlineMath");
    expect(RICH_TEXT_EDITOR_SRC).toContain("startInlineMathComposeFromNode");
  });

  test("arrowing into inline math enters compose from NodeSelection", () => {
    expect(RICH_TEXT_EDITOR_SRC).toContain("enterMathEditFromSelection");
    expect(RICH_TEXT_EDITOR_SRC).toContain("NodeSelection");
    expect(RICH_TEXT_EDITOR_SRC).toContain("inferInlineMathResumePos");
    expect(RICH_TEXT_EDITOR_SRC).toContain("setTextSelection(resumePos)");
  });

  test("insertInlineMath at caret preserves latex through serialization", () => {
    const editor = makeEditor("<p>Before </p>");
    editor.commands.setTextSelection(8);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inserted = (editor.commands as any).insertInlineMath({ latex: "λ" });
    expect(inserted).toBe(true);

    const html = editor.getHTML();
    expect(html).toContain('data-type="inline-math"');
    expect(html).toContain('data-latex="λ"');

    const json = editor.getJSON();
    const para = json.content?.[0];
    const mathNode = para?.content?.find((n: { type: string }) => n.type === "inlineMath");
    expect(mathNode?.attrs?.latex).toBe("λ");

    editor.destroy();
  });

  test("updateInlineMath re-renders stacked fractions", () => {
    const editor = makeEditor("<p></p>");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.commands as any).insertInlineMath({ latex: "x" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.commands as any).updateInlineMath({ latex: "\\frac{a}{b}", pos: 1 });
    expect(editor.view.dom.querySelector(".mfrac")).toBeTruthy();
    editor.destroy();
  });

  test("math node click handler is wired through editor mathematics bridge", () => {
    const clicks: Array<{ kind: string; latex: string }> = [];
    setMathNodeClickHandler(({ kind, node }) => {
      clicks.push({ kind, latex: String(node.attrs.latex ?? "") });
    });
    const editor = makeEditor(
      '<p><span data-type="inline-math" data-latex="E=mc^2"></span></p>'
    );
    const mathEl = editor.view.dom.querySelector(".tiptap-mathematics-render") as HTMLElement;
    mathEl?.click();
    expect(clicks).toEqual([{ kind: "inline", latex: "E=mc^2" }]);
    setMathNodeClickHandler(null);
    editor.destroy();
  });

  // ── SN-158: block equation in-context editing ─────────────────────────────

  function blockMathNodes(editor: Editor) {
    const nodes: Array<{ pos: number; latex: string }> = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "blockMath") {
        nodes.push({ pos, latex: String(node.attrs.latex ?? "") });
      }
    });
    return nodes;
  }

  test("clicking a block equation routes through the bridge as kind 'block'", () => {
    const clicks: Array<{ kind: string; latex: string }> = [];
    setMathNodeClickHandler(({ kind, node }) => {
      clicks.push({ kind, latex: String(node.attrs.latex ?? "") });
    });
    const editor = makeEditor('<div data-type="block-math" data-latex="a^2+b^2"></div>');
    const mathEl = editor.view.dom.querySelector(
      '[data-type="block-math"] .tiptap-mathematics-render, [data-type="block-math"]'
    ) as HTMLElement;
    mathEl?.click();
    expect(clicks).toEqual([{ kind: "block", latex: "a^2+b^2" }]);
    setMathNodeClickHandler(null);
    editor.destroy();
  });

  test("updateBlockMath edits in place: stays block, no duplicate, latex preserved", () => {
    const editor = makeEditor("<p></p>");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.commands as any).insertBlockMath({ latex: "x" });
    const [before] = blockMathNodes(editor);
    expect(before).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor.commands as any).updateBlockMath({ latex: "\\frac{a}{b}", pos: before.pos });

    const after = blockMathNodes(editor);
    expect(after).toHaveLength(1); // no duplicate node inserted
    expect(after[0].latex).toBe("\\frac{a}{b}");
    // Type is preserved (still block, never downgraded to inline).
    const html = editor.getHTML();
    expect(html).toContain('data-type="block-math"');
    expect(html).not.toContain('data-type="inline-math"');
    editor.destroy();
  });

  test("block math survives HTML round-trip with its latex and type", () => {
    const editor = makeEditor('<div data-type="block-math" data-latex="E=mc^2"></div>');
    const nodes = blockMathNodes(editor);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].latex).toBe("E=mc^2");
    expect(editor.getHTML()).toContain('data-latex="E=mc^2"');
    editor.destroy();
  });
});
