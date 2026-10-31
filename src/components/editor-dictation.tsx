"use client";

/**
 * SN-406: note-editor dictation. Transcripts insert at the caret (end of the
 * selection — a selected range is never overwritten). If the user has not
 * placed a caret in this editor yet, text is appended at the end of the page.
 */

import * as React from "react";
import type { Editor } from "@tiptap/core";

import { DictationButton, DictationStatus } from "@/components/dictation-button";
import { useDictation, type DictationController } from "@/hooks/use-dictation";
import { insertTranscriptIntoEditor } from "@/lib/speech/dictation-text";

export function useEditorDictation(editor: Editor | null): DictationController {
  const editorRef = React.useRef(editor);
  editorRef.current = editor;
  const caretPlacedRef = React.useRef(false);

  React.useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) caretPlacedRef.current = true;
    const onFocus = () => {
      caretPlacedRef.current = true;
    };
    editor.on("focus", onFocus);
    return () => {
      editor.off("focus", onFocus);
    };
  }, [editor]);

  return useDictation(
    React.useCallback((transcript: string) => {
      const current = editorRef.current;
      if (current) insertTranscriptIntoEditor(current, transcript, caretPlacedRef.current);
    }, [])
  );
}

/** Height of the on-screen keyboard (visualViewport), so the FAB stays above it. */
function useKeyboardInset(): number {
  const [inset, setInset] = React.useState(0);
  React.useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!viewport) return;
    const update = () => {
      setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/** Phone mic FAB (bottom-right thumb zone) + floating status / offline notice. */
export function EditorDictationOverlay({ controller }: { controller: DictationController }) {
  const inset = useKeyboardInset();
  const style = { "--dictation-keyboard-inset": `${inset}px` } as React.CSSProperties;
  return (
    <div style={style} data-testid="editor-dictation-overlay">
      <DictationButton controller={controller} variant="fab" testId="editor-dictation-fab" />
      <DictationStatus controller={controller} className="dictation-status--floating" testId="editor-dictation-status" />
    </div>
  );
}
