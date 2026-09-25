/**
 * @jest-environment jsdom
 *
 * SN-221: Escape blurs the rich-text editor; format-bar chrome blurs without
 * swallowing intentional toolbar control presses.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";
import {
  blurEditorOnEscape,
  handleFormatBarChromePointerDown,
  isFormatBarInteractiveTarget,
} from "@/lib/format-bar-focus";

const EDITOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/rich-text-editor.tsx"),
  "utf8"
);
const CONFIG_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/lib/rich-text-editor-config.ts"),
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

function fakeEditor(options: { focused?: boolean; blur?: () => boolean } = {}) {
  const blur = options.blur ?? jest.fn(() => true);
  return {
    isFocused: options.focused ?? true,
    commands: { blur },
  } as unknown as Editor;
}

describe("exit text editing (SN-221)", () => {
  test("FormattingShortcuts registers Escape blur", () => {
    expect(CONFIG_SRC).toMatch(/Escape:\s*\(\)\s*=>/);
    expect(CONFIG_SRC).toContain("commands.blur()");
    const editor = makeEditor();
    expect(editor.extensionManager.extensions.map((e) => e.name)).toContain(
      "formattingShortcuts"
    );
    editor.destroy();
  });

  test("blurEditorOnEscape calls blur when focused and is a no-op when not", () => {
    const blurFocused = jest.fn(() => true);
    expect(blurEditorOnEscape(fakeEditor({ focused: true, blur: blurFocused }))).toBe(true);
    expect(blurFocused).toHaveBeenCalledTimes(1);

    const blurIdle = jest.fn(() => true);
    expect(blurEditorOnEscape(fakeEditor({ focused: false, blur: blurIdle }))).toBe(false);
    expect(blurIdle).not.toHaveBeenCalled();
  });

  test("format-bar chrome targets are not interactive; buttons are", () => {
    const bar = document.createElement("div");
    bar.className = "format-bar";
    const sep = document.createElement("div");
    sep.className = "toolbar-sep";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Bold";
    bar.append(sep, btn);
    document.body.appendChild(bar);

    expect(isFormatBarInteractiveTarget(bar)).toBe(false);
    expect(isFormatBarInteractiveTarget(sep)).toBe(false);
    expect(isFormatBarInteractiveTarget(btn)).toBe(true);
    bar.remove();
  });

  test("chrome pointerdown blurs; button pointerdown does not preventDefault (ToolbarBtn uses mousedown)", () => {
    const blur = jest.fn(() => true);
    const editor = fakeEditor({ blur });

    const bar = document.createElement("div");
    const btn = document.createElement("button");
    btn.type = "button";
    bar.appendChild(btn);
    document.body.appendChild(bar);

    let prevented = false;
    handleFormatBarChromePointerDown(editor, {
      target: bar,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(blur).toHaveBeenCalledTimes(1);

    blur.mockClear();
    prevented = false;
    handleFormatBarChromePointerDown(editor, {
      target: btn,
      preventDefault: () => {
        prevented = true;
      },
    });
    // Must not cancel pointerdown — that would suppress mousedown and break TOC/Bold.
    expect(prevented).toBe(false);
    expect(blur).not.toHaveBeenCalled();

    // Sample toolbar action still applies on a real editor (format path).
    const live = makeEditor("<p>Bold me</p>");
    live.commands.selectAll();
    live.chain().toggleBold().run();
    expect(live.getHTML()).toContain("<strong>");
    live.destroy();

    bar.remove();
  });

  test("ToolbarBtn invokes actions from mousedown (TOC/Bold path must survive format-bar pointer capture)", () => {
    expect(EDITOR_SRC).toMatch(
      /function ToolbarBtn\([\s\S]*?onMouseDown=\{\(e\) => \{\s*e\.preventDefault\(\);\s*if \(!disabled\) onClick\(\);/
    );
  });

  test("desktop and mobile format bars wire chrome blur helper (no Done button)", () => {
    expect(EDITOR_SRC).toContain('data-testid="format-bar"');
    expect(EDITOR_SRC).toContain('data-testid="format-bar-mobile"');
    expect(EDITOR_SRC).toContain("handleFormatBarChromePointerDown");
    expect(EDITOR_SRC).not.toMatch(/toolbar-done|data-testid="toolbar-done"/i);
  });
});
