/** @jest-environment jsdom */

import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";
import { buildPageOutline, outlineBranchKeys } from "@/lib/page-outline";

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

  it("reads headings without changing a saved pageToc node", () => {
    const editor = makeEditor('<nav data-page-toc="true"></nav><h1>Existing</h1><h2>Child</h2>');
    const before = editor.getHTML();
    expect(buildPageOutline(editor.state.doc)[0].children[0].title).toBe("Child");
    expect(editor.getHTML()).toBe(before);
    editor.destroy();
  });
});
