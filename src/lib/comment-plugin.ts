"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { PageComment } from "./comment-types";

export { type PageComment };

export const COMMENT_PLUGIN_KEY = new PluginKey<CommentPluginState>("commentLayer");

interface CommentPluginState {
  comments: PageComment[];
  decorations: DecorationSet;
}

/**
 * Find the first occurrence of `quote` in the ProseMirror doc and return the
 * [from, to) PM positions. Builds a flat (char → pmPos) map across all text
 * nodes so it handles quotes that span multiple text nodes (e.g. across bold /
 * italic runs within the same paragraph). Cross-block quotes (spanning two
 * paragraphs) will not be found and those comments are treated as orphaned.
 */
export function findQuoteInDoc(
  doc: PMNode,
  quote: string
): { from: number; to: number } | null {
  if (!quote) return null;

  const chars: Array<[string, number]> = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        chars.push([node.text[i], pos + i]);
      }
    }
  });

  const fullText = chars.map(([c]) => c).join("");
  const idx = fullText.indexOf(quote);
  if (idx < 0 || idx + quote.length > chars.length) return null;

  return {
    from: chars[idx][1],
    to: chars[idx + quote.length - 1][1] + 1,
  };
}

function buildDecorationSet(doc: PMNode, comments: PageComment[]): DecorationSet {
  const decos: Decoration[] = [];
  for (const comment of comments) {
    if (comment.resolvedAt) continue;
    const range = findQuoteInDoc(doc, comment.quote);
    if (!range) continue; // orphaned — no decoration this render
    decos.push(
      Decoration.inline(range.from, range.to, {
        class: "comment-mark",
        "data-comment-id": comment.id,
      })
    );
  }
  return DecorationSet.create(doc, decos);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentLayer: {
      setComments: (comments: PageComment[]) => ReturnType;
    };
  }
}

export const CommentExtension = Extension.create({
  name: "commentLayer",

  addStorage() {
    return {
      comments: [] as PageComment[],
    };
  },

  addCommands() {
    return {
      setComments:
        (comments: PageComment[]) =>
        ({ tr, dispatch }) => {
          this.storage.comments = comments;
          if (dispatch) {
            dispatch(tr.setMeta(COMMENT_PLUGIN_KEY, { type: "set", comments }));
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<CommentPluginState>({
        key: COMMENT_PLUGIN_KEY,

        state: {
          init(_config, state) {
            return {
              comments: [],
              decorations: DecorationSet.empty,
            };
          },
          apply(tr: Transaction, value: CommentPluginState, _oldState, newState) {
            const meta = tr.getMeta(COMMENT_PLUGIN_KEY) as
              | { type: string; comments: PageComment[] }
              | undefined;
            const comments = meta?.type === "set" ? meta.comments : value.comments;
            // Rebuild decorations on every transaction so anchors track edits automatically.
            const decorations = buildDecorationSet(newState.doc, comments);
            return { comments, decorations };
          },
        },

        props: {
          decorations(state) {
            return COMMENT_PLUGIN_KEY.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});
