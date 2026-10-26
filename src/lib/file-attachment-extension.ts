import { Node, mergeAttributes } from "@tiptap/core";

export interface FileAttachmentOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileAttachment: {
      insertFileAttachment: (attrs: { href: string; fileName: string; mimeType?: string; size?: number }) => ReturnType;
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
      mimeType: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-mime-type"),
      },
      size: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-file-size");
          return value === null ? null : Number(value);
        },
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
    const extension = String(fileName).match(/\.([^.]+)$/)?.[1]?.toUpperCase();
    const typeLabel = extension ?? HTMLAttributes.mimeType ?? "FILE";
    const size = HTMLAttributes.size == null ? null : Number(HTMLAttributes.size);
    const sizeLabel = size !== null && Number.isFinite(size) && size >= 0
      ? `${size < 1024 ? size : size < 1024 * 1024 ? (size / 1024).toFixed(1) : (size / (1024 * 1024)).toFixed(1)} ${size < 1024 ? "B" : size < 1024 * 1024 ? "KiB" : "MiB"}`
      : null;

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
      {
        ...chipAttrs,
        "data-mime-type": HTMLAttributes.mimeType ?? null,
        "data-file-size": HTMLAttributes.size ?? null,
      },
      ["span", { class: "file-attachment-icon", "aria-hidden": "true" }, "FILE"],
      ["a", { href, target: "_blank", rel: "noopener noreferrer", class: "file-attachment-name", title: "Open attachment" }, fileName],
      ["span", { class: "file-attachment-meta" }, sizeLabel ? `${typeLabel} · ${sizeLabel}` : typeLabel],
      ["a", { href, download: fileName, class: "file-attachment-download", title: `Download ${fileName}` }, "Download"],
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
