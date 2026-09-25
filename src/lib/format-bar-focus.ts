/**
 * SN-221: dismiss rich-text edit focus via format-bar chrome without
 * breaking intentional toolbar control presses.
 */

import type { Editor } from "@tiptap/core";

/** Buttons, menus, and other controls that must keep selection / re-focus. */
export const FORMAT_BAR_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='menuitem']",
  "[role='option']",
  "[data-radix-collection-item]",
].join(", ");

export function isFormatBarInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(FORMAT_BAR_INTERACTIVE_SELECTOR));
}

/**
 * Chrome / separator / empty padding: blur the editor (dismiss caret + soft keyboard).
 * Interactive controls: do nothing here.
 *
 * Important: never preventDefault() on pointerdown for controls. Canceling
 * pointerdown suppresses compatibility mousedown, and ToolbarBtn runs format
 * actions (Bold, TOC, etc.) from onMouseDown — so preventDefault here broke
 * Insert table of contents and other toolbar buttons.
 * Selection retention stays on each control's own mousedown preventDefault.
 */
export function handleFormatBarChromePointerDown(
  editor: Editor | null | undefined,
  event: { target: EventTarget | null; preventDefault: () => void }
): void {
  if (isFormatBarInteractiveTarget(event.target)) {
    return;
  }
  event.preventDefault();
  editor?.commands.blur();
}

/** Escape while the editor is focused: leave edit focus without mode changes. */
export function blurEditorOnEscape(editor: Editor): boolean {
  if (!editor.isFocused) return false;
  editor.commands.blur();
  return true;
}
