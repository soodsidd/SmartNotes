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
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
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
import { PaperReference } from "./paper-reference-extension";
import { HeadingWithAnchorId, PageToc } from "@/lib/page-toc";
import { FloatingTextBox } from "./floating-text-box-extension";
import { TABLE_MODE_ATTRS, TableRibbonSupport, type TableModeAttr } from "./table-ribbon";
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
    this.syncModes(node);
  }

  update(node: ProseMirrorNode) {
    const updated = super.update(node);
    if (updated) this.syncModes(node);
    return updated;
  }

  /** SN-278: mirror per-table ribbon modes onto the scroll wrapper for CSS. */
  private syncModes(node: ProseMirrorNode) {
    for (const [attr, dataAttr] of Object.entries(TABLE_MODE_ATTRS) as [TableModeAttr, string][]) {
      if (node.attrs[attr]) this.dom.setAttribute(dataAttr, "true");
      else this.dom.removeAttribute(dataAttr);
    }
  }
}

const TableActiveCell = Extension.create({
  name: "tableActiveCell",
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        decorations(state) {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const name = $from.node(depth).type.name;
            if (name === "tableCell" || name === "tableHeader") {
              return DecorationSet.create(state.doc, [
                Decoration.node($from.before(depth), $from.after(depth), { class: "activeCell" }),
              ]);
            }
          }
          return null;
        },
      },
    })];
  },
});

export const FormattingShortcuts = Extension.create({
  name: "formattingShortcuts",
  addKeyboardShortcuts() {
    return {
      // SN-221: leave edit focus without navigating away or entering draw mode.
      Escape: () => this.editor.commands.blur(),
      "Mod-Alt-1": () => this.editor.commands.toggleHeading({ level: 1 }),
      "Mod-Alt-2": () => this.editor.commands.toggleHeading({ level: 2 }),
      "Mod-Alt-3": () => this.editor.commands.toggleHeading({ level: 3 }),
      "Control-Alt-t": () => this.editor.commands.insertTable({ rows: 2, cols: 1, withHeaderRow: true }),
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
    FloatingTextBox,
    FormattingShortcuts,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false, View: ScrollableTableView }),
    TableRow,
    TableCell,
    TableHeader,
    TableActiveCell,
    TableRibbonSupport,
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
      // SN-343: inline atoms so caret/second insert land on the same line.
      // Block images only allow a text position below the node, never beside it.
      inline: true,
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
    PaperReference,
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

/**
 * Silent content replacement for SN-55 page swaps. TipTap v3 defaults
 * `emitUpdate` to true, which would fire `onUpdate`/`onChange` and dirty the
 * destination draft during navigation (SN-280).
 */
export function setEditorHtmlSilent(editor: Editor, html: string): void {
  editor.commands.setContent(html, { emitUpdate: false });
}

/** Thrown when an in-flight asset upload finishes after the editor left that page. */
export class EditorUploadPageAffinityError extends Error {
  readonly uploadPagePath: string;
  readonly activePagePath: string | null;

  constructor(uploadPagePath: string, activePagePath: string | null) {
    super(
      activePagePath
        ? `Upload aborted: editor moved from ${uploadPagePath} to ${activePagePath}.`
        : `Upload aborted: editor left ${uploadPagePath}.`
    );
    this.name = "EditorUploadPageAffinityError";
    this.uploadPagePath = uploadPagePath;
    this.activePagePath = activePagePath;
  }
}

export function assertEditorUploadPageAffinity(input: {
  uploadPagePath: string;
  uploadGeneration: number;
  activePagePath: string | null | undefined;
  activeGeneration: number;
}): void {
  const activePagePath = input.activePagePath ?? null;
  if (
    !activePagePath ||
    activePagePath !== input.uploadPagePath ||
    input.activeGeneration !== input.uploadGeneration
  ) {
    throw new EditorUploadPageAffinityError(input.uploadPagePath, activePagePath);
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

/** Upload a pre-read blob, skipping the file-read step for batch pre-reads. */
export async function uploadEditorAssetFromBlob(
  pagePath: string,
  blob: Blob,
  fileName: string
) {
  const formData = new FormData();
  formData.append("file", blob, fileName);

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

/** Default width for freshly inserted images so two fit on one row (SN-343). */
export const DEFAULT_INSERTED_IMAGE_WIDTH = "40%";

/**
 * Tiptap's setImage/insertContent leaves the freshly inserted image as a
 * NodeSelection (ProseMirror's default after inserting a node). That is
 * destructive for the "keep building a row of images" flow (SN-343):
 * typing while a node is selected replaces it, and inserting a second image
 * from that selection replaces the first image instead of landing beside it.
 * Images are inline atoms, so the nearest text position after the image is
 * on the same line inside the parent paragraph — move there so typing or
 * another insert continues the row instead of clobbering what's already there.
 */
export function placeCursorAfterInsertedImage(editor: Editor): void {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
    return;
  }
  const after = selection.from + selection.node.nodeSize;
  const next = TextSelection.near(editor.state.doc.resolve(after), 1);
  editor.view.dispatch(editor.state.tr.setSelection(next).scrollIntoView());
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
    ? editor
        .chain()
        .focus()
        .insertContent({
          type: "image",
          attrs: {
            src: asset.url,
            alt: originalFileName,
            width: DEFAULT_INSERTED_IMAGE_WIDTH,
          },
        })
        .run()
    : editor
        .chain()
        .focus()
        .insertFileAttachment({ href: asset.url, fileName: asset.fileName })
        .run();

  // SN-343: land the caret beside the image instead of leaving it NodeSelected.
  if (inserted && asset.isImage) {
    placeCursorAfterInsertedImage(editor);
  }

  const html = editor.getHTML();
  if (!inserted || !html.includes(asset.url)) {
    throw new Error(
      `The file was uploaded to ${asset.path}, but the attachment could not be added to this note. The uploaded copy is still available for recovery.`
    );
  }

  publishHtml(html);
  return html;
}

/**
 * PDFs are not complete when their bytes reach the sibling assets directory.
 * Keep the upload pending until the page write path confirms the new chip was
 * saved. Images intentionally retain their established insert-only behavior.
 */
export async function insertAndPersistUploadedEditorAsset(
  editor: Editor,
  asset: UploadedEditorAsset,
  originalFileName: string,
  publishHtml: (html: string) => void,
  persistHtml?: (html: string) => Promise<boolean>
): Promise<string> {
  const html = insertUploadedEditorAsset(editor, asset, originalFileName, publishHtml);
  if (asset.isImage) {
    return html;
  }

  let persisted = false;
  try {
    persisted = (await persistHtml?.(html)) === true;
  } catch {
    persisted = false;
  }

  if (!persisted) {
    throw new Error(
      `The file was uploaded to ${asset.path}, but the attachment could not be durably saved to this note. The uploaded copy is still available for recovery.`
    );
  }

  return html;
}

/**
 * Serialize async tasks so overlapping attaches (two pickers, drop during an
 * upload) insert and persist one at a time instead of racing each other's
 * draft snapshots (SN-283). A failed task never blocks later ones.
 */
export function createSerialTaskQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
