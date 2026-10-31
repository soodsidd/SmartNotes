/**
 * SN-406: dictated text only ever APPENDS (composer) or INSERTS at the caret
 * (editor). It never replaces existing content, including a selected range.
 */

import type { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";

/** Append a transcript to a composer draft with a single separating space. */
export function appendTranscript(draft: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return draft;
  if (!draft) return text;
  return /\s$/.test(draft) ? `${draft}${text}` : `${draft} ${text}`;
}

/** Text to insert between `before` and `after` so words do not run together. */
export function spacedInsertion(before: string, after: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return "";
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^[\s.,;:!?)\]}]/.test(after) ? " " : "";
  return `${lead}${text}${trail}`;
}

/**
 * Insert a transcript into a Tiptap editor. With `atCaret` the text goes at
 * the end of the current selection (a selected range is kept, never
 * overwritten); otherwise it goes at the end of the document. Returns false
 * when nothing could be inserted.
 */
export function insertTranscriptIntoEditor(editor: Editor, transcript: string, atCaret: boolean): boolean {
  if (!transcript.trim() || editor.isDestroyed || !editor.isEditable) return false;
  const { state } = editor;
  let pos = atCaret ? state.selection.to : Selection.atEnd(state.doc).to;
  let $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) {
    const near = Selection.near($pos, -1);
    pos = near.to;
    $pos = state.doc.resolve(pos);
    if (!$pos.parent.isTextblock) return false;
  }
  const blockStart = $pos.start();
  const before = state.doc.textBetween(blockStart, pos, "\n", " ");
  const after = state.doc.textBetween(pos, $pos.end(), "\n", " ");
  const text = spacedInsertion(before, after, transcript);
  if (!text) return false;
  const tr = state.tr.insertText(text, pos, pos);
  tr.setSelection(Selection.near(tr.doc.resolve(pos + text.length)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
