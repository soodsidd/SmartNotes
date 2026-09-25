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
});
