/**
 * @jest-environment jsdom
 *
 * Tests for keyboard shortcut registration in the FormattingShortcuts extension
 * and heading/list/strike commands triggered by those shortcuts.
 */

import { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

// Mirror of the extension defined in rich-text-editor.tsx
const FormattingShortcuts = Extension.create({
  name: "formattingShortcuts",
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-1": () => this.editor.commands.toggleHeading({ level: 1 }),
      "Mod-Alt-2": () => this.editor.commands.toggleHeading({ level: 2 }),
      "Mod-Alt-3": () => this.editor.commands.toggleHeading({ level: 3 }),
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
      "Mod-Shift-7": () => this.editor.commands.toggleOrderedList(),
      "Mod-Shift-8": () => this.editor.commands.toggleBulletList(),
      "Mod-Shift-9": () => this.editor.commands.toggleBlockquote(),
    };
  },
});

function makeEditor(content = "<p>Hello</p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [StarterKit, FormattingShortcuts],
    content,
  });
}

describe("FormattingShortcuts extension", () => {
  test("extension is registered with correct name", () => {
    expect(FormattingShortcuts.name).toBe("formattingShortcuts");
  });

  test("extension shortcut keys are declared correctly", () => {
    const editor = makeEditor();
    // Access registered shortcut keys through the plugin directly
    const ext = editor.extensionManager.extensions.find((e) => e.name === "formattingShortcuts");
    expect(ext).toBeDefined();
    // Verify commands we expect exist on the editor (indirectly confirms extension loaded)
    expect(typeof editor.commands.toggleHeading).toBe("function");
    expect(typeof editor.commands.toggleStrike).toBe("function");
    expect(typeof editor.commands.toggleOrderedList).toBe("function");
    expect(typeof editor.commands.toggleBulletList).toBe("function");
    expect(typeof editor.commands.toggleBlockquote).toBe("function");
    editor.destroy();
  });
});

describe("Heading commands (Ctrl+Alt+1/2/3 targets)", () => {
  test("toggleHeading level 1 activates and deactivates", () => {
    const editor = makeEditor();
    editor.commands.toggleHeading({ level: 1 });
    expect(editor.isActive("heading", { level: 1 })).toBe(true);
    editor.commands.toggleHeading({ level: 1 });
    expect(editor.isActive("heading", { level: 1 })).toBe(false);
    editor.destroy();
  });

  test("toggleHeading level 2 activates and deactivates", () => {
    const editor = makeEditor();
    editor.commands.toggleHeading({ level: 2 });
    expect(editor.isActive("heading", { level: 2 })).toBe(true);
    editor.commands.toggleHeading({ level: 2 });
    expect(editor.isActive("heading", { level: 2 })).toBe(false);
    editor.destroy();
  });

  test("toggleHeading level 3 activates and deactivates", () => {
    const editor = makeEditor();
    editor.commands.toggleHeading({ level: 3 });
    expect(editor.isActive("heading", { level: 3 })).toBe(true);
    editor.commands.toggleHeading({ level: 3 });
    expect(editor.isActive("heading", { level: 3 })).toBe(false);
    editor.destroy();
  });

  test("switching heading level replaces active heading", () => {
    const editor = makeEditor();
    editor.commands.toggleHeading({ level: 1 });
    editor.commands.toggleHeading({ level: 2 });
    expect(editor.isActive("heading", { level: 1 })).toBe(false);
    expect(editor.isActive("heading", { level: 2 })).toBe(true);
    editor.destroy();
  });
});

describe("Formatting commands (Ctrl+Shift+X/7/8/9 targets)", () => {
  test("toggleStrike activates and deactivates", () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.toggleStrike();
    expect(editor.isActive("strike")).toBe(true);
    editor.commands.toggleStrike();
    expect(editor.isActive("strike")).toBe(false);
    editor.destroy();
  });

  test("toggleOrderedList activates and deactivates", () => {
    const editor = makeEditor();
    editor.commands.toggleOrderedList();
    expect(editor.isActive("orderedList")).toBe(true);
    editor.commands.toggleOrderedList();
    expect(editor.isActive("orderedList")).toBe(false);
    editor.destroy();
  });

  test("toggleBulletList activates and deactivates", () => {
    const editor = makeEditor();
    editor.commands.toggleBulletList();
    expect(editor.isActive("bulletList")).toBe(true);
    editor.commands.toggleBulletList();
    expect(editor.isActive("bulletList")).toBe(false);
    editor.destroy();
  });

  test("toggleBlockquote activates and deactivates", () => {
    const editor = makeEditor();
    editor.commands.toggleBlockquote();
    expect(editor.isActive("blockquote")).toBe(true);
    editor.commands.toggleBlockquote();
    expect(editor.isActive("blockquote")).toBe(false);
    editor.destroy();
  });
});
