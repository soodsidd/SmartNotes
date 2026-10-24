"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";

type EditorFontSizes = { selectionSize: string; defaultSize: string };
const UNKNOWN_SIZES: EditorFontSizes = { selectionSize: "Default", defaultSize: "Default" };

export function readEditorFontSizes(editor: Editor | null): EditorFontSizes {
  if (!editor || editor.isDestroyed) return UNKNOWN_SIZES;
  const root = editor.view.dom;
  if (!root.isConnected) return UNKNOWN_SIZES;
  const defaultSize = getComputedStyle(root).fontSize || "Default";
  // Stored marks also cover a font-size choice made before typing the next character.
  const explicitSize = editor.getAttributes("textStyle").fontSize as string | undefined;
  if (explicitSize) return { selectionSize: explicitSize, defaultSize };

  if (editor.state.storedMarks !== null) {
    const { $from } = editor.state.selection;
    const block = $from.depth > 0 ? editor.view.nodeDOM($from.before()) : root;
    const selectionSize = block instanceof HTMLElement ? getComputedStyle(block).fontSize || defaultSize : defaultSize;
    return { selectionSize, defaultSize };
  }

  const { node, offset } = editor.view.domAtPos(editor.state.selection.from, 1);
  const selectedNode = node === root ? node.childNodes[offset] ?? node : node;
  const element = selectedNode.nodeType === Node.ELEMENT_NODE
    ? selectedNode as HTMLElement
    : selectedNode.parentElement;
  const selectionSize = element ? getComputedStyle(element).fontSize || defaultSize : defaultSize;
  return { selectionSize, defaultSize };
}

export function useEditorFontSizes(editor: Editor | null): EditorFontSizes {
  const [sizes, setSizes] = useState<EditorFontSizes>(UNKNOWN_SIZES);

  useEffect(() => {
    const update = () => {
      const next = readEditorFontSizes(editor);
      setSizes(previous => previous.selectionSize === next.selectionSize && previous.defaultSize === next.defaultSize ? previous : next);
    };
    update();
    const frame = requestAnimationFrame(update);
    editor?.on("selectionUpdate", update);
    editor?.on("transaction", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-density"] });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      editor?.off("selectionUpdate", update);
      editor?.off("transaction", update);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [editor]);

  return sizes;
}
