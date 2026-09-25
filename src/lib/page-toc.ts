/**
 * Page table-of-contents helpers (SN-220).
 * Generates/refreshes a single top-of-page TOC from H1–H3 headings with stable
 * section ids. TipTap node + pure doc transforms live here so unit tests do not
 * need the full RichTextEditor shell.
 */

import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import Heading from "@tiptap/extension-heading";

export const PAGE_TOC_ATTR = "data-page-toc";
export const PAGE_TOC_NODE_NAME = "pageToc";

export interface TocHeadingEntry {
  id: string;
  level: 1 | 2 | 3;
  title: string;
  /** Top-level doc child index of the heading (after TOC upsert may shift). */
  pos?: number;
}

export function slugifyHeadingTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base || "section";
}

export function allocateStableHeadingId(
  title: string,
  used: Set<string>,
  preferred?: string | null
): string {
  if (preferred && !used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const base = slugifyHeadingTitle(title);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function isTocHeading(node: PMNode): node is PMNode & {
  attrs: { level: 1 | 2 | 3; id?: string | null };
} {
  return (
    node.type.name === "heading" &&
    (node.attrs.level === 1 || node.attrs.level === 2 || node.attrs.level === 3)
  );
}

export function findPageTocChildIndex(doc: PMNode): number {
  for (let i = 0; i < doc.childCount; i += 1) {
    if (doc.child(i).type.name === PAGE_TOC_NODE_NAME) {
      return i;
    }
  }
  return -1;
}

export function documentHasPageToc(doc: PMNode): boolean {
  return findPageTocChildIndex(doc) >= 0;
}

/**
 * Collect H1–H3 headings for TOC entries, assigning stable ids without mutating.
 * Prefers existing heading ids when unique.
 */
export function collectTocHeadingEntries(doc: PMNode): TocHeadingEntry[] {
  const assigned = new Set<string>();
  const entries: TocHeadingEntry[] = [];

  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (child.type.name === PAGE_TOC_NODE_NAME) continue;
    if (!isTocHeading(child)) continue;
    const title = child.textContent.trim() || "Untitled section";
    const existing = typeof child.attrs.id === "string" ? child.attrs.id : null;
    const id =
      existing && !assigned.has(existing)
        ? (assigned.add(existing), existing)
        : allocateStableHeadingId(title, assigned, null);
    entries.push({
      id,
      level: child.attrs.level,
      title,
    });
  }

  return entries;
}

export function buildPageTocNodeJson(entries: TocHeadingEntry[]): JSONContent {
  return {
    type: PAGE_TOC_NODE_NAME,
    attrs: {
      entries: entries.map(({ id, level, title }) => ({ id, level, title })),
    },
  };
}

export type PageTocMutationResult =
  | { ok: true; action: "inserted" | "updated" | "removed" | "noop"; entryCount: number }
  | { ok: false; reason: string };

/**
 * Ensure every H1–H3 has a stable id matching the TOC entries we will emit.
 */
function childPosAtIndex(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) {
    pos += doc.child(i).nodeSize;
  }
  return pos;
}

export function ensureHeadingIdsForToc(editor: Editor): TocHeadingEntry[] {
  const { state } = editor;
  const entries: TocHeadingEntry[] = [];
  const used = new Set<string>();
  const tr = state.tr;
  let modified = false;

  state.doc.forEach((child, offset) => {
    if (child.type.name === PAGE_TOC_NODE_NAME) return;
    if (!isTocHeading(child)) return;
    const title = child.textContent.trim() || "Untitled section";
    const existing = typeof child.attrs.id === "string" ? child.attrs.id : null;
    const id = allocateStableHeadingId(title, used, existing);
    entries.push({ id, level: child.attrs.level, title });
    if (existing !== id) {
      tr.setNodeMarkup(offset, undefined, { ...child.attrs, id });
      modified = true;
    }
  });

  if (modified) {
    editor.view.dispatch(tr);
  }
  return entries;
}

/**
 * Insert or replace the single top-of-page TOC from current headings.
 * Does not touch ink — callers measure height delta and remap separately.
 */
export function upsertPageToc(editor: Editor): PageTocMutationResult {
  const entries = ensureHeadingIdsForToc(editor);
  if (entries.length === 0) {
    return {
      ok: false,
      reason: "Add at least one heading (H1–H3) before generating a table of contents.",
    };
  }

  const tocJson = buildPageTocNodeJson(entries);
  const tocType = editor.schema.nodes[PAGE_TOC_NODE_NAME];
  if (!tocType) {
    return { ok: false, reason: "Table of contents is not available in this editor." };
  }

  const tocNode = tocType.create({ entries: tocJson.attrs?.entries });
  const tocIndex = findPageTocChildIndex(editor.state.doc);

  if (tocIndex >= 0) {
    const pos = childPosAtIndex(editor.state.doc, tocIndex);
    const existing = editor.state.doc.child(tocIndex);
    editor.view.dispatch(
      editor.state.tr.replaceWith(pos, pos + existing.nodeSize, tocNode)
    );
    return { ok: true, action: "updated", entryCount: entries.length };
  }

  editor.view.dispatch(editor.state.tr.insert(0, tocNode));
  return { ok: true, action: "inserted", entryCount: entries.length };
}

/**
 * Remove the page TOC block if present. No-op when absent.
 */
export function removePageToc(editor: Editor): PageTocMutationResult {
  const tocIndex = findPageTocChildIndex(editor.state.doc);
  if (tocIndex < 0) {
    return { ok: true, action: "noop", entryCount: 0 };
  }

  const pos = childPosAtIndex(editor.state.doc, tocIndex);
  const existing = editor.state.doc.child(tocIndex);
  editor.view.dispatch(editor.state.tr.delete(pos, pos + existing.nodeSize));
  return { ok: true, action: "removed", entryCount: 0 };
}

/**
 * Toggle the page TOC (SN-230): insert when absent, remove when present.
 * Callers still route this through the ink vertical-remap guard so a remove can
 * never leave ink misaligned.
 */
export function togglePageToc(editor: Editor): PageTocMutationResult {
  if (documentHasPageToc(editor.state.doc)) {
    return removePageToc(editor);
  }
  return upsertPageToc(editor);
}

/** Which action the format-bar TOC control performs for the current doc. */
export function nextPageTocAction(hasToc: boolean): "insert" | "remove" {
  return hasToc ? "remove" : "insert";
}

/* ── Back-to-top heading chrome placement (SN-231) ─────────────────────────── */

/** Coarse-pointer touch target; the widest box we must keep inside the column. */
export const BACK_TO_TOP_TARGET_SIZE = 44;
/** Gap between the last glyph of the heading and the start of the hit target. */
export const BACK_TO_TOP_TEXT_GAP = 2;
/** Keep clear of the left gutter where SN-78 collapse chevrons live. */
export const BACK_TO_TOP_MIN_LEFT = 20;

/**
 * Offset of `element`'s padding box inside `ancestor`'s padding box.
 * Headings are laid out against `.ProseMirror` (position: relative), while the
 * chrome overlay is `inset-0` on the content sizer, so raw `offsetLeft/Top`
 * would land the control one padding box off (SN-231). Returns a zero origin
 * when the chain does not reach `ancestor`, which degrades to the old
 * behaviour rather than throwing the control somewhere arbitrary.
 */
export function measureOffsetOrigin(
  element: HTMLElement | null | undefined,
  ancestor: HTMLElement | null | undefined
): { left: number; top: number } {
  if (!element || !ancestor) return { left: 0, top: 0 };
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = element;
  while (node && node !== ancestor) {
    left += node.offsetLeft + node.clientLeft;
    top += node.offsetTop + node.clientTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node === ancestor ? { left, top } : { left: 0, top: 0 };
}

export interface HeadingTextAnchor {
  /** Right edge of the heading's last rendered line, in offset coordinates. */
  textRight: number;
  /** Vertical midline of that last line, in offset coordinates. */
  midY: number;
}

/**
 * Measure where the heading text actually ends.
 * `offsetWidth` is the full block width, so it parks the control in the right
 * gutter no matter how short the heading is (the SN-231 complaint). Range rects
 * give the real end of the last line instead, de-scaled through the editor zoom
 * transform so the result stays in the same offset space as `offsetTop`.
 */
export function measureHeadingTextAnchor(
  headingElement: HTMLElement
): HeadingTextAnchor {
  const fallback: HeadingTextAnchor = {
    textRight: headingElement.offsetLeft,
    midY: headingElement.offsetTop + headingElement.offsetHeight / 2,
  };

  if (typeof document === "undefined" || typeof document.createRange !== "function") {
    return fallback;
  }

  let rects: DOMRect[] = [];
  try {
    const range = document.createRange();
    range.selectNodeContents(headingElement);
    rects = Array.from(range.getClientRects());
  } catch {
    return fallback;
  }

  const lineRects = rects.filter((rect) => rect.height > 0);
  if (lineRects.length === 0) return fallback;

  const lastBottom = lineRects.reduce((max, rect) => Math.max(max, rect.bottom), -Infinity);
  const lastLine = lineRects.filter((rect) => Math.abs(rect.bottom - lastBottom) < 1);
  const right = lastLine.reduce((max, rect) => Math.max(max, rect.right), -Infinity);
  const top = lastLine.reduce((min, rect) => Math.min(min, rect.top), Infinity);
  const bottom = lastBottom;

  const headingRect = headingElement.getBoundingClientRect();
  const rawScale =
    headingElement.offsetWidth > 0 ? headingRect.width / headingElement.offsetWidth : 1;
  const scale = Number.isFinite(rawScale) && rawScale > 0.01 ? rawScale : 1;

  if (!Number.isFinite(right) || !Number.isFinite(top)) return fallback;

  return {
    textRight: headingElement.offsetLeft + (right - headingRect.left) / scale,
    midY: headingElement.offsetTop + ((top + bottom) / 2 - headingRect.top) / scale,
  };
}

/**
 * Place the back-to-top hit target beside the heading text, clamped so the
 * touch box never spills past the text column and never lands on the collapse
 * gutter (e.g. an empty heading, where text start == text end).
 *
 * When the last line runs to the column edge there is no room for the target
 * after the text, so it is clamped and reported as `align: "trailing"`: the
 * box slides back over the tail of the line while the visible chevron pins to
 * the column edge, keeping the glyph off the words underneath it.
 */
export function resolveBackToTopPlacement(input: {
  textRight: number;
  midY: number;
  contentLeft: number;
  contentWidth: number;
  targetSize?: number;
  gap?: number;
}): { left: number; top: number; align: "leading" | "trailing" } {
  const targetSize = input.targetSize ?? BACK_TO_TOP_TARGET_SIZE;
  const gap = input.gap ?? BACK_TO_TOP_TEXT_GAP;
  const minLeft = Math.max(input.contentLeft, BACK_TO_TOP_MIN_LEFT);
  const maxLeft = Math.max(minLeft, input.contentLeft + input.contentWidth - targetSize);
  const desired = input.textRight + gap;
  const left = Math.min(Math.max(desired, minLeft), maxLeft);
  return {
    left: Math.round(left),
    top: Math.round(input.midY),
    align: left < desired ? "trailing" : "leading",
  };
}

export function measurePageTocHeight(editorRoot: HTMLElement | null | undefined): number {
  if (!editorRoot) return 0;
  const toc = editorRoot.querySelector(`[${PAGE_TOC_ATTR}]`);
  if (!(toc instanceof HTMLElement)) return 0;
  return toc.offsetHeight;
}

export function scrollEditorToAnchor(
  scrollContainer: HTMLElement | null | undefined,
  editorRoot: HTMLElement | null | undefined,
  anchorId: string
): boolean {
  if (!editorRoot || !anchorId) return false;
  const target = editorRoot.querySelector(`#${CSS.escape(anchorId)}`);
  if (!(target instanceof HTMLElement)) return false;

  if (scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = scrollContainer.scrollTop + (targetRect.top - containerRect.top) - 12;
    scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
  } else {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return true;
}

/** SN-233: distance (px) a touch pointer may travel and still count as a tap. */
export const TOC_TAP_SLOP_PX = 10;

/**
 * SN-233: on touch, TOC jump fires on pointerup rather than pointerdown so a
 * scroll gesture that starts on an entry isn't mistaken for a tap. This
 * decides whether the pointer stayed close enough to its start to count as a
 * stationary tap rather than a drag.
 */
export function isWithinTocTapSlop(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  slopPx: number = TOC_TAP_SLOP_PX
): boolean {
  return Math.hypot(endX - startX, endY - startY) <= slopPx;
}

export function scrollEditorToPageToc(
  scrollContainer: HTMLElement | null | undefined,
  editorRoot: HTMLElement | null | undefined
): boolean {
  if (!editorRoot) return false;
  const toc = editorRoot.querySelector(`[${PAGE_TOC_ATTR}]`);
  if (!(toc instanceof HTMLElement)) return false;

  if (scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetRect = toc.getBoundingClientRect();
    const nextTop = scrollContainer.scrollTop + (targetRect.top - containerRect.top) - 12;
    scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
  } else {
    toc.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return true;
}

type TocEntryAttr = { id: string; level: 1 | 2 | 3; title: string };

function parseEntriesFromElement(element: HTMLElement): TocEntryAttr[] {
  const links = Array.from(element.querySelectorAll("[data-toc-target]"));
  return links.flatMap((link) => {
    if (!(link instanceof HTMLElement)) return [];
    const id = link.getAttribute("data-toc-target") ?? "";
    if (!id) return [];
    const levelAttr = link.closest("[data-toc-level]")?.getAttribute("data-toc-level");
    const levelNum = Number(levelAttr);
    const level = (levelNum === 1 || levelNum === 2 || levelNum === 3 ? levelNum : 1) as
      | 1
      | 2
      | 3;
    const title = (link.textContent ?? "").trim() || "Untitled section";
    return [{ id, level, title }];
  });
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageToc: {
      upsertPageToc: () => ReturnType;
      removePageToc: () => ReturnType;
    };
  }
}

export const PageToc = Node.create({
  name: PAGE_TOC_NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      entries: {
        default: [] as TocEntryAttr[],
        parseHTML: (element) => parseEntriesFromElement(element as HTMLElement),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `nav[${PAGE_TOC_ATTR}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const entries = (node.attrs.entries as TocEntryAttr[]) ?? [];
    return [
      "nav",
      mergeAttributes(HTMLAttributes, {
        [PAGE_TOC_ATTR]: "true",
        class: "page-toc",
        "aria-label": "Table of contents",
      }),
      ["p", { class: "page-toc-title" }, "Contents"],
      [
        "ul",
        { class: "page-toc-list" },
        ...entries.map((entry) => [
          "li",
          {
            class: `page-toc-item page-toc-item--h${entry.level}`,
            "data-toc-level": String(entry.level),
          },
          // Button (not <a href="#…">) so the browser / app shell never navigates
          // or opens a new Smart Notes instance — scroll is handled in the editor.
          [
            "button",
            {
              type: "button",
              class: "page-toc-link",
              "data-toc-target": entry.id,
            },
            entry.title,
          ],
        ]),
      ],
    ];
  },

  addCommands() {
    return {
      upsertPageToc:
        () =>
        ({ editor }) => {
          const result = upsertPageToc(editor);
          return result.ok;
        },
      removePageToc:
        () =>
        ({ editor }) => {
          const result = removePageToc(editor);
          return result.ok;
        },
    };
  },
});

/** Heading extension with persisted `id` attrs for section anchors. */
export const HeadingWithAnchorId = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { id: attributes.id };
        },
      },
    };
  },
});
