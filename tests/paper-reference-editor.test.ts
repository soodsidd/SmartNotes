/** @jest-environment jsdom */
import { Editor } from "@tiptap/core";
import { createEditorExtensions, setEditorHtmlSilent } from "@/lib/rich-text-editor-config";
import { paperReferenceHtml, paperReferenceIds } from "@/lib/papers";
import { buildPageTree, buildPageNestingActionLookup, flattenPageTree } from "@/lib/page-tree";
import { flushPaperFrame } from "@/lib/inline-paper-save";
import type { VaultPage } from "@/lib/vault-contract";

const id = "12345678-1234-4567-8123-123456789abc";

test("editor round-trips paper identity without saving inline body or presentation", () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: `<p>Article</p>${paperReferenceHtml(id)}` });
  expect(paperReferenceIds(editor.getHTML())).toEqual([id]);
  expect(editor.getHTML()).not.toContain("iframe");
  setEditorHtmlSilent(editor, editor.getHTML());
  expect(paperReferenceIds(editor.getHTML())).toEqual([id]);
  editor.commands.selectAll();
  editor.commands.deleteSelection();
  expect(paperReferenceIds(editor.getHTML())).toEqual([]);
  editor.destroy();
});

test("paper references leave the page tree and nesting targets unchanged", () => {
  const parent: VaultPage = { id: "parent", path: "parent", title: "Parent", slug: "parent", content: paperReferenceHtml(id), preview: "", noteType: "text", createdAt: null, updatedAt: null, parentId: null };
  const sibling = { ...parent, id: "sibling", path: "sibling", content: "" };
  const nodes = flattenPageTree(buildPageTree([parent, sibling]), new Set([parent.path]));
  expect(nodes.map((node) => node.page.path)).toEqual([parent.path, sibling.path]);
  expect(buildPageNestingActionLookup(nodes).get("sibling")?.indentParentId).toBe(parent.path);
});

test("inline close accepts only a matching same-origin save acknowledgement", async () => {
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "request-1" });
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const pending = flushPaperFrame(frame);
  window.dispatchEvent(new MessageEvent("message", { origin: "https://untrusted.example", source: frame.contentWindow, data: { type: "paper-flushed", requestId: "request-1", saved: true } }));
  window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: frame.contentWindow, data: { type: "paper-flushed", requestId: "request-1", saved: false } }));
  await expect(pending).resolves.toBe(false);
  frame.remove();
});
