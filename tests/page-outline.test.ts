/** @jest-environment jsdom */

import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";
import { buildPageOutline, outlineBranchKeys, outlineDefaultExpandedKeys } from "@/lib/page-outline";
import { documentHasPageToc, removePageToc } from "@/lib/page-toc";

function makeEditor(content: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: createEditorExtensions(), content });
}

describe("page outline", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("groups H1–H3 by level and keeps later H1 headings at the root", () => {
    const editor = makeEditor("<h1>One</h1><h2>Two</h2><h3>Three</h3><h2>Four</h2><h1>Five</h1>");
    const tree = buildPageOutline(editor.state.doc);
    expect(tree.map((entry) => entry.title)).toEqual(["One", "Five"]);
    expect(tree[0].children.map((entry) => entry.title)).toEqual(["Two", "Four"]);
    expect(tree[0].children[0].children[0].title).toBe("Three");
    expect(outlineBranchKeys(tree)).toEqual([tree[0].key, tree[0].children[0].key]);
    editor.destroy();
  });

  it("defaults to one level expanded so sections show under main headings", () => {
    const editor = makeEditor("<h1>One</h1><h2>Two</h2><h3>Three</h3><h1>Five</h1>");
    const tree = buildPageOutline(editor.state.doc);
    expect(outlineDefaultExpandedKeys(tree)).toEqual([tree[0].key]);
    editor.destroy();
  });

  it("can strip a legacy pageToc node from a saved page", () => {
    const editor = makeEditor('<nav data-page-toc="true"></nav><h1>Existing</h1><h2>Child</h2>');
    expect(documentHasPageToc(editor.state.doc)).toBe(true);
    expect(buildPageOutline(editor.state.doc)[0].children[0].title).toBe("Child");
    expect(removePageToc(editor)).toEqual({ ok: true, action: "removed", entryCount: 0 });
    expect(documentHasPageToc(editor.state.doc)).toBe(false);
    expect(editor.getHTML()).not.toContain("data-page-toc");
    expect(buildPageOutline(editor.state.doc)[0].children[0].title).toBe("Child");
    editor.destroy();
  });
});
