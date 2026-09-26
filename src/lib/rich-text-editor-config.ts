"use client";

import { Extension, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableView } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorMathematics } from "./editor-mathematics";
import { ImageLayout } from "./image-layout-extension";
import Highlight from "@tiptap/extension-highlight";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Editor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { CommentExtension } from "./comment-plugin";
import { FileAttachment } from "./file-attachment-extension";
import { HeadingWithAnchorId, PageToc } from "@/lib/page-toc";
import {
  describeAssetUploadFailure,
  readFileForUpload,
} from "@/lib/editor-asset-upload";

class ScrollableTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number) {
    super(node, cellMinWidth);
    this.dom.tabIndex = 0;
    this.dom.setAttribute("role", "region");
    this.dom.setAttribute("aria-label", "Table scroll area");
    this.dom.setAttribute("data-table-scroll", "true");
  }
}

export const FormattingShortcuts = Extension.create({
  name: "formattingShortcuts",
  addKeyboardShortcuts() {
    return {
      // SN-221: leave edit focus without navigating away or entering draw mode.
      Escape: () => this.editor.commands.blur(),
      "Mod-Alt-1": () => this.editor.commands.toggleHeading({ level: 1 }),
      "Mod-Alt-2": () => this.editor.commands.toggleHeading({ level: 2 }),
      "Mod-Alt-3": () => this.editor.commands.toggleHeading({ level: 3 }),
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
      "Mod-Shift-7": () => this.editor.commands.toggleOrderedList(),
      "Mod-Shift-8": () => this.editor.commands.toggleBulletList(),
      "Mod-Shift-9": () => this.editor.commands.toggleBlockquote(),
    };
  },
});

export const FONT_FAMILIES = [
  { label: "Hanken Grotesk", value: "var(--font-sans)" },
  { label: "JetBrains Mono", value: "var(--font-mono)" },
  { label: "Caveat", value: "var(--font-accent)" },
] as const;

export const FONT_SIZES = [
  { label: "Small", value: "14px" },
  { label: "Normal", value: "16px" },
  { label: "Large", value: "18px" },
  { label: "Extra Large", value: "22px" },
] as const;

export const TEXT_COLOR_PALETTE = [
  "#000000",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#2563eb",
  "#9333ea",
  "#db2777",
] as const;

export function createEditorExtensions(
  placeholder = "Write here…",
  withComments = false
) {
  const extensions = [
    StarterKit.configure({
      codeBlock: { HTMLAttributes: { class: "not-prose" } },
      // Replaced by HeadingWithAnchorId so section anchors persist for TOC (SN-220).
      heading: false,
    }),
    HeadingWithAnchorId.configure({ levels: [1, 2, 3] }),
    PageToc,
    FormattingShortcuts,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false, View: ScrollableTableView }),
    TableRow,
    TableCell,
    TableHeader,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: "editor-link" },
    }),
    Placeholder.configure({ placeholder }),
    EditorMathematics,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: false }),
    ImageLayout.configure({
      inline: false,
      allowBase64: false,
      HTMLAttributes: {
        class: "editor-image",
      },
      resize: {
        enabled: true,
        directions: ["right", "bottom-right"],
        minWidth: 48,
        minHeight: 48,
        alwaysPreserveAspectRatio: true,
      },
    }),
    FileAttachment,
    Markdown.configure({
      html: true,
      tightLists: true,
      bulletListMarker: "-",
      breaks: false,
      // Paste conversion is handled deterministically in rich-text-editor.tsx
      // (handlePaste + looksLikeMarkdown). tiptap-markdown's own paste transform
      // is unreliable for multi-line documents and would also defeat the
      // Ctrl/Cmd+Shift+V raw-paste escape hatch, so we own it explicitly (SN-125).
      transformPastedText: false,
      transformCopiedText: false,
    }),
  ];
  if (withComments) {
    extensions.push(CommentExtension);
  }
  return extensions;
}

/**
 * Block/inline Markdown signals used to decide whether a plain-text clipboard
 * payload should be converted on paste. Deliberately conservative: each pattern
 * requires real Markdown structure so ordinary prose or a bare URL is left as-is.
 */
const MARKDOWN_SIGNALS: readonly RegExp[] = [
  /^#{1,6}\s+\S/m, // ATX heading (# .. ######)
  /^\s{0,3}[-*+]\s+\S/m, // unordered list item
  /^\s{0,3}\d+\.\s+\S/m, // ordered list item
  /^\s{0,3}>\s+\S/m, // blockquote
  /^\s{0,3}```/m, // fenced code block
  /^\s{0,3}\|.*\|\s*$/m, // table row
  /\*\*[^*\n]+\*\*/, // **bold**
  /__[^_\n]+__/, // __bold__
  /(?:^|\s)`[^`\n]+`/, // `inline code`
  /\[[^\]]+\]\([^)\s]+\)/, // [text](url) link
];

/**
 * Heuristic for markdown-aware paste: does this plain text look like Markdown
 * worth converting? Returns false for empty input, plain prose, and bare URLs so
 * that pasting non-Markdown text is never surprise-formatted (SN-125).
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text) {
    return false;
  }
  return MARKDOWN_SIGNALS.some((pattern) => pattern.test(text));
}

/** Parse markdown (e.g. AI insert) into Tiptap JSON for insertion into an HTML document. */
export function parseMarkdownToTiptapJson(markdown: string): JSONContent {
  const element = document.createElement("div");
  const parser = new Editor({
    element,
    extensions: createEditorExtensions(),
    content: markdown,
  });

  try {
    return parser.getJSON();
  } finally {
    parser.destroy();
    element.remove();
  }
}

export async function uploadEditorAsset(pagePath: string, file: File) {
  let blob: Blob;
  try {
    blob = await readFileForUpload(file);
  } catch (error) {
    throw new Error(describeAssetUploadFailure(error));
  }

  const formData = new FormData();
  formData.append("file", blob, file.name);

  let response: Response;
  try {
    response = await fetch(`/api/assets?path=${encodeURIComponent(pagePath)}`, {
      method: "POST",
      body: formData,
    });
  } catch (error) {
    throw new Error(describeAssetUploadFailure(error));
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Asset upload failed.");
  }
  return (await response.json()) as {
    asset: { url: string; path: string; fileName: string; isImage: boolean };
  };
}

export interface UploadedEditorAsset {
  url: string;
  path: string;
  fileName: string;
  isImage: boolean;
}

/**
 * Insert an uploaded asset and verify that the editor document actually owns
 * the returned vault URL before the UI reports success (SN-272).
 */
export function insertUploadedEditorAsset(
  editor: Editor,
  asset: UploadedEditorAsset,
  originalFileName: string,
  publishHtml: (html: string) => void
): string {
  const inserted = asset.isImage
    ? editor.chain().focus().setImage({ src: asset.url, alt: originalFileName }).run()
    : editor
        .chain()
        .focus()
        .insertFileAttachment({ href: asset.url, fileName: asset.fileName })
        .run();

  const html = editor.getHTML();
  if (!inserted || !html.includes(asset.url)) {
    throw new Error(
      `The file was uploaded to ${asset.path}, but the attachment could not be added to this note. The uploaded copy is still available for recovery.`
    );
  }

  publishHtml(html);
  return html;
}
