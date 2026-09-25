import { Node, mergeAttributes } from "@tiptap/core";

export interface FileAttachmentOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileAttachment: {
      insertFileAttachment: (attrs: { href: string; fileName: string }) => ReturnType;
    };
  }
}

function isPdfHref(href: unknown): boolean {
  return typeof href === "string" && /\.pdf(\?|#|$)/i.test(href);
}

export const FileAttachment = Node.create<FileAttachmentOptions>({
  name: "fileAttachment",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element) =>
          element.querySelector("[data-href]")?.getAttribute("data-href") ??
          element.querySelector("a")?.getAttribute("href") ??
          null,
      },
      fileName: {
        default: null,
        parseHTML: (element) =>
          element.querySelector(".file-attachment-name")?.textContent ??
          element.querySelector("a")?.textContent ??
          null,
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-file-attachment]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const fileName = HTMLAttributes.fileName ?? "Attachment";
    const href = HTMLAttributes.href ?? "#";
    const isPdf = isPdfHref(href);

    const chipAttrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      "data-file-attachment": "",
      "data-file-type": isPdf ? "pdf" : "file",
      class: isPdf ? "file-attachment-chip file-attachment-chip--pdf" : "file-attachment-chip",
      contenteditable: "false",
    });

    if (isPdf) {
      return [
        "span",
        chipAttrs,
        ["span", { class: "file-attachment-icon", "aria-hidden": "true" }, "PDF"],
        ["span", { class: "file-attachment-name", "data-href": href }, fileName],
      ];
    }

    return [
      "span",
      chipAttrs,
      ["a", { href, target: "_blank", rel: "noopener noreferrer", class: "file-attachment-name" }, fileName],
    ];
  },

  addCommands() {
    return {
      insertFileAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
