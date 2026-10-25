import type { Editor } from "@tiptap/react";
import { looksLikeMarkdown, parseMarkdownToTiptapJson } from "@/lib/rich-text-editor-config";

export interface InlineAiEditSelection {
  from: number;
  to: number;
  text: string;
}

/**
 * SN-362 Edit: replace only the original selection while it is still live;
 * otherwise insert at the current caret. Single-line plain answers keep the
 * surrounding marks (insertText); multi-line or markdown answers go through the
 * SN-125 paste parser so paragraphs and lists land as blocks.
 */
export function applyInlineAiEditorAnswer(editor: Editor, answer: string, captured: InlineAiEditSelection | null): boolean {
  const text = answer.trim();
  if (!editor.isEditable || !text) return false;
  const { selection, doc } = editor.state;
  const replace = captured && selection.from === captured.from && selection.to === captured.to &&
    doc.textBetween(selection.from, selection.to, "") === captured.text;
  const range = { from: selection.from, to: replace ? selection.to : selection.from };
  if (text.includes("\n") || looksLikeMarkdown(text)) {
    return editor.chain().focus().insertContentAt(range, parseMarkdownToTiptapJson(text)).run();
  }
  editor.view.dispatch(editor.state.tr.insertText(text, range.from, range.to));
  editor.commands.focus();
  return true;
}
