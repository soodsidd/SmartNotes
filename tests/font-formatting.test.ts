/**
 * @jest-environment jsdom
 *
 * SN-10: Font family and font size controls — editor round-trip tests.
 */

import { Editor } from "@tiptap/core";
import { createEditorExtensions, FONT_FAMILIES, FONT_SIZES } from "@/lib/rich-text-editor-config";

function makeEditor(content = "<p>Hello world</p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content,
  });
}

describe("font formatting extensions (SN-10)", () => {
  test("registers fontFamily and fontSize extensions", () => {
    const editor = makeEditor();
    const names = editor.extensionManager.extensions.map((ext) => ext.name);
    expect(names).toContain("fontFamily");
    expect(names).toContain("fontSize");
    editor.destroy();
  });

  test("setFontFamily persists inline font-family through getHTML", () => {
    const editor = makeEditor("<p>Styled text</p>");
    editor.commands.selectAll();
    editor.commands.setFontFamily("var(--font-sans)");
    const html = editor.getHTML();
    expect(html).toContain("font-family");
    expect(html).toContain("var(--font-sans)");
    editor.destroy();
  });

  test("setFontSize persists inline font-size through getHTML", () => {
    const editor = makeEditor("<p>Sized text</p>");
    editor.commands.selectAll();
    editor.commands.setFontSize("22px");
    const html = editor.getHTML();
    expect(html).toContain("font-size");
    expect(html).toContain("22px");
    editor.destroy();
  });

  test("unsetFontFamily removes font-family from span", () => {
    const editor = makeEditor('<p><span style="font-family: var(--font-mono)">mono text</span></p>');
    editor.commands.selectAll();
    editor.commands.unsetFontFamily();
    expect(editor.getHTML()).not.toContain("font-family");
    editor.destroy();
  });

  test("unsetFontSize removes font-size from span", () => {
    const editor = makeEditor('<p><span style="font-size: 22px">large text</span></p>');
    editor.commands.selectAll();
    editor.commands.unsetFontSize();
    expect(editor.getHTML()).not.toContain("font-size");
    editor.destroy();
  });

  test("loads saved HTML with font-family and font-size and round-trips them", () => {
    const html = '<p><span style="font-family: var(--font-serif); font-size: 18px">serif large</span></p>';
    const editor = makeEditor(html);
    const output = editor.getHTML();
    expect(output).toContain("font-family");
    expect(output).toContain("var(--font-serif)");
    expect(output).toContain("font-size");
    expect(output).toContain("18px");
    editor.destroy();
  });

  test("all FONT_FAMILIES round-trip through the editor", () => {
    for (const family of FONT_FAMILIES) {
      const editor = makeEditor("<p>test</p>");
      editor.commands.selectAll();
      editor.commands.setFontFamily(family.value);
      const html = editor.getHTML();
      expect(html).toContain(family.value);
      editor.destroy();
    }
  });

  test("all FONT_SIZES round-trip through the editor", () => {
    for (const size of FONT_SIZES) {
      const editor = makeEditor("<p>test</p>");
      editor.commands.selectAll();
      editor.commands.setFontSize(size.value);
      const html = editor.getHTML();
      expect(html).toContain(size.value);
      editor.destroy();
    }
  });

  test("FONT_FAMILIES exports three families including all app fonts", () => {
    expect(FONT_FAMILIES).toHaveLength(3);
    const labels = FONT_FAMILIES.map((f) => f.label);
    expect(labels.filter((label) => label === "Hanken Grotesk")).toHaveLength(1);
    expect(labels).toContain("JetBrains Mono");
    expect(labels).toContain("Caveat");
  });

  test("FONT_SIZES exports four presets at the correct pixel values", () => {
    expect(FONT_SIZES).toHaveLength(4);
    const values = FONT_SIZES.map((s) => s.value);
    expect(values).toContain("14px");
    expect(values).toContain("16px");
    expect(values).toContain("18px");
    expect(values).toContain("22px");
  });

  test("desktop format-bar source includes font-family and font-size toolbar triggers", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src: string = fs.readFileSync(
      path.resolve(__dirname, "../src/components/rich-text-editor.tsx"),
      "utf8"
    );
    expect(src).toContain('data-testid="toolbar-font-family"');
    expect(src).toContain('data-testid="toolbar-font-size"');
  });
});
