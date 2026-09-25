import type { Node as PMNode } from "@tiptap/pm/model";
import { Mathematics } from "@tiptap/extension-mathematics";

export type MathNodeKind = "inline" | "block";

export type MathNodeClickPayload = {
  kind: MathNodeKind;
  node: PMNode;
  pos: number;
};

type MathNodeClickHandler = (payload: MathNodeClickPayload) => void;

let mathNodeClickHandler: MathNodeClickHandler | null = null;

/** Register React-layer click handlers for rendered math nodes. */
export function setMathNodeClickHandler(handler: MathNodeClickHandler | null) {
  mathNodeClickHandler = handler;
}

export const EditorMathematics = Mathematics.configure({
  katexOptions: {
    throwOnError: false,
    strict: "ignore",
  },
  inlineOptions: {
    onClick: (node, pos) => {
      mathNodeClickHandler?.({ kind: "inline", node, pos });
    },
  },
  blockOptions: {
    onClick: (node, pos) => {
      mathNodeClickHandler?.({ kind: "block", node, pos });
    },
  },
});
