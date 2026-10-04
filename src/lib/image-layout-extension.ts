import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";

export type ImageAlign = "left" | "center" | "right";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageLayout: {
      setImageAlign: (align: ImageAlign) => ReturnType;
      setImageWidth: (width: string | null) => ReturnType;
    };
  }
}

function normalizeWidth(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.round(value)}px`;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return `${raw}px`;
  if (/^\d+(\.\d+)?%$/.test(raw)) return raw;
  if (/^\d+(\.\d+)?px$/.test(raw)) return raw;
  return null;
}

export const ImageLayout = Image.extend({
  name: "image",

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: "left",
        parseHTML: (element) => element.getAttribute("data-align") ?? "left",
        renderHTML: (attributes) => {
          const align = attributes.align as ImageAlign | undefined;
          if (!align || align === "left") return {};
          return { "data-align": align };
        },
      },
      width: {
        default: null,
        parseHTML: (element) =>
          normalizeWidth(element.getAttribute("width") ?? element.style.width),
        renderHTML: (attributes) => {
          const width = normalizeWidth(attributes.width);
          if (!width) return {};
          return {
            width,
            style: `width: ${width}; height: auto;`,
          };
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "editor-image",
      }),
    ];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageAlign:
        (align) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { align }),
      setImageWidth:
        (width) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { width: normalizeWidth(width) }),
    };
  },

  /**
   * TipTap's stock resize NodeView `onUpdate` returns true without syncing
   * `img.src`. Across SN-55 page swaps the editor stays mounted, so ProseMirror
   * can reuse the NodeView while the model already holds the next page's URL —
   * leaving the previous bitmap visible. Rebuild when `src` changes (SN-280).
   */
  addNodeView() {
    const parent = this.parent?.();
    if (!parent) {
      return null;
    }

    return (props) => {
      const nodeView = parent(props);
      if (!nodeView || typeof nodeView.update !== "function") {
        return nodeView;
      }

      let appliedSrc = String(props.node.attrs.src ?? "");
      const originalUpdate = nodeView.update.bind(nodeView);

      nodeView.update = (updatedNode, decorations, innerDecorations) => {
        if (updatedNode.type.name !== this.name) {
          return false;
        }

        const nextSrc = String(updatedNode.attrs.src ?? "");
        if (nextSrc !== appliedSrc) {
          return false;
        }

        return originalUpdate(updatedNode, decorations, innerDecorations);
      };

      return nodeView;
    };
  },
});
