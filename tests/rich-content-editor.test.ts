/**
 * @jest-environment jsdom
 *
 * SN-8 rich content: highlight, text color, horizontal rule, images,
 * file attachments, and mobile toolbar structure.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Editor } from "@tiptap/core";
import { createEditorExtensions, TEXT_COLOR_PALETTE } from "@/lib/rich-text-editor-config";

const EDITOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/rich-text-editor.tsx"),
  "utf8"
);
const DRAW_TOOLBAR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/annotation-draw-toolbar.tsx"),
  "utf8"
);

function makeEditor(content = "<p>Hello world</p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content,
  });
}

describe("rich content extensions (SN-8)", () => {
  test("registers highlight, color, image, and file attachment extensions", () => {
    const editor = makeEditor();
    const names = editor.extensionManager.extensions.map((ext) => ext.name);
    expect(names).toContain("highlight");
    expect(names).toContain("textStyle");
    expect(names).toContain("color");
    expect(names).toContain("image");
    expect(names).toContain("fileAttachment");
    editor.destroy();
  });

  test("toggleHighlight persists <mark> through getHTML", () => {
    const editor = makeEditor("<p>Select me</p>");
    editor.commands.selectAll();
    editor.commands.toggleHighlight();
    expect(editor.getHTML()).toContain("<mark>");
    editor.destroy();
  });

  test("setColor persists inline color through getHTML", () => {
    const editor = makeEditor("<p>Color me</p>");
    editor.commands.selectAll();
    editor.commands.setColor("#dc2626");
    const html = editor.getHTML();
    expect(html).toMatch(/color:\s*(#dc2626|rgb\(220,\s*38,\s*38\))/);
    editor.destroy();
  });

  test("setHorizontalRule inserts <hr>", () => {
    const editor = makeEditor("<p>Before</p>");
    editor.commands.setHorizontalRule();
    expect(editor.getHTML()).toContain("<hr");
    editor.destroy();
  });

  test("insertFileAttachment renders attachment chip markup", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.insertFileAttachment({
      href: "/vault/Notebook/Section/page.assets/spec.pdf",
      fileName: "spec.pdf",
    });
    const html = editor.getHTML();
    expect(html).toContain("file-attachment-chip");
    expect(html).toContain('data-file-type="pdf"');
    expect(html).toContain("file-attachment-chip--pdf");
    expect(html).toContain("file-attachment-icon");
    expect(html).toContain("spec.pdf");
    expect(html).toContain('data-href="/vault/Notebook/Section/page.assets/spec.pdf"');
    expect(html).not.toContain('target="_blank"');
    editor.destroy();
  });

  test("loads saved HTML with highlight, color, hr, image, and attachment", () => {
    const html = [
      "<p>Highlighted <mark>important</mark> text</p>",
      '<p><span style="color: #dc2626">Red words</span></p>',
      "<hr>",
      '<img src="/vault/Notebook/Section/rich.assets/chart.png" alt="chart" />',
      '<span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="/vault/Notebook/Section/rich.assets/spec.pdf">spec.pdf</span></span>',
    ].join("");
    const editor = makeEditor(html);
    const output = editor.getHTML();
    expect(output).toContain("<mark>important</mark>");
    expect(output).toMatch(/color:\s*(#dc2626|rgb\(220,\s*38,\s*38\))/);
    expect(output).toContain("<hr");
    expect(output).toContain("file-attachment-chip");
    expect(output).toContain('data-file-type="pdf"');
    editor.destroy();
  });

  test("TEXT_COLOR_PALETTE exposes eight swatches", () => {
    expect(TEXT_COLOR_PALETTE).toHaveLength(8);
    expect(TEXT_COLOR_PALETTE).toContain("#dc2626");
  });
});

describe("mobile rich-content toolbar (SN-8)", () => {
  test("exposes highlight, image, and attachment controls in mobile insert overflow", () => {
    expect(EDITOR_SRC).toContain('data-testid="format-bar-mobile"');
    expect(EDITOR_SRC).toContain('"toolbar-highlight-mobile"');
    expect(EDITOR_SRC).toContain('"toolbar-image-mobile"');
    expect(EDITOR_SRC).toContain('"toolbar-attachment-mobile"');
    expect(EDITOR_SRC).toContain('"toolbar-insert-menu-mobile"');
  });

  test("wraps mobile text color menu label in DropdownMenuGroup", () => {
    const colorMenuStart = EDITOR_SRC.indexOf('"toolbar-color-menu-mobile"');
    expect(colorMenuStart).toBeGreaterThan(-1);
    const colorMenuBlock = EDITOR_SRC.slice(colorMenuStart, colorMenuStart + 900);
    expect(colorMenuBlock).toContain("DropdownMenuGroup");
    expect(colorMenuBlock).toContain("DropdownMenuLabel");
    expect(colorMenuBlock.indexOf("DropdownMenuGroup")).toBeLessThan(
      colorMenuBlock.indexOf("DropdownMenuLabel")
    );
  });

  test("wraps desktop font submenu labels in DropdownMenuGroup", () => {
    const fontMenuStart = EDITOR_SRC.indexOf('"toolbar-font-family"');
    expect(fontMenuStart).toBeGreaterThan(-1);
    const fontMenuBlock = EDITOR_SRC.slice(fontMenuStart, fontMenuStart + 1800);
    expect(fontMenuBlock).toContain("DropdownMenuGroup");
    expect(fontMenuBlock).toContain("Font family");
    expect(fontMenuBlock).toContain("Font size");
    const familyLabelIndex = fontMenuBlock.indexOf("Font family");
    const familyGroupIndex = fontMenuBlock.lastIndexOf("DropdownMenuGroup", familyLabelIndex);
    expect(familyGroupIndex).toBeGreaterThan(-1);
    const sizeLabelIndex = fontMenuBlock.indexOf("Font size");
    const sizeGroupIndex = fontMenuBlock.lastIndexOf("DropdownMenuGroup", sizeLabelIndex);
    expect(sizeGroupIndex).toBeGreaterThan(familyGroupIndex);
  });

  test("bubble menu includes highlight shortcut", () => {
    expect(EDITOR_SRC).toContain('data-testid="bubble-menu"');
    expect(EDITOR_SRC).toContain("toggleHighlight");
  });

  test("mobile bubble menu exposes copy and comment selection actions", () => {
    expect(EDITOR_SRC).toContain('"bubble-copy-mobile"');
    expect(EDITOR_SRC).toContain('"bubble-comment-mobile"');
    expect(EDITOR_SRC).toContain('label="Copy"');
    expect(EDITOR_SRC).toContain('label="Comment"');
  });
});

describe("Clarity editor toolbar (SN-42)", () => {
  test("desktop format bar uses consolidated dropdown groups", () => {
    expect(EDITOR_SRC).toContain('"toolbar-aa"');
    expect(EDITOR_SRC).toContain('"toolbar-list-menu"');
    expect(EDITOR_SRC).toContain('"toolbar-insert-menu"');
    expect(EDITOR_SRC).toContain('"toolbar-color-menu"');
    expect(EDITOR_SRC).not.toContain("annotation-done-button");
  });

  test("exposes Today date insert in desktop and mobile insert menus", () => {
    expect(EDITOR_SRC).toContain('"toolbar-insert-today"');
    expect(EDITOR_SRC).toContain('"toolbar-insert-today-mobile"');
    expect(EDITOR_SRC).toContain('label="Today"');
    expect(EDITOR_SRC).toContain("formatLocalDate");
  });

  test("draw toolbar exits via explicit X button, not pen toggle or Done", () => {
    expect(DRAW_TOOLBAR_SRC).toContain("onExitDrawMode");
    expect(DRAW_TOOLBAR_SRC).toContain('"ink-exit-draw"');
    expect(DRAW_TOOLBAR_SRC).toContain("toolbar-btn--exit");
    expect(DRAW_TOOLBAR_SRC).not.toContain("annotation-done-button");
    expect(DRAW_TOOLBAR_SRC).not.toMatch(/activeTool === "draw"\)[\s\S]*onExitDrawMode/);
  });
});
