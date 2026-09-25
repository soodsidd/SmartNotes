/**
 * @jest-environment jsdom
 *
 * SN-125 markdown-aware paste: pasting Markdown (e.g. AI output copied from
 * ChatGPT) renders as rich text instead of dropping in literal syntax, while
 * ordinary prose and bare URLs are left untouched.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Editor } from "@tiptap/core";
import {
  createEditorExtensions,
  looksLikeMarkdown,
  parseMarkdownToTiptapJson,
} from "@/lib/rich-text-editor-config";

const EDITOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/rich-text-editor.tsx"),
  "utf8"
);

function makeEditor(content = "<p></p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: createEditorExtensions(), content });
}

describe("looksLikeMarkdown heuristic (SN-125)", () => {
  test.each([
    ["ATX heading", "## Project plan"],
    ["unordered list", "- first\n- second"],
    ["ordered list", "1. first\n2. second"],
    ["blockquote", "> a quote"],
    ["fenced code", "```ts\nconst x = 1;\n```"],
    ["bold", "This is **important** text"],
    ["underscore bold", "This is __important__ text"],
    ["inline code", "run `npm test` now"],
    ["link", "see [the docs](https://example.com)"],
    ["table row", "| a | b |\n| - | - |"],
  ])("detects Markdown: %s", (_label, input) => {
    expect(looksLikeMarkdown(input)).toBe(true);
  });

  test.each([
    ["empty", ""],
    ["plain prose", "Hello, this is just a normal note about the meeting."],
    ["bare url", "https://example.com/some/path?q=1"],
    ["mid-line dash", "Buy milk - and also eggs"],
  ])("leaves non-Markdown alone: %s", (_label, input) => {
    expect(looksLikeMarkdown(input)).toBe(false);
  });
});

describe("Markdown paste conversion (SN-125)", () => {
  test("converts a multi-part Markdown document to rich HTML", () => {
    const editor = makeEditor();
    const markdown = "## Heading\n\n- one\n- two\n\nSome **bold** text.";
    editor.chain().focus().insertContent(parseMarkdownToTiptapJson(markdown)).run();
    const html = editor.getHTML();
    expect(html).toContain("<h2>");
    expect(html).toMatch(/<ul[\s>]/);
    expect(html).toMatch(/<li[\s>]/);
    expect(html).toContain("<strong>bold</strong>");
    // The garbled failure mode is literal syntax surviving as text.
    expect(html).not.toContain("## Heading");
    expect(html).not.toContain("**bold**");
    editor.destroy();
  });
});

describe("paste wiring in rich-text-editor.tsx (SN-125)", () => {
  test("handlePaste routes plain-text Markdown through the converter", () => {
    expect(EDITOR_SRC).toMatch(/handlePaste[\s\S]*looksLikeMarkdown[\s\S]*parseMarkdownToTiptapJson/);
  });

  test("handlePaste prefers rich HTML clipboard over Markdown conversion", () => {
    expect(EDITOR_SRC).toContain('clipboard.getData("text/html")');
  });

  test("manual paste button applies the same Markdown conversion", () => {
    expect(EDITOR_SRC).toMatch(/pasteFromClipboard[\s\S]*looksLikeMarkdown/);
  });

  test("Ctrl/Cmd+Shift+V arms a raw-paste escape hatch", () => {
    expect(EDITOR_SRC).toContain("plainPasteArmedRef");
  });
});
