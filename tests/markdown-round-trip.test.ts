/**
 * @jest-environment jsdom
 *
 * Markdown round-trip tests for the Tiptap WYSIWYG editor.
 * Each test parses markdown into the editor then serializes back and
 * verifies the output matches the input (or contains the expected nodes).
 */

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";

type MarkdownStorage = { markdown: { getMarkdown(): string } };

function createEditor(markdown: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);

  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: {} }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, tightLists: true, breaks: false }),
    ],
    content: markdown,
  });
}

function roundTrip(markdown: string): string {
  const editor = createEditor(markdown);
  const result = (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown();
  editor.destroy();
  return result.trim();
}

describe("Markdown round-trip", () => {
  test("bold", () => {
    expect(roundTrip("**hello world**")).toBe("**hello world**");
  });

  test("italic", () => {
    const result = roundTrip("_hello world_");
    // tiptap-markdown normalizes to asterisk form
    expect(result).toMatch(/^\*hello world\*$|^_hello world_$/);
  });

  test("H1", () => {
    expect(roundTrip("# Heading One")).toBe("# Heading One");
  });

  test("H2", () => {
    expect(roundTrip("## Heading Two")).toBe("## Heading Two");
  });

  test("H3", () => {
    expect(roundTrip("### Heading Three")).toBe("### Heading Three");
  });

  test("inline code", () => {
    const md = "`const x = 1`";
    expect(roundTrip(md)).toBe(md);
  });

  test("code block", () => {
    const input = "```\nconst x = 1;\n```";
    const result = roundTrip(input);
    expect(result).toContain("```");
    expect(result).toContain("const x = 1;");
  });

  test("ordered list", () => {
    const md = "1. First\n2. Second\n3. Third";
    expect(roundTrip(md)).toBe(md);
  });

  test("unordered list", () => {
    const md = "- Apple\n- Banana\n- Cherry";
    expect(roundTrip(md)).toBe(md);
  });

  test("task list", () => {
    const result = roundTrip("- [ ] Todo\n- [x] Done");
    expect(result).toContain("- [ ] Todo");
    expect(result).toContain("- [x] Done");
  });

  test("blockquote", () => {
    expect(roundTrip("> This is a blockquote")).toBe("> This is a blockquote");
  });

  test("mixed content preserves structure", () => {
    const input = "# Title\n\nSome **bold** and _italic_ text.\n\n- Item one\n- Item two";
    const result = roundTrip(input);
    expect(result).toContain("# Title");
    expect(result).toContain("**bold**");
    expect(result).toMatch(/_italic_|\*italic\*/); // normalizes to asterisk or underscore
    expect(result).toContain("- Item one");
  });
});
