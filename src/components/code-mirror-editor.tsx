"use client";

import * as React from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";

export interface CodeMirrorEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  /** Forwarded to the outer wrapper for e2e/testing hooks. */
  testId?: string;
}

// HTML language support also highlights embedded <style> (CSS) and <script> (JS),
// which is exactly what a self-contained design artifact contains.
const EXTENSIONS = [html(), EditorView.lineWrapping];

/**
 * Thin CodeMirror 6 wrapper for editing a raw HTML/CSS artifact body (SN-167
 * design pages). Rendered client-only (CodeMirror needs the DOM) — import via
 * next/dynamic with `ssr: false`.
 */
export function CodeMirrorEditor({
  value,
  onChange,
  readOnly = false,
  className,
  testId,
}: CodeMirrorEditorProps) {
  return (
    <div className={className} data-testid={testId} style={{ height: "100%", overflow: "auto" }}>
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        editable={!readOnly}
        extensions={EXTENSIONS}
        height="100%"
        style={{ height: "100%", fontSize: "12px" }}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          foldGutter: true,
          autocompletion: false,
        }}
      />
    </div>
  );
}
