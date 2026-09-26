"use client";

import * as React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { TextSelection, NodeSelection } from "@tiptap/pm/state";
import {
  Bold,
  Calendar,
  Camera,
  ChevronDown,
  ChevronUp,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListTree,
  CheckSquare,
  ListOrdered,
  Minus,
  Paperclip,
  PenLine,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Sigma,
  Table as TableIcon,
  Type,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  createEditorExtensions,
  FONT_FAMILIES,
  FONT_SIZES,
  insertUploadedEditorAsset,
  looksLikeMarkdown,
  parseMarkdownToTiptapJson,
  TEXT_COLOR_PALETTE,
  uploadEditorAsset,
} from "@/lib/rich-text-editor-config";
import { handleFormatBarChromePointerDown } from "@/lib/format-bar-focus";
import { describeAssetUploadFailure } from "@/lib/editor-asset-upload";
import { formatLocalDate } from "@/lib/ai-sidebar";
import {
  collectCollapsibleHeadingSections,
  extractAnnotationVerticalRanges,
  sectionCollapseBlockedByInk,
  type CollapsibleHeadingSection,
} from "@/lib/collapsible-headings";
import {
  annotationSceneHasInk,
} from "@/lib/annotation-vertical-remap";
import {
  documentHasPageToc,
  isWithinTocTapSlop,
  measureHeadingTextAnchor,
  measureOffsetOrigin,
  measurePageTocHeight,
  removePageToc,
  resolveBackToTopPlacement,
  togglePageToc,
  scrollEditorToAnchor,
  scrollEditorToPageToc,
  upsertPageToc,
} from "@/lib/page-toc";
import { cn } from "@/lib/utils";
import { resolvePdfAttachmentTarget, type PdfAttachmentTarget } from "@/lib/pdf-attachment";
import type { PageContentExport } from "@/lib/page-export";
import { computePageFrameHeight } from "@/lib/page-frame";
import { logDrawEvent } from "@/lib/draw-mode-debug";
import { generateCommentId, type PageComment } from "@/lib/comment-types";
import type { ImageAlign } from "@/lib/image-layout-extension";
import { supportsNativeCameraCapture } from "@/lib/camera-capture";
import {
  adjustEditorZoomFromWheel,
  applyScrollPan,
  applyWorkspacePan,
  EDITOR_PAN_DEFAULT,
  EDITOR_ZOOM_DEFAULT,
  editorZoomSpacerStyle,
  editorZoomSurfaceStyle,
  isWorkspaceZoomWheel,
  shouldEnableWorkspacePan,
} from "@/lib/editor-workspace-zoom";
import {
  handleInlineMathSpace,
  inferInlineMathResumePos,
  type InlineMathComposeState,
} from "@/lib/inline-math-compose";
import { setMathNodeClickHandler } from "@/lib/editor-mathematics";
import { InlineMathPreview } from "@/components/inline-math-preview";
import {
  CommentComposer,
  CommentPopover,
  EditorContextMenu,
} from "@/components/comment-layer";
import { AnnotationDrawToolbar } from "@/components/annotation-draw-toolbar";
import { shouldOpenEditorContextMenu } from "@/lib/editor-context-menu";
import { useSpellcheckEnabled } from "@/components/spellcheck-provider";
import {
  getAnnotationHistoryCommand,
  type AnnotationLayerHandle,
  type AnnotationStrokeSize,
  type AnnotationTool,
} from "@/components/annotation-layer";
import type { TLDefaultColorStyle } from "tldraw";
import dynamic from "next/dynamic";
import { prefetchPdfiumWasm } from "@/lib/pdf-engine-prefetch";

// The immersive PDF reader pulls in EmbedPDF + a PDFium WASM engine; load it
// lazily and client-only so it never enters the SSR bundle and only downloads
// when a user actually opens a PDF attachment.
const ImmersivePdfReader = dynamic(
  () => import("@/components/immersive-pdf-reader"),
  { ssr: false }
);

export interface EditorSectionContext {
  heading: string | null;
  index: number;
}

export interface RichTextEditorHandle {
  insertMarkdown: (markdown: string) => boolean;
  insertHtml: (html: string) => boolean;
  insertText: (text: string) => boolean;
  swapContent: (html: string) => boolean;
  getExportSnapshot: () => PageContentExport | null;
}

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  pagePath?: string | null;
  placeholder?: string;
  className?: string;
  onEditorReady?: (editor: Editor | null) => void;
  onSelectionContextChange?: (context: EditorSectionContext | null) => void;
  /** Comments loaded from page frontmatter. */
  initialComments?: PageComment[];
  /** Called whenever comments change (add / resolve / delete). Caller persists to API. */
  onCommentsChange?: (comments: PageComment[]) => void;
  /** When true, content is view-only — no edits, toolbar, or comments. */
  readOnly?: boolean;
  /** When true, suppress the built-in format toolbar (draw-mode composite layouts). */
  hideFormatToolbar?: boolean;
  /** Text-page annotation mode — swaps format tools for ink exit controls in draw mode. */
  annotationMode?: "edit" | "draw";
  onAnnotationModeChange?: (mode: "edit" | "draw") => void;
  /** Ink canvas overlay — mounted inside the editor scroll surface for alignment. */
  annotationOverlay?: React.ReactNode;
  /** Imperative handle for the preloaded annotation layer (draw toolbar wiring). */
  annotationLayerRef?: React.RefObject<AnnotationLayerHandle | null>;
  /** Undo/redo availability from the annotation layer. */
  annotationHistory?: { canUndo: boolean; canRedo: boolean };
  annotationScene?: unknown | null;
  inkTool?: AnnotationTool;
  inkColor?: TLDefaultColorStyle;
  inkStroke?: AnnotationStrokeSize;
  onInkToolChange?: (tool: AnnotationTool) => void;
  onInkColorChange?: (color: TLDefaultColorStyle) => void;
  onInkStrokeChange?: (size: AnnotationStrokeSize) => void;
  /** Note title for print header output. */
  pageTitle?: string;
  /** Persisted drawable page extent from annotations sidecar metadata. */
  drawableBottom?: number;
  /** Full-frame ink capture for page_render screenshots (no sticky viewport clip). */
  inkCaptureMode?: boolean;
  onDrawableBottomChange?: (value: number) => void;
  onPdfAttachmentOpen?: (target: PdfAttachmentTarget) => void;
}

interface HeadingChevronControl extends CollapsibleHeadingSection {
  disabled: boolean;
  collapsed: boolean;
  hiddenByAncestor: boolean;
  top: number;
  headingHeight: number;
}

const HEADING_COLLAPSE_ANIMATION_MS = 180;
const DISABLED_HEADING_TOOLTIP = "Ink marks present - collapse unavailable";
const MOBILE_EDITOR_FRAME_PADDING = "px-3 pb-8 pt-3 md:px-8 md:pb-10 md:pt-4 xl:px-6 xl:pb-8 xl:pt-3";
/** Fixed viewport height used for headless ink capture (SN-122) to avoid the
 *  scroll-area measurement feedback loop in the non-scrolling render route. */
const INK_CAPTURE_VIEWPORT_HEIGHT = 900;

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveSectionContext(editor: Editor): EditorSectionContext | null {
  const selectionFrom = editor.state.selection.from;
  let sectionIndex = -1;
  let activeContext: EditorSectionContext | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (pos > selectionFrom) {
      return false;
    }

    if (node.type.name === "heading" && node.attrs.level === 2) {
      sectionIndex += 1;
      activeContext = {
        heading: node.textContent.trim() || "Untitled section",
        index: sectionIndex,
      };
    }

    return true;
  });

  if (activeContext) {
    return activeContext;
  }

  let firstContext: EditorSectionContext | null = null;
  sectionIndex = -1;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading" && node.attrs.level === 2) {
      sectionIndex += 1;
      firstContext = {
        heading: node.textContent.trim() || "Untitled section",
        index: sectionIndex,
      };
      return false;
    }

    return true;
  });

  return firstContext;
}

/**
 * Resolve the word boundaries at a caret position within a text block.
 * Returns null if the caret is not inside a word.
 */
function wordRangeAtPos(
  editor: Editor,
  pos: number
): { from: number; to: number } | null {
  const $pos = editor.state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;

  const contentStart = $pos.start();
  const offset = $pos.parentOffset;
  const text = $pos.parent.textContent;

  let s = offset;
  let e = offset;
  while (s > 0 && /\w/.test(text[s - 1])) s--;
  while (e < text.length && /\w/.test(text[e])) e++;

  if (s === e) return null;
  return { from: contentStart + s, to: contentStart + e };
}

export const RichTextEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    {
      content,
      onChange,
      placeholder,
      className,
      onEditorReady,
      onSelectionContextChange,
      initialComments,
      onCommentsChange,
      readOnly = false,
      hideFormatToolbar = false,
      annotationMode = "edit",
      onAnnotationModeChange,
      annotationOverlay,
      annotationLayerRef,
      annotationHistory = { canUndo: false, canRedo: false },
      annotationScene = null,
      inkTool = "draw",
      inkColor = "black",
      inkStroke = "m",
      onInkToolChange,
      onInkColorChange,
      onInkStrokeChange,
      pagePath = null,
      pageTitle = "",
      drawableBottom,
      inkCaptureMode = false,
      onDrawableBottomChange,
      onPdfAttachmentOpen,
    },
    ref
  ) {
    const spellcheckEnabled = useSpellcheckEnabled();
    // SN-148: warm PDFium WASM while the editor is idle so the first PDF open
    // does not pay the full engine download cost on the critical path.
    React.useEffect(() => {
      prefetchPdfiumWasm();
    }, []);
    const isDrawMode = annotationMode === "draw" && !readOnly;
    const [textHeight, setTextHeight] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(0);
    const [scrollTop, setScrollTop] = React.useState(0);
    // In capture mode the editor is rendered in an unbounded (non-scrolling)
    // document, so the measured scroll-area height feeds back into the frame
    // height and runs away. Pin the viewport to a fixed page height instead so
    // `pageFrameHeight` is deterministic for the screenshot.
    const effectiveViewportHeight = inkCaptureMode
      ? INK_CAPTURE_VIEWPORT_HEIGHT
      : viewportHeight;
    const pageFrameHeight = computePageFrameHeight({
      textHeight,
      viewportHeight: effectiveViewportHeight,
      drawableBottom,
    });
    const scrollAreaRef = React.useRef<HTMLDivElement>(null);
    const contentSizerRef = React.useRef<HTMLDivElement>(null);
    const lastEmittedRef = React.useRef(content);
    const [linkDialog, setLinkDialog] = React.useState<{ open: boolean; href: string }>({
      open: false,
      href: "",
    });
    const linkInputRef = React.useRef<HTMLInputElement>(null);
    const [workspaceZoom, setWorkspaceZoom] = React.useState(EDITOR_ZOOM_DEFAULT);
    const [workspacePan, setWorkspacePan] = React.useState(EDITOR_PAN_DEFAULT);
    // Sticky ink clip lives inside the CSS-scaled content frame; divide by zoom so
    // the on-screen clip height matches the scroll viewport (avoids draw-mode clipping).
    const inkViewportClipHeight =
      effectiveViewportHeight > 0 && workspaceZoom > 0
        ? effectiveViewportHeight / workspaceZoom
        : effectiveViewportHeight;
    const workspacePanRef = React.useRef(workspacePan);
    workspacePanRef.current = workspacePan;
    const spaceHeldRef = React.useRef(false);
    const [spacePanHeld, setSpacePanHeld] = React.useState(false);
    const [workspacePanning, setWorkspacePanning] = React.useState(false);
    const isPanningRef = React.useRef(false);
    const panSessionRef = React.useRef({
      pointerX: 0,
      pointerY: 0,
      panX: 0,
      panY: 0,
    });
    const inlineMathComposeRef = React.useRef<InlineMathComposeState | null>(null);
    const suppressMathSelectionEditRef = React.useRef(false);
    const lastTextSelectionRef = React.useRef<number | null>(null);
    const scrollPanCleanupRef = React.useRef<(() => void) | null>(null);
    const [inlineMathCompose, setInlineMathCompose] = React.useState<InlineMathComposeState | null>(
      null
    );
    inlineMathComposeRef.current = inlineMathCompose;
    const inlineMathInputRef = React.useRef<HTMLInputElement>(null);
    const [mathDialog, setMathDialog] = React.useState<{
      open: boolean;
      latex: string;
      block: boolean;
      editPos?: number;
    }>({ open: false, latex: "", block: false });
    const mathInputRef = React.useRef<HTMLInputElement>(null);

    // ── Comment state ────────────────────────────────────────────────────────
    const commentsRef = React.useRef<PageComment[]>(initialComments ?? []);
    // Tracks which editor instance was last seeded so we always seed on first mount.
    const seededEditorRef = React.useRef<typeof editor>(null);
    const [contextMenu, setContextMenu] = React.useState<{
      x: number;
      y: number;
      selectionFrom: number;
      selectionTo: number;
      mobile?: boolean;
    } | null>(null);
    const [composerPending, setComposerPending] = React.useState<{
      from: number;
      to: number;
      quote: string;
      anchorRect: DOMRect;
    } | null>(null);
    const [popoverState, setPopoverState] = React.useState<{
      comment: PageComment;
      anchorRect: DOMRect;
    } | null>(null);
    const [fontSheetOpen, setFontSheetOpen] = React.useState(false);
    const [hoveredHeadingKey, setHoveredHeadingKey] = React.useState<string | null>(null);
    const [headingChevronControls, setHeadingChevronControls] = React.useState<
      HeadingChevronControl[]
    >([]);
    const [headingBackToTopControls, setHeadingBackToTopControls] = React.useState<
      Array<{
        key: string;
        headingOrder: number;
        title: string;
        /** Vertical midline of the heading's last rendered line (SN-231). */
        top: number;
        /** Left edge of the hit target, already clamped to the text column. */
        left: number;
        /** "trailing" when the line left no room after the text (SN-231). */
        align: "leading" | "trailing";
        hiddenByAncestor: boolean;
      }>
    >([]);
    const [collapsedHeadingKeys, setCollapsedHeadingKeys] = React.useState<string[]>([]);
    const [pdfReader, setPdfReader] = React.useState<PdfAttachmentTarget | null>(null);
    const openPdfReader = React.useCallback(
      (target: PdfAttachmentTarget) => {
        if (onPdfAttachmentOpen) {
          onPdfAttachmentOpen(target);
          return;
        }
        setPdfReader(target);
      },
      [onPdfAttachmentOpen]
    );
    const editorColumnRef = React.useRef<HTMLDivElement>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const cameraInputRef = React.useRef<HTMLInputElement>(null);
    const attachmentInputRef = React.useRef<HTMLInputElement>(null);
    // Only surfaced on touch-first mobile/tablet browsers with capture support;
    // resolved after mount so SSR/desktop never render a camera-only path.
    const [cameraCaptureSupported, setCameraCaptureSupported] = React.useState(false);
    React.useEffect(() => {
      setCameraCaptureSupported(supportsNativeCameraCapture());
    }, []);
    const collapsedHeadingKeysByPageRef = React.useRef(new Map<string, string[]>());
    const collapseScopeId = React.useId();
    const pageStateKey = pagePath ?? "__page__";

    React.useEffect(() => {
      setCollapsedHeadingKeys(collapsedHeadingKeysByPageRef.current.get(pageStateKey) ?? []);
      setHoveredHeadingKey(null);
    }, [pageStateKey]);

    const updateCollapsedHeadingKeys = React.useCallback(
      (updater: (current: string[]) => string[]) => {
        setCollapsedHeadingKeys((current) => {
          const next = updater(current);
          collapsedHeadingKeysByPageRef.current.set(pageStateKey, next);
          return next;
        });
      },
      [pageStateKey]
    );

    async function insertUploadedAsset(file: File) {
      if (!editor || !pagePath) return;
      const { asset } = await uploadEditorAsset(pagePath, file);
      const html = insertUploadedEditorAsset(editor, asset, file.name, onChange);

      // The helper publishes through the current page callback explicitly
      // instead of relying solely on TipTap's onUpdate callback. A duplicate
      // identical update is harmless and React batches it (SN-272).
      lastEmittedRef.current = html;
    }

    async function handleAssetFiles(files: FileList | File[] | null) {
      if (!files?.length || readOnly) return;
      for (const file of Array.from(files)) {
        const isSupported = file.type.startsWith("image/") || /\.pdf$/i.test(file.name);
        if (!isSupported) {
          toast.error("Unsupported file type. Allowed: images and PDF.", { duration: 4000 });
          continue;
        }
        const toastId = toast.loading(`Uploading ${file.name}…`);
        try {
          await insertUploadedAsset(file);
          toast.success(`Attached ${file.name}`, { id: toastId, duration: 2500 });
        } catch (err) {
          const msg = describeAssetUploadFailure(err);
          toast.error(msg, { id: toastId, duration: 6000 });
        }
      }
    }

    function handleEditorClickCapture(e: React.MouseEvent) {
      if (readOnly || isDrawMode) return;
      const target = resolvePdfAttachmentTarget(e.target instanceof Element ? e.target : null);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      openPdfReader(target);
    }

    function handleEditorPointerDownCapture(e: React.PointerEvent) {
      if (readOnly || isDrawMode) return;
      const target = resolvePdfAttachmentTarget(e.target instanceof Element ? e.target : null);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      openPdfReader(target);
    }

    function handleEditorClick(e: React.MouseEvent) {
      if (readOnly || isDrawMode) return;
      const isWrapperTapTarget =
        e.target === e.currentTarget ||
        e.target === contentSizerRef.current ||
        e.target === scrollAreaRef.current;
      if (
        editor &&
        e.target instanceof Node &&
        !editor.view.dom.contains(e.target) &&
        isWrapperTapTarget
      ) {
        const proseMirror = editor.view.dom as HTMLElement;
        const proseRect = proseMirror.getBoundingClientRect();
        const resolvedPosition = editor.view.posAtCoords({
          left: clamp(
            e.clientX,
            proseRect.left + 8,
            Math.max(proseRect.left + 8, proseRect.right - 8)
          ),
          top: clamp(
            e.clientY,
            proseRect.top + 4,
            Math.max(proseRect.top + 4, proseRect.bottom - 4)
          ),
        });

        if (resolvedPosition) {
          const selection = TextSelection.near(editor.state.doc.resolve(resolvedPosition.pos));
          editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
          editor.view.focus();
          return;
        }
      }

      const target = resolvePdfAttachmentTarget(e.target as Element);
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        openPdfReader(target);
      }
    }

    function closePdfReader() {
      setPdfReader(null);
    }

    React.useEffect(() => {
      return () => {
        scrollPanCleanupRef.current?.();
      };
    }, []);
    const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const popoverRef = React.useRef<HTMLDivElement>(null);

    function schedulePopoverClose() {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => setPopoverState(null), 180);
    }

    function cancelPopoverClose() {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }

    // ── Link dialog ──────────────────────────────────────────────────────────
    function openLinkDialog() {
      if (!editor) return;
      const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
      setLinkDialog({ open: true, href: prev });
      setTimeout(() => linkInputRef.current?.select(), 0);
    }

    function applyLink() {
      if (!editor) return;
      const href = linkDialog.href.trim();
      if (!href) editor.chain().focus().unsetLink().run();
      else editor.chain().focus().setLink({ href }).run();
      setLinkDialog({ open: false, href: "" });
    }

    function cancelLink() {
      editor?.chain().focus().run();
      setLinkDialog({ open: false, href: "" });
    }

    // ── Math dialog / inline compose ─────────────────────────────────────────
    function openMathDialog(block = false) {
      setInlineMathCompose(null);
      setMathDialog({ open: true, latex: "", block, editPos: undefined });
      setTimeout(() => mathInputRef.current?.focus(), 0);
    }

    function startInlineMathCompose(
      edit?: { pos: number; latex: string; editPos: number; resumePos?: number; block?: boolean }
    ) {
      if (!editor) return;
      setMathDialog({ open: false, latex: "", block: false, editPos: undefined });
      const pos = edit?.pos ?? editor.state.selection.from;
      const coords = editor.view.coordsAtPos(pos);
      setInlineMathCompose({
        pos,
        latex: edit?.latex ?? "",
        anchorTop: coords.top,
        anchorLeft: coords.left,
        editPos: edit?.editPos,
        resumePos: edit?.resumePos,
        block: edit?.block ?? false,
      });
      setTimeout(() => {
        const input = inlineMathInputRef.current;
        input?.focus();
        if (edit?.latex) {
          input?.setSelectionRange(edit.latex.length, edit.latex.length);
        }
      }, 0);
    }

    function startInlineMathComposeFromNode(
      pos: number,
      latex: string,
      resumePos?: number,
      block = false
    ) {
      startInlineMathCompose({ pos, latex, editPos: pos, resumePos, block });
    }

    function enterMathEditFromSelection(ed: Editor) {
      if (readOnly || inlineMathComposeRef.current || suppressMathSelectionEditRef.current) {
        return;
      }
      const { selection } = ed.state;
      if (!(selection instanceof NodeSelection)) return;
      const latex = String(selection.node.attrs.latex ?? "");
      const isInline = selection.node.type.name === "inlineMath";
      const isBlock = selection.node.type.name === "blockMath";
      if (isInline || isBlock) {
        const resumePos = inferInlineMathResumePos(
          selection.from,
          selection.node.nodeSize,
          lastTextSelectionRef.current
        );
        // SN-158: both inline and block edits open the caret-anchored editor at
        // the equation; the legacy top-of-page dialog is never used for editing.
        startInlineMathComposeFromNode(selection.from, latex, resumePos, isBlock);
      }
    }

    function commitInlineMathCompose(latex: string) {
      if (!editor) return;
      suppressMathSelectionEditRef.current = true;
      const trimmed = latex.trim();
      const editPos = inlineMathCompose?.editPos;
      const resumePos = inlineMathCompose?.resumePos;
      const block = inlineMathCompose?.block ?? false;
      const insertPos = inlineMathCompose?.pos ?? editor.state.selection.from;
      // SN-158: keep the node's original inline/block type on commit so editing a
      // `$$…$$` block never downgrades it to inline (or inserts a duplicate).
      const deleteCmd = block ? "deleteBlockMath" : "deleteInlineMath";
      const updateCmd = block ? "updateBlockMath" : "updateInlineMath";
      const insertCmd = block ? "insertBlockMath" : "insertInlineMath";
      setInlineMathCompose(null);
      const releaseSuppress = () => {
        window.requestAnimationFrame(() => {
          suppressMathSelectionEditRef.current = false;
        });
      };
      if (!trimmed) {
        if (editPos !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (editor.chain().focus() as any)[deleteCmd]({ pos: editPos }).run();
        }
        if (resumePos !== undefined) {
          editor.chain().focus().setTextSelection(resumePos).run();
        } else {
          editor.chain().focus().run();
        }
        releaseSuppress();
        return;
      }
      if (editPos !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (editor.chain().focus() as any)[updateCmd]({ latex: trimmed, pos: editPos }).run();
        if (resumePos !== undefined) {
          editor.chain().focus().setTextSelection(resumePos).run();
        }
        releaseSuppress();
        return;
      }
      editor.chain().focus().setTextSelection(insertPos);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor.chain().focus() as any)[insertCmd]({ latex: trimmed, pos: insertPos }).run();
      releaseSuppress();
    }

    function cancelInlineMathCompose() {
      suppressMathSelectionEditRef.current = true;
      setInlineMathCompose(null);
      editor?.chain().focus().run();
      window.requestAnimationFrame(() => {
        suppressMathSelectionEditRef.current = false;
      });
    }

    function applyMath() {
      if (!editor) return;
      const latex = mathDialog.latex.trim();
      const editPos = mathDialog.editPos;
      if (latex) {
        if (mathDialog.block) {
          if (editPos !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (editor.chain().focus() as any).updateBlockMath({ latex, pos: editPos }).run();
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (editor.chain().focus() as any).insertBlockMath({ latex }).run();
          }
        } else if (editPos !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (editor.chain().focus() as any).updateInlineMath({ latex, pos: editPos }).run();
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (editor.chain().focus() as any).insertInlineMath({ latex }).run();
        }
      } else if (editPos !== undefined) {
        if (mathDialog.block) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (editor.chain().focus() as any).deleteBlockMath({ pos: editPos }).run();
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (editor.chain().focus() as any).deleteInlineMath({ pos: editPos }).run();
        }
      }
      setMathDialog({ open: false, latex: "", block: false, editPos: undefined });
    }

    function cancelMath() {
      editor?.chain().focus().run();
      setMathDialog({ open: false, latex: "", block: false, editPos: undefined });
    }

    // ── Comment helpers ──────────────────────────────────────────────────────

    function commitComments(next: PageComment[]) {
      commentsRef.current = next;
      editor?.commands.setComments(next);
      onCommentsChange?.(next);
    }

    function resolveCommentDraft(from: number, to: number) {
      if (!editor) return null;

      let effectiveFrom = from;
      let effectiveTo = to;

      if (from === to) {
        const word = wordRangeAtPos(editor, from);
        if (word) {
          effectiveFrom = word.from;
          effectiveTo = word.to;
        }
      }

      const quote = editor.state.doc.textBetween(effectiveFrom, effectiveTo, "").trim();
      if (!quote) return null;

      const coords = editor.view.coordsAtPos(effectiveTo);
      return {
        from: effectiveFrom,
        to: effectiveTo,
        quote,
        anchorRect: new DOMRect(
          coords.left,
          coords.top,
          Math.max(coords.right - coords.left, 1),
          coords.bottom - coords.top
        ),
      };
    }

    function handleAddComment(text: string) {
      if (!composerPending) return;
      const newComment: PageComment = {
        id: generateCommentId(),
        quote: composerPending.quote,
        text,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      commitComments([...commentsRef.current, newComment]);
      setComposerPending(null);
    }

    function handleResolveComment(id: string) {
      commitComments(
        commentsRef.current.map((c) =>
          c.id === id ? { ...c, resolvedAt: new Date().toISOString() } : c
        )
      );
    }

    function handleDeleteComment(id: string) {
      commitComments(commentsRef.current.filter((c) => c.id !== id));
    }

    // ── Context menu ─────────────────────────────────────────────────────────

    function handleContextMenu(e: React.MouseEvent) {
      e.preventDefault();
      if (!editor) return;
      const nativePointerType =
        "pointerType" in e.nativeEvent ? e.nativeEvent.pointerType : undefined;
      const pointerType = typeof nativePointerType === "string" ? nativePointerType : undefined;
      const coarsePointer =
        typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

      const isMobile = !shouldOpenEditorContextMenu({
        pointerType,
        coarsePointer,
        viewportWidth: typeof window !== "undefined" ? window.innerWidth : undefined,
      });

      const { from, to } = editor.state.selection;
      setContextMenu({ x: e.clientX, y: e.clientY, selectionFrom: from, selectionTo: to, mobile: isMobile });
    }

    function beginComposer(from: number, to: number) {
      const draft = resolveCommentDraft(from, to);
      if (!editor || !draft) return;

      editor.commands.setTextSelection({ from: draft.from, to: draft.to });

      setContextMenu(null);
      setComposerPending(draft);
    }

    function openComposer() {
      if (!editor || !contextMenu) return;
      beginComposer(contextMenu.selectionFrom, contextMenu.selectionTo);
    }

    function openComposerFromShortcut() {
      if (!editor || readOnly || isDrawMode) return;
      const { from, to } = editor.state.selection;
      beginComposer(from, to);
    }

    async function copySelectedText() {
      if (!editor) return;
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, "").trim();
      if (!text) return;

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return;
        }
      } catch {
        // Fall through to the legacy copy path when clipboard permissions are unavailable.
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      editor.commands.focus();
    }

    async function pasteFromClipboard() {
      if (!editor) return;
      try {
        const text = await navigator.clipboard.readText();
        if (!text) return;
        // Same Markdown-aware conversion as Ctrl+V, so the toolbar/bubble Paste
        // button renders AI Markdown instead of dropping in literal syntax.
        if (looksLikeMarkdown(text)) {
          editor.chain().focus().insertContent(parseMarkdownToTiptapJson(text)).run();
        } else {
          editor.chain().focus().insertContent(text).run();
        }
      } catch {
        // Clipboard permission denied or unavailable — silently no-op.
      }
    }

    function selectAllText() {
      if (!editor) return;
      editor.chain().focus().selectAll().run();
    }

    function toggleHeadingSection(sectionKey: string) {
      updateCollapsedHeadingKeys((current) =>
        current.includes(sectionKey)
          ? current.filter((key) => key !== sectionKey)
          : [...current, sectionKey]
      );
    }

    // ── Hover detection ──────────────────────────────────────────────────────

    function handleEditorMouseOver(e: React.MouseEvent) {
      const heading = (e.target as Element).closest<HTMLElement>("h1, h2, h3");
      if (heading && editor) {
        const headingIndex = Array.from(editor.view.dom.children).indexOf(heading);
        const control = headingChevronControls.find((section) => section.startIndex === headingIndex);
        if (control) {
          setHoveredHeadingKey(control.key);
        }
      }
      const el = (e.target as Element).closest("[data-comment-id]");
      if (!el) return;
      cancelPopoverClose();
      const id = el.getAttribute("data-comment-id")!;
      const comment = commentsRef.current.find((c) => c.id === id);
      if (!comment) return;
      setPopoverState({ comment, anchorRect: el.getBoundingClientRect() });
    }

    function handleEditorMouseOut(e: React.MouseEvent) {
      const relatedEl = e.relatedTarget as Element | null;
      const relatedHeading = relatedEl?.closest<HTMLElement>("h1, h2, h3, [data-heading-collapse-control]");
      if (relatedHeading) {
        if (relatedHeading.hasAttribute("data-heading-collapse-control")) {
          setHoveredHeadingKey(relatedHeading.getAttribute("data-heading-collapse-control"));
        } else if (editor) {
          const headingIndex = Array.from(editor.view.dom.children).indexOf(relatedHeading);
          const control = headingChevronControls.find((section) => section.startIndex === headingIndex);
          setHoveredHeadingKey(control?.key ?? null);
        }
      } else {
        setHoveredHeadingKey(null);
      }
      // Don't close if moving to another comment mark or to the popover
      if (relatedEl?.closest("[data-comment-id]")) return;
      if (popoverRef.current && relatedEl && popoverRef.current.contains(relatedEl)) return;
      schedulePopoverClose();
    }

    // ── Editor setup ─────────────────────────────────────────────────────────

    // Armed by Ctrl/Cmd+Shift+V so the next paste bypasses Markdown conversion
    // and drops in literal text (raw-paste escape hatch, SN-125).
    const plainPasteArmedRef = React.useRef(false);

    const editor = useEditor({
      extensions: createEditorExtensions(placeholder ?? "Write here…", true),
      content,
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: "editor-content focus:outline-none",
          "data-testid": "rich-text-editor",
          spellcheck: spellcheckEnabled ? "true" : "false",
        },
        handleDOMEvents: {
          click(_view, event) {
            if (isDrawMode) {
              return false;
            }
            const clickTarget = event.target instanceof Element ? event.target : null;
            const tocLink = clickTarget?.closest<HTMLElement>("[data-toc-target]");
            if (tocLink) {
              const anchorId = tocLink.getAttribute("data-toc-target");
              if (anchorId) {
                event.preventDefault();
                event.stopPropagation();
                scrollEditorToAnchor(scrollAreaRef.current, _view.dom, anchorId);
                return true;
              }
            }
            if (readOnly) {
              return false;
            }
            const target = resolvePdfAttachmentTarget(clickTarget);
            if (!target) {
              return false;
            }
            event.preventDefault();
            event.stopPropagation();
            openPdfReader(target);
            return true;
          },
        },
        handleKeyDown(_view, event) {
          if ((event.ctrlKey || event.metaKey) && event.key === "k") {
            event.preventDefault();
            openLinkDialog();
            return true;
          }
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "m") {
            event.preventDefault();
            openComposerFromShortcut();
            return true;
          }
          if (event.altKey && event.key === "=") {
            event.preventDefault();
            startInlineMathCompose();
            return true;
          }
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key === "0" &&
            !event.shiftKey &&
            !event.altKey
          ) {
            event.preventDefault();
            setWorkspaceZoom(EDITOR_ZOOM_DEFAULT);
            setWorkspacePan(EDITOR_PAN_DEFAULT);
            return true;
          }
          if (event.altKey && event.shiftKey && event.key === "+") {
            event.preventDefault();
            openMathDialog(true);
            return true;
          }
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
            // Raw paste: let the browser deliver the paste, but skip Markdown
            // conversion for it. Self-clears after the paste (or 1s) so it never
            // leaks into a later normal paste.
            plainPasteArmedRef.current = true;
            window.setTimeout(() => {
              plainPasteArmedRef.current = false;
            }, 1000);
            return false;
          }
          return false;
        },
        handlePaste(_view, event) {
          const items = event.clipboardData?.files;
          if (items?.length && pagePath) {
            event.preventDefault();
            void handleAssetFiles(items);
            return true;
          }
          if (plainPasteArmedRef.current) {
            // Ctrl/Cmd+Shift+V armed a raw paste — hand off to default handling.
            plainPasteArmedRef.current = false;
            return false;
          }
          // Markdown-aware paste: when the clipboard is plain text (no rich HTML
          // slice) that looks like Markdown, convert it so pasted AI output
          // renders as headings/lists/bold instead of literal #, -, ** characters.
          const clipboard = event.clipboardData;
          if (editor && clipboard) {
            const html = clipboard.getData("text/html");
            const text = clipboard.getData("text/plain");
            if (!html.trim() && text && looksLikeMarkdown(text)) {
              event.preventDefault();
              editor.chain().focus().insertContent(parseMarkdownToTiptapJson(text)).run();
              return true;
            }
          }
          return false;
        },
        handleDrop(_view, event) {
          const files = event.dataTransfer?.files;
          if (files?.length && pagePath) {
            event.preventDefault();
            void handleAssetFiles(files);
            return true;
          }
          return false;
        },
      },
      onUpdate({ editor: ed }) {
        if (readOnly) return;
        const html = ed.getHTML();
        lastEmittedRef.current = html;
        onChange(html);
      },
      onSelectionUpdate({ editor: ed }) {
        const { selection } = ed.state;
        if (selection instanceof TextSelection && selection.empty) {
          lastTextSelectionRef.current = selection.from;
        }
        onSelectionContextChange?.(resolveSectionContext(ed));
        enterMathEditFromSelection(ed);
      },
      immediatelyRender: false,
    });

    React.useEffect(() => {
      if (!editor?.view?.dom) return;
      editor.view.dom.setAttribute("spellcheck", spellcheckEnabled ? "true" : "false");
    }, [editor, spellcheckEnabled]);

    React.useEffect(() => {
      if (!editor?.view?.dom) return;

      // SN-233: on touch, jumping on pointerdown fires before a scroll gesture
      // can be recognized, so dragging over the TOC block navigates instead of
      // scrolling. Touch defers the jump to pointerup and cancels it once the
      // pointer travels past a small slop (or the gesture is cancelled by a
      // scroll). Mouse/keyboard keep the original immediate behavior.
      //
      // preventDefault() on pointerdown only suppresses the *compatibility
      // mouse events* (mousedown/mouseup/click's mouse-event cousins); per the
      // Pointer Events spec, click itself still fires. So every pointerdown
      // that handles a TOC entry arms `suppressNextClick`, and handleClick
      // consumes+clears it instead of jumping again — otherwise a drag that's
      // too short to trigger native scroll recognition (or any handled
      // pointerdown at all) still lets its trailing click re-fire the jump.
      let pendingTap: { anchorId: string; pointerId: number; x: number; y: number } | null = null;
      let suppressNextClick = false;

      const resolveTocLink = (event: Event) => {
        const target = event.target instanceof Element ? event.target : null;
        return target?.closest<HTMLElement>("[data-toc-target]") ?? null;
      };

      const jumpTo = (anchorId: string) => {
        scrollEditorToAnchor(scrollAreaRef.current, editor.view.dom as HTMLElement, anchorId);
      };

      const handlePointerDown = (event: PointerEvent) => {
        if (isDrawMode) return;
        const tocLink = resolveTocLink(event);
        if (!tocLink) {
          suppressNextClick = false;
          return;
        }
        const anchorId = tocLink.getAttribute("data-toc-target");
        if (!anchorId) {
          suppressNextClick = false;
          return;
        }
        // Capture-phase so hash/legacy <a> TOC links never navigate the app shell.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        suppressNextClick = true;

        if (event.pointerType === "touch") {
          pendingTap = { anchorId, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          return;
        }
        jumpTo(anchorId);
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (!pendingTap || event.pointerId !== pendingTap.pointerId) return;
        if (!isWithinTocTapSlop(pendingTap.x, pendingTap.y, event.clientX, event.clientY)) {
          pendingTap = null;
        }
      };

      const handlePointerUp = (event: PointerEvent) => {
        if (!pendingTap || event.pointerId !== pendingTap.pointerId) return;
        const { anchorId } = pendingTap;
        pendingTap = null;
        jumpTo(anchorId);
      };

      const handlePointerCancel = (event: PointerEvent) => {
        if (!pendingTap || event.pointerId !== pendingTap.pointerId) return;
        pendingTap = null;
      };

      const handleClick = (event: MouseEvent) => {
        if (isDrawMode) return;
        const tocLink = resolveTocLink(event);
        if (!tocLink) return;
        const anchorId = tocLink.getAttribute("data-toc-target");
        if (!anchorId) return;
        // Keep blocking hash/legacy <a> navigation and bubbling even when the
        // jump itself is suppressed below.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (suppressNextClick) {
          // A pointerdown already handled this interaction (jumped, cancelled
          // by slop, or cancelled by pointercancel) — the click is its
          // compatibility event, not a new activation. Don't jump again.
          suppressNextClick = false;
          return;
        }
        // No preceding pointerdown handled this — e.g. keyboard activation.
        jumpTo(anchorId);
      };

      const dom = editor.view.dom;
      dom.addEventListener("pointerdown", handlePointerDown, true);
      dom.addEventListener("pointermove", handlePointerMove, true);
      dom.addEventListener("pointerup", handlePointerUp, true);
      dom.addEventListener("pointercancel", handlePointerCancel, true);
      dom.addEventListener("click", handleClick, true);
      return () => {
        dom.removeEventListener("pointerdown", handlePointerDown, true);
        dom.removeEventListener("pointermove", handlePointerMove, true);
        dom.removeEventListener("pointerup", handlePointerUp, true);
        dom.removeEventListener("pointercancel", handlePointerCancel, true);
        dom.removeEventListener("click", handleClick, true);
      };
    }, [editor, isDrawMode]);

    React.useEffect(() => {
      if (!editor?.view?.dom || readOnly) return;

      const openPdfAttachment = (event: MouseEvent | PointerEvent) => {
        if (isDrawMode) return;
        const target = resolvePdfAttachmentTarget(
          event.target instanceof Element ? event.target : null
        );
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openPdfReader(target);
      };

      const dom = editor.view.dom;
      dom.addEventListener("pointerdown", openPdfAttachment, true);
      dom.addEventListener("click", openPdfAttachment, true);
      return () => {
        dom.removeEventListener("pointerdown", openPdfAttachment, true);
        dom.removeEventListener("click", openPdfAttachment, true);
      };
    }, [editor, isDrawMode, openPdfReader, readOnly]);

    React.useEffect(() => {
      if (readOnly || !editor) {
        setMathNodeClickHandler(null);
        return;
      }
      setMathNodeClickHandler(({ kind, node, pos }) => {
        const latex = String(node.attrs.latex ?? "");
        const resumePos = inferInlineMathResumePos(
          pos,
          node.nodeSize,
          lastTextSelectionRef.current,
          "after"
        );
        // SN-158: clicking either an inline or block equation opens the anchored
        // in-context editor, not the top-of-page dialog.
        startInlineMathComposeFromNode(pos, latex, resumePos, kind === "block");
      });
      return () => setMathNodeClickHandler(null);
    }, [readOnly, editor]);

    const [pageTocPresent, setPageTocPresent] = React.useState(false);

    React.useEffect(() => {
      if (!editor) {
        setPageTocPresent(false);
        return;
      }
      const syncTocPresence = () => {
        setPageTocPresent(documentHasPageToc(editor.state.doc));
      };
      syncTocPresence();
      editor.on("update", syncTocPresence);
      return () => {
        editor.off("update", syncTocPresence);
      };
    }, [editor]);

    const applyTocMutationWithInkRemap = React.useCallback(
      async (mutate: () => ReturnType<typeof upsertPageToc>) => {
        if (!editor || readOnly || isDrawMode) return;

        const editorRoot = editor.view.dom as HTMLElement;
        const heightBefore = measurePageTocHeight(editorRoot);
        const htmlBefore = editor.getHTML();
        const sceneBefore = annotationScene ?? null;

        const mutation = mutate();
        if (!mutation.ok) {
          toast.error(mutation.reason, { duration: 4000 });
          return;
        }
        if (mutation.action === "noop") {
          return;
        }

        await waitForNextPaint();
        const heightAfter = measurePageTocHeight(editorRoot);
        const deltaY = heightAfter - heightBefore;

        if (deltaY === 0) {
          return;
        }

        if (!annotationSceneHasInk(sceneBefore)) {
          return;
        }

        const layer = annotationLayerRef?.current;
        if (!layer) {
          editor.commands.setContent(htmlBefore, { emitUpdate: true });
          await waitForNextPaint();
          toast.error("Cannot adjust ink safely: annotation layer is not ready.", {
            duration: 5000,
          });
          return;
        }

        const remapped = layer.applyVerticalRemap(deltaY);
        if (!remapped.ok) {
          editor.commands.setContent(htmlBefore, { emitUpdate: true });
          await waitForNextPaint();
          toast.error(remapped.reason, { duration: 5000 });
        }
      },
      [annotationLayerRef, annotationScene, editor, isDrawMode, readOnly]
    );

    const handleUpsertPageToc = React.useCallback(() => {
      void applyTocMutationWithInkRemap(() => upsertPageToc(editor!));
    }, [applyTocMutationWithInkRemap, editor]);

    const handleRemovePageToc = React.useCallback(() => {
      void applyTocMutationWithInkRemap(() => removePageToc(editor!));
    }, [applyTocMutationWithInkRemap, editor]);

    // SN-230: the format-bar control is a toggle - insert when absent, remove
    // when present. Refresh stays on the explicit Insert-menu entry.
    const handleTogglePageToc = React.useCallback(() => {
      void applyTocMutationWithInkRemap(() => togglePageToc(editor!));
    }, [applyTocMutationWithInkRemap, editor]);

    const handleBackToTop = React.useCallback(() => {
      if (!editor) return;
      scrollEditorToPageToc(scrollAreaRef.current, editor.view.dom as HTMLElement);
    }, [editor]);

    // ── Derived: can we anchor a comment at the current context menu position? ─
    const hasCommentableText = React.useMemo(() => {
      if (!contextMenu || !editor) return false;
      const { selectionFrom: from, selectionTo: to } = contextMenu;
      if (from !== to) {
        return editor.state.doc.textBetween(from, to, "").trim().length > 0;
      }
      return wordRangeAtPos(editor, from) !== null;
    }, [contextMenu, editor]);
    const canCopyText =
      editor && !editor.state.selection.empty
        ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "").trim().length > 0
        : false;
    const canPasteFromClipboard = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);
    const bubbleSelectionText =
      editor && !editor.state.selection.empty
        ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "").trim()
        : "";
    const collapsedHeadingCss = React.useMemo(() => {
      if (headingChevronControls.length === 0) {
        return "";
      }

      const hiddenChildIndexes = new Set<number>();
      headingChevronControls.forEach((section) => {
        if (!section.collapsed) {
          return;
        }
        for (let childIndex = section.contentStartIndex; childIndex < section.endIndex; childIndex += 1) {
          hiddenChildIndexes.add(childIndex + 1);
        }
      });

      const scopeSelector = `[data-heading-collapse-scope="${collapseScopeId}"] [data-testid="rich-text-editor"]`;
      const baseRule = `${scopeSelector} > * { transform-origin: top; transition: max-height ${HEADING_COLLAPSE_ANIMATION_MS}ms ease, opacity ${HEADING_COLLAPSE_ANIMATION_MS}ms ease, margin ${HEADING_COLLAPSE_ANIMATION_MS}ms ease, padding ${HEADING_COLLAPSE_ANIMATION_MS}ms ease, border-width ${HEADING_COLLAPSE_ANIMATION_MS}ms ease; max-height: 9999px; opacity: 1; visibility: visible; }`;
      if (hiddenChildIndexes.size === 0) {
        return baseRule;
      }

      const collapsedRules = Array.from(hiddenChildIndexes)
        .sort((left, right) => left - right)
        .map(
          (index) =>
            `${scopeSelector} > :nth-child(${index}) { overflow: hidden !important; max-height: 0 !important; opacity: 0 !important; visibility: hidden !important; margin-top: 0 !important; margin-bottom: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; border-width: 0 !important; pointer-events: none !important; }`
        )
        .join("\n");

      return [baseRule, collapsedRules].filter(Boolean).join("\n");
    }, [collapseScopeId, headingChevronControls]);

    // ── Sync content from outside ────────────────────────────────────────────
    React.useEffect(() => {
      if (!editor) return;
      if (content === lastEmittedRef.current) return;
      lastEmittedRef.current = content;
      editor.commands.setContent(content);
    }, [editor, content]);

    React.useEffect(() => {
      if (!editor) return;
      editor.setEditable(!readOnly && !isDrawMode);
      if (isDrawMode) {
        editor.commands.blur();
      }
    }, [editor, isDrawMode, readOnly]);

    React.useEffect(() => {
      if (!isDrawMode || !annotationLayerRef?.current) return;
      annotationLayerRef.current.setTool(inkTool);
    }, [annotationLayerRef, inkTool, isDrawMode]);

    React.useEffect(() => {
      if (!isDrawMode || !annotationLayerRef) return;

      const handleWindowKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented) return;

        const command = getAnnotationHistoryCommand(event);
        if (!command) return;

        const target = event.target;
        if (
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement)
        ) {
          return;
        }

        event.preventDefault();
        if (command === "undo") {
          annotationLayerRef.current?.undo();
          return;
        }
        annotationLayerRef.current?.redo();
      };

      window.addEventListener("keydown", handleWindowKeyDown);
      return () => window.removeEventListener("keydown", handleWindowKeyDown);
    }, [annotationLayerRef, isDrawMode]);

    const syncViewportMetrics = React.useCallback(
      (metrics?: { scrollTop: number; viewportHeight: number }) => {
        // Capture mode pins the viewport height; ignore live scroll metrics so
        // the frame height stays deterministic during the screenshot.
        if (inkCaptureMode) return;
        const scrollArea = scrollAreaRef.current;
        if (!scrollArea && !metrics) return;
        setViewportHeight(metrics?.viewportHeight ?? scrollArea!.clientHeight);
        setScrollTop(metrics?.scrollTop ?? scrollArea!.scrollTop);
      },
      [inkCaptureMode]
    );

    React.useLayoutEffect(() => {
      if (!isDrawMode) return;
      syncViewportMetrics();
      // Log after syncViewportMetrics so dimensions are up-to-date
      const scrollArea = scrollAreaRef.current;
      logDrawEvent("rte.draw-mode-enter", {
        viewportHeight: scrollArea?.clientHeight ?? 0,
        inkViewportClipHeight,
        workspaceZoom,
        pagePath,
        touchActionOnClip: true,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDrawMode]);

    React.useEffect(() => {
      if (!editor) return;
      const proseMirror = editor.view.dom;

      const syncTextHeight = () => {
        setTextHeight(Math.max(proseMirror.scrollHeight, proseMirror.offsetHeight));
      };

      syncTextHeight();
      const observer = new ResizeObserver(syncTextHeight);
      observer.observe(proseMirror);
      return () => observer.disconnect();
    }, [editor, content]);

    React.useEffect(() => {
      const scrollArea = scrollAreaRef.current;
      if (!scrollArea || readOnly) return;

      const handleWheel = (event: WheelEvent) => {
        if (!isWorkspaceZoomWheel(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setWorkspacePan(EDITOR_PAN_DEFAULT);
        setWorkspaceZoom((current) => adjustEditorZoomFromWheel(current, event.deltaY));
      };

      scrollArea.addEventListener("wheel", handleWheel, { capture: true, passive: false });
      return () => scrollArea.removeEventListener("wheel", handleWheel, { capture: true });
    }, [readOnly]);

    React.useEffect(() => {
      if (workspaceZoom === EDITOR_ZOOM_DEFAULT) {
        setWorkspacePan(EDITOR_PAN_DEFAULT);
      }
    }, [workspaceZoom]);

    React.useEffect(() => {
      if (readOnly) return;

      const isTypingTarget = (target: EventTarget | null) => {
        const el = target as HTMLElement | null;
        if (!el) return false;
        const tag = el.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.code !== "Space" || event.repeat || isTypingTarget(event.target)) return;
        spaceHeldRef.current = true;
        setSpacePanHeld(true);
      };
      const onKeyUp = (event: KeyboardEvent) => {
        if (event.code !== "Space") return;
        spaceHeldRef.current = false;
        setSpacePanHeld(false);
        isPanningRef.current = false;
        setWorkspacePanning(false);
      };
      const onBlur = () => {
        spaceHeldRef.current = false;
        setSpacePanHeld(false);
        isPanningRef.current = false;
        setWorkspacePanning(false);
      };

      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
      };
    }, [readOnly]);

    React.useEffect(() => {
      if (readOnly) return;

      const isTypingTarget = (target: EventTarget | null) => {
        const el = target as HTMLElement | null;
        if (!el) return false;
        const tag = el.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === "0" &&
          !event.shiftKey &&
          !event.altKey &&
          !isTypingTarget(event.target)
        ) {
          event.preventDefault();
          setWorkspaceZoom(EDITOR_ZOOM_DEFAULT);
          setWorkspacePan(EDITOR_PAN_DEFAULT);
        }
      };

      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [readOnly]);

    const handleWorkspacePanPointerDown = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const isMiddleButton = event.button === 1;
        const isSpaceDrag =
          spaceHeldRef.current && event.button === 0 && shouldEnableWorkspacePan(workspaceZoom);

        if (isMiddleButton) {
          const scrollArea = scrollAreaRef.current;
          if (!scrollArea) return;
          event.preventDefault();
          event.stopPropagation();
          isPanningRef.current = true;
          setWorkspacePanning(true);

          const startX = event.clientX;
          const startY = event.clientY;
          const startScroll = { left: scrollArea.scrollLeft, top: scrollArea.scrollTop };

          const handlePointerMove = (moveEvent: PointerEvent) => {
            const next = applyScrollPan(
              startScroll,
              moveEvent.clientX - startX,
              moveEvent.clientY - startY
            );
            scrollArea.scrollLeft = next.left;
            scrollArea.scrollTop = next.top;
          };

          const cleanup = () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", cleanup);
            isPanningRef.current = false;
            setWorkspacePanning(false);
            scrollPanCleanupRef.current = null;
          };

          scrollPanCleanupRef.current?.();
          scrollPanCleanupRef.current = cleanup;
          window.addEventListener("pointermove", handlePointerMove);
          window.addEventListener("pointerup", cleanup, { once: true });
          return;
        }

        if (!isSpaceDrag) return;

        event.preventDefault();
        isPanningRef.current = true;
        setWorkspacePanning(true);
        panSessionRef.current = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          panX: workspacePanRef.current.x,
          panY: workspacePanRef.current.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      [workspaceZoom]
    );

    const handleWorkspacePanPointerMove = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (!isPanningRef.current) return;
        const session = panSessionRef.current;
        const deltaX = event.clientX - session.pointerX;
        const deltaY = event.clientY - session.pointerY;
        setWorkspacePan(
          applyWorkspacePan({ x: session.panX, y: session.panY }, deltaX, deltaY)
        );
      },
      []
    );

    const handleWorkspacePanPointerUp = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        setWorkspacePanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      []
    );

    React.useEffect(() => {
      const scrollArea = scrollAreaRef.current;
      if (!scrollArea) return;

      const handleScroll = () => syncViewportMetrics();

      syncViewportMetrics();
      const observer = new ResizeObserver(handleScroll);
      observer.observe(scrollArea);
      scrollArea.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        observer.disconnect();
        scrollArea.removeEventListener("scroll", handleScroll);
      };
    }, [syncViewportMetrics]);

    React.useEffect(() => {
      if (!editor) return;

      const syncHeadingChrome = () => {
        const proseMirror = editor.view.dom as HTMLElement;
        const childElements = Array.from(proseMirror.children) as HTMLElement[];
        const sections = collectCollapsibleHeadingSections(editor.state.doc, pagePath);
        const inkRanges = extractAnnotationVerticalRanges(annotationScene);
        const collapseCandidates = sections.filter((section) => section.hasCollapsibleContent);
        const nextControls: HeadingChevronControl[] = collapseCandidates
          .map((section) => {
            const headingElement = childElements[section.startIndex];
            if (!headingElement) {
              return null;
            }

            const contentElement = childElements[section.contentStartIndex];
            const lastContentElement = childElements[section.endIndex - 1];
            const contentTop = contentElement
              ? contentElement.offsetTop
              : headingElement.offsetTop + headingElement.offsetHeight;
            const contentBottom = lastContentElement
              ? lastContentElement.offsetTop + lastContentElement.offsetHeight
              : contentTop;

            return {
              ...section,
              disabled: sectionCollapseBlockedByInk(contentTop, contentBottom, inkRanges),
              collapsed: collapsedHeadingKeys.includes(section.key),
              hiddenByAncestor: false,
              top: headingElement.offsetTop,
              headingHeight: headingElement.offsetHeight,
            };
          })
          .filter((section): section is HeadingChevronControl => section !== null);

        const blockedKeys = new Set(
          nextControls.filter((section) => section.disabled).map((section) => section.key)
        );
        const validKeys = new Set(nextControls.map((section) => section.key));
        const nextCollapsedKeys = collapsedHeadingKeys.filter(
          (key) => validKeys.has(key) && !blockedKeys.has(key)
        );

        const collapsedKeysChanged =
          nextCollapsedKeys.length !== collapsedHeadingKeys.length ||
          nextCollapsedKeys.some((key, index) => key !== collapsedHeadingKeys[index]);

        const effectiveCollapsedKeys = readOnly
          ? []
          : collapsedKeysChanged
            ? nextCollapsedKeys
            : collapsedHeadingKeys;
        const collapsedSet = new Set(effectiveCollapsedKeys);
        const hiddenChildIndexes = new Set<number>();

        nextControls.forEach((section) => {
          if (!collapsedSet.has(section.key)) {
            return;
          }

          for (let childIndex = section.contentStartIndex; childIndex < section.endIndex; childIndex += 1) {
            hiddenChildIndexes.add(childIndex);
          }
        });

        nextControls.forEach((section) => {
          section.collapsed = collapsedSet.has(section.key);
          section.hiddenByAncestor = hiddenChildIndexes.has(section.startIndex);
        });

        // Always refresh back-to-top before any early return so inserting a TOC
        // (which can also reshuffle collapsed keys) still shows heading chrome.
        if (pageTocPresent) {
          // Overlay coordinates are relative to the content sizer, headings to
          // the positioned .ProseMirror box - convert once per sync (SN-231).
          const origin = measureOffsetOrigin(proseMirror, contentSizerRef.current);
          const contentLeft = origin.left;
          const contentWidth = proseMirror.clientWidth;
          setHeadingBackToTopControls(
            sections.flatMap((section) => {
              const headingElement = childElements[section.startIndex];
              if (!headingElement) return [];
              // SN-231: anchor to where the heading text actually ends, not to
              // the full block width, so the chevron reads as part of the line.
              const anchor = measureHeadingTextAnchor(headingElement);
              const placement = resolveBackToTopPlacement({
                textRight: origin.left + anchor.textRight,
                midY: origin.top + anchor.midY,
                contentLeft,
                contentWidth,
              });
              return [
                {
                  key: section.key,
                  headingOrder: section.headingOrder,
                  title: section.title,
                  top: placement.top,
                  left: placement.left,
                  align: placement.align,
                  hiddenByAncestor: hiddenChildIndexes.has(section.startIndex),
                },
              ];
            })
          );
        } else {
          setHeadingBackToTopControls([]);
        }

        if (collapsedKeysChanged) {
          updateCollapsedHeadingKeys(() => nextCollapsedKeys);
          return;
        }

        setHeadingChevronControls(nextControls);
        if (hoveredHeadingKey && !validKeys.has(hoveredHeadingKey)) {
          setHoveredHeadingKey(null);
        }
      };

      const frame = window.requestAnimationFrame(syncHeadingChrome);
      editor.on("update", syncHeadingChrome);
      return () => {
        window.cancelAnimationFrame(frame);
        editor.off("update", syncHeadingChrome);
      };
    }, [
      annotationScene,
      collapsedHeadingKeys,
      editor,
      hoveredHeadingKey,
      pagePath,
      pageTocPresent,
      readOnly,
      textHeight,
      updateCollapsedHeadingKeys,
    ]);

    // ── Seed editor with initial comments ────────────────────────────────────
    React.useEffect(() => {
      if (!editor) return;
      const next = initialComments ?? [];
      // Always seed when the editor instance changes (first mount).
      // For subsequent prop changes, skip if data is identical (guards against
      // infinite loops when the parent re-renders after onCommentsChange).
      const editorChanged = seededEditorRef.current !== editor;
      if (!editorChanged && JSON.stringify(commentsRef.current) === JSON.stringify(next)) return;
      seededEditorRef.current = editor;
      commentsRef.current = next;
      editor.commands.setComments(next);
    }, [editor, initialComments]);

    // ── Lifecycle ────────────────────────────────────────────────────────────
    React.useEffect(() => {
      onEditorReady?.(editor ?? null);
      if (editor) {
        onSelectionContextChange?.(resolveSectionContext(editor));
      }
      return () => {
        onEditorReady?.(null);
      };
    }, [editor, onEditorReady, onSelectionContextChange]);

    React.useImperativeHandle(
      ref,
      () => ({
        insertMarkdown(markdown: string) {
          if (!editor) return false;
          const json = parseMarkdownToTiptapJson(markdown);
          return editor.chain().focus().insertContent(json).run();
        },
        insertHtml(html: string) {
          if (!editor) return false;
          return editor.chain().focus().insertContent(html).run();
        },
        insertText(text: string) {
          if (!editor) return false;
          return editor.chain().focus().insertContent(text).run();
        },
        swapContent(html: string) {
          if (!editor) return false;
          lastEmittedRef.current = html;
          editor.commands.setContent(html);
          onSelectionContextChange?.(resolveSectionContext(editor));
          return true;
        },
        getExportSnapshot() {
          if (!editor) return null;
          const proseMirror = editor.view.dom;
          const measuredTextHeight = Math.max(proseMirror.scrollHeight, proseMirror.offsetHeight);
          return {
            html: editor.getHTML(),
            frameHeight: computePageFrameHeight({
              textHeight: measuredTextHeight,
              viewportHeight: viewportHeight || measuredTextHeight,
              drawableBottom,
            }),
          };
        },
      }),
      [editor, onSelectionContextChange, drawableBottom, viewportHeight]
    );

    // ── Render ───────────────────────────────────────────────────────────────
    return (
      <div
        className={cn(
          "editor-wrapper flex min-h-0 flex-col",
          className,
          readOnly && "editor-readonly"
        )}
        data-print-region="page-content"
        onContextMenu={readOnly || isDrawMode ? undefined : handleContextMenu}
      >
        <div
          ref={editorColumnRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
        <div className="print-page-header" data-print-title aria-hidden="true">
          <h1>{pageTitle.trim() || "Untitled page"}</h1>
        </div>
        {/* Draw mode toolbar — desktop */}
        {!readOnly && !hideFormatToolbar && annotationMode === "draw" ? (
          <div
            className="format-bar hidden md:flex md:items-center"
            data-testid="ink-format-bar"
            onMouseDown={(e) => e.preventDefault()}
          >
            {annotationLayerRef ? (
              <AnnotationDrawToolbar
                layerRef={annotationLayerRef}
                activeTool={inkTool}
                activeColor={inkColor}
                activeStroke={inkStroke}
                canUndo={annotationHistory.canUndo}
                canRedo={annotationHistory.canRedo}
                onToolChange={onInkToolChange ?? (() => undefined)}
                onColorChange={onInkColorChange ?? (() => undefined)}
                onStrokeChange={onInkStrokeChange ?? (() => undefined)}
                onExitDrawMode={() => onAnnotationModeChange?.("edit")}
                variant="desktop"
              />
            ) : null}
          </div>
        ) : null}

        {/* Format bar — desktop (Clarity toolbar) */}
        {!readOnly && !hideFormatToolbar && annotationMode !== "draw" ? (
        <div
          className="format-bar format-bar--clarity hidden gap-0.5 md:flex md:items-center"
          data-testid="format-bar"
          onPointerDownCapture={(e) => handleFormatBarChromePointerDown(editor, e)}
        >
          <AaStyleDropdown editor={editor} />
          <ToolbarSep />
          <ToolbarBtn onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold") ?? false} title="Bold (Ctrl+B)" testId="toolbar-bold"><Bold className="size-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic") ?? false} title="Italic (Ctrl+I)" testId="toolbar-italic"><Italic className="size-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive("strike") ?? false} title="Strikethrough (Ctrl+Shift+X)" testId="toolbar-strike"><Strikethrough className="size-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor?.chain().focus().toggleCode().run()} active={editor?.isActive("code") ?? false} title="Inline code (Ctrl+`)" testId="toolbar-code"><Code className="size-4" /></ToolbarBtn>
          <ToolbarSep />
          <TextColorDropdown editor={editor} />
          <ToolbarBtn
            onClick={() => onAnnotationModeChange?.("draw")}
            active={false}
            title="Draw annotations"
            testId="toolbar-annotate"
          >
            <PenLine className="size-4" />
          </ToolbarBtn>
          <ToolbarSep />
          <ListStyleDropdown editor={editor} />
          <ToolbarSep />
          <ToolbarBtn onClick={openLinkDialog} active={editor?.isActive("link") ?? false} title="Insert link (Ctrl+K)" testId="toolbar-link"><LinkIcon className="size-4" /></ToolbarBtn>
          <ToolbarBtn
            onClick={handleTogglePageToc}
            active={pageTocPresent}
            title={pageTocPresent ? "Remove table of contents" : "Insert table of contents"}
            testId="toolbar-page-toc"
          >
            <ListTree className="size-4" />
          </ToolbarBtn>
          <ToolbarSep />
          <InsertOverflowDropdown
            editor={editor}
            onInsertImage={() => fileInputRef.current?.click()}
            onTakePhoto={cameraCaptureSupported ? () => cameraInputRef.current?.click() : undefined}
            onInsertAttachment={() => attachmentInputRef.current?.click()}
            onOpenLink={openLinkDialog}
            onOpenMathInline={() => openMathDialog(false)}
            onOpenMathBlock={() => openMathDialog(true)}
            pageTocPresent={pageTocPresent}
            onUpsertPageToc={handleUpsertPageToc}
            onRemovePageToc={handleRemovePageToc}
          />
        </div>
        ) : null}

        {/* Format bar — mobile (Clarity condensed) */}
        {!readOnly && !hideFormatToolbar && annotationMode !== "draw" ? (
        <div
          className="format-bar format-bar--clarity flex items-center gap-1 md:hidden"
          data-testid="format-bar-mobile"
          onPointerDownCapture={(e) => handleFormatBarChromePointerDown(editor, e)}
        >
          <AaStyleDropdown editor={editor} mobile onOpenFontSheet={() => setFontSheetOpen(true)} />
          <ToolbarBtn onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold") ?? false} title="Bold (Ctrl+B)" testId="toolbar-bold-mobile"><Bold className="size-4" /></ToolbarBtn>
          <ToolbarBtn onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic") ?? false} title="Italic (Ctrl+I)" testId="toolbar-italic-mobile"><Italic className="size-4" /></ToolbarBtn>
          <TextColorDropdown editor={editor} mobile />
          <ToolbarBtn
            onClick={() => onAnnotationModeChange?.("draw")}
            active={false}
            title="Draw annotations"
            testId="toolbar-annotate-mobile"
          >
            <PenLine className="size-4" />
          </ToolbarBtn>
          <ListStyleDropdown editor={editor} mobile />
          <ToolbarBtn onClick={openLinkDialog} active={editor?.isActive("link") ?? false} title="Insert link (Ctrl+K)" testId="toolbar-link-mobile"><LinkIcon className="size-4" /></ToolbarBtn>
          <ToolbarBtn
            onClick={handleTogglePageToc}
            active={pageTocPresent}
            title={pageTocPresent ? "Remove table of contents" : "Insert table of contents"}
            testId="toolbar-page-toc-mobile"
          >
            <ListTree className="size-4" />
          </ToolbarBtn>
          <InsertOverflowDropdown
            editor={editor}
            mobile
            onInsertImage={() => fileInputRef.current?.click()}
            onTakePhoto={cameraCaptureSupported ? () => cameraInputRef.current?.click() : undefined}
            onInsertAttachment={() => attachmentInputRef.current?.click()}
            onOpenLink={openLinkDialog}
            onOpenMathInline={() => openMathDialog(false)}
            onOpenMathBlock={() => openMathDialog(true)}
            onUndo={() => editor?.chain().focus().undo().run()}
            onRedo={() => editor?.chain().focus().redo().run()}
            canUndo={editor?.can().undo() ?? false}
            canRedo={editor?.can().redo() ?? false}
            pageTocPresent={pageTocPresent}
            onUpsertPageToc={handleUpsertPageToc}
            onRemovePageToc={handleRemovePageToc}
          />
          <MobileFontSheet editor={editor} open={fontSheetOpen} onOpenChange={setFontSheetOpen} />
        </div>
        ) : null}

        {!readOnly && !hideFormatToolbar && annotationMode === "draw" ? (
          <div
            className="format-bar flex items-center gap-1 md:hidden"
            data-testid="ink-format-bar-mobile"
            onMouseDown={(e) => e.preventDefault()}
          >
            {annotationLayerRef ? (
              <AnnotationDrawToolbar
                layerRef={annotationLayerRef}
                activeTool={inkTool}
                activeColor={inkColor}
                activeStroke={inkStroke}
                canUndo={annotationHistory.canUndo}
                canRedo={annotationHistory.canRedo}
                onToolChange={onInkToolChange ?? (() => undefined)}
                onColorChange={onInkColorChange ?? (() => undefined)}
                onStrokeChange={onInkStrokeChange ?? (() => undefined)}
                onExitDrawMode={() => onAnnotationModeChange?.("edit")}
                variant="mobile"
              />
            ) : null}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleAssetFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          data-testid="camera-capture-input"
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handleAssetFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={attachmentInputRef}
          data-testid="attachment-file-input"
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={(e) => {
            void handleAssetFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Link dialog */}
        {!readOnly && linkDialog.open && (
          <div
            className="link-dialog"
            data-testid="link-dialog"
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelLink();
            }}
          >
            <input
              ref={linkInputRef}
              type="url"
              className="link-dialog-input"
              placeholder="https://..."
              value={linkDialog.href}
              onChange={(e) => setLinkDialog((d) => ({ ...d, href: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
              }}
              data-testid="link-dialog-input"
            />
            <button type="button" className="link-dialog-apply" onClick={applyLink} data-testid="link-dialog-apply">
              Apply
            </button>
            <button type="button" className="link-dialog-cancel" onClick={cancelLink} data-testid="link-dialog-cancel">
              Cancel
            </button>
          </div>
        )}

        {/* Inline equation compose (Alt+=) */}
        {!readOnly && inlineMathCompose ? (
          <div
            className="inline-math-compose"
            data-testid="inline-math-compose"
            data-math-kind={inlineMathCompose.block ? "block" : "inline"}
            style={{
              top: inlineMathCompose.anchorTop,
              left: inlineMathCompose.anchorLeft,
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelInlineMathCompose();
            }}
          >
            <div className="inline-math-compose__row">
              <span className="inline-math-compose__delimiter" aria-hidden="true">
                {inlineMathCompose.block ? "$$" : "$"}
              </span>
              <input
                ref={inlineMathInputRef}
                type="text"
                className="inline-math-compose__input font-mono"
                placeholder="e.g. \\lambda, \\frac, a/b"
                value={inlineMathCompose.latex}
                onChange={(e) =>
                  setInlineMathCompose((state) =>
                    state ? { ...state, latex: e.target.value } : state
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelInlineMathCompose();
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitInlineMathCompose(inlineMathCompose.latex);
                    return;
                  }
                  if (e.key === " ") {
                    e.preventDefault();
                    const result = handleInlineMathSpace(inlineMathCompose.latex);
                    if (result.commit) {
                      commitInlineMathCompose(result.latex);
                      return;
                    }
                    setInlineMathCompose((state) =>
                      state ? { ...state, latex: result.latex } : state
                    );
                    if (result.cursorPos !== undefined) {
                      requestAnimationFrame(() => {
                        const input = inlineMathInputRef.current;
                        input?.setSelectionRange(result.cursorPos!, result.cursorPos!);
                      });
                    }
                  }
                }}
                data-testid="inline-math-compose-input"
              />
              <span className="inline-math-compose__delimiter" aria-hidden="true">
                {inlineMathCompose.block ? "$$" : "$"}
              </span>
            </div>
            <InlineMathPreview
              latex={inlineMathCompose.latex}
              displayMode={inlineMathCompose.block}
            />
          </div>
        ) : null}

        {/* Math equation dialog */}
        {!readOnly && mathDialog.open && (
          <div
            className="link-dialog"
            data-testid="math-dialog"
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelMath();
            }}
          >
            <span className="text-[11px] font-mono text-[--color-text-muted] mr-1">
              {mathDialog.block ? "$$" : "$"}
            </span>
            <input
              ref={mathInputRef}
              type="text"
              className="link-dialog-input font-mono"
              placeholder={mathDialog.block ? "e.g. \\frac{a}{b}" : "e.g. E = mc^2"}
              value={mathDialog.latex}
              onChange={(e) => setMathDialog((d) => ({ ...d, latex: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyMath();
                }
              }}
              data-testid="math-dialog-input"
            />
            <span className="text-[11px] font-mono text-[--color-text-muted] ml-1">
              {mathDialog.block ? "$$" : "$"}
            </span>
            <button type="button" className="link-dialog-apply" onClick={applyMath} data-testid="math-dialog-apply">
              {mathDialog.editPos !== undefined ? "Update" : "Insert"}
            </button>
            <button type="button" className="link-dialog-cancel" onClick={cancelMath} data-testid="math-dialog-cancel">
              Cancel
            </button>
          </div>
        )}

        {/* Comment composer — rendered near selection anchor, not in toolbar flow */}
        {!readOnly && composerPending ? (
          <CommentComposer
            anchorRect={composerPending.anchorRect}
            onSubmit={handleAddComment}
            onCancel={() => setComposerPending(null)}
          />
        ) : null}

        {/* BubbleMenu — selection toolbar */}
        {!readOnly && !isDrawMode && editor && !composerPending && !contextMenu && (
          <BubbleMenu editor={editor} updateDelay={100} className="bubble-menu">
            <div className="bubble-toolbar" data-testid="bubble-menu">
              <BubbleBtn
                onClick={() => editor.chain().focus().toggleBold().run()}
                active={editor.isActive("bold")}
                label="B"
                style={{ fontWeight: 700 }}
              />
              <BubbleBtn
                onClick={() => editor.chain().focus().toggleItalic().run()}
                active={editor.isActive("italic")}
                label="I"
                style={{ fontStyle: "italic" }}
              />
              <div className="bubble-sep" />
              <BubbleBtn
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                active={editor.isActive("heading", { level: 1 })}
                label="H1"
              />
              <BubbleBtn
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                active={editor.isActive("heading", { level: 2 })}
                label="H2"
              />
              <div className="bubble-sep" />
              <BubbleBtn
                onClick={() => editor.chain().focus().toggleCode().run()}
                active={editor.isActive("code")}
                label="<>"
                style={{ fontFamily: "monospace" }}
              />
              <BubbleBtn
                onClick={() => editor.chain().focus().toggleHighlight().run()}
                active={editor.isActive("highlight")}
                label="HL"
              />
              <BubbleBtn onClick={openLinkDialog} active={editor.isActive("link")} label="Link" />
              <div className="bubble-sep md:hidden" />
              <BubbleBtn
                onClick={() => {
                  void copySelectedText();
                }}
                active={false}
                label="Copy"
                className="md:hidden"
                disabled={!bubbleSelectionText}
                testId="bubble-copy-mobile"
              />
              <BubbleBtn
                onClick={openComposerFromShortcut}
                active={false}
                label="Comment"
                className="md:hidden"
                disabled={!bubbleSelectionText}
                testId="bubble-comment-mobile"
              />
              <BubbleBtn
                onClick={() => { void pasteFromClipboard(); }}
                active={false}
                label="Paste"
                className="md:hidden"
                disabled={!canPasteFromClipboard}
                testId="bubble-paste-mobile"
              />
              <BubbleBtn
                onClick={selectAllText}
                active={false}
                label="Select all"
                className="md:hidden"
                testId="bubble-select-all-mobile"
              />
            </div>
          </BubbleMenu>
        )}

        {!readOnly && !isDrawMode && editor && !composerPending && !contextMenu && (
          <BubbleMenu
            editor={editor}
            updateDelay={100}
            className="bubble-menu"
            shouldShow={({ editor: ed }) => ed.isActive("image")}
          >
            <div className="bubble-toolbar" data-testid="image-bubble-menu">
              <BubbleBtn
                onClick={() => editor.chain().focus().setImageAlign("left").run()}
                active={
                  (editor.getAttributes("image").align as ImageAlign | undefined ?? "left") === "left"
                }
                label="Align left"
                testId="image-align-left"
              />
              <BubbleBtn
                onClick={() => editor.chain().focus().setImageAlign("center").run()}
                active={editor.getAttributes("image").align === "center"}
                label="Align center"
                testId="image-align-center"
              />
              <BubbleBtn
                onClick={() => editor.chain().focus().setImageAlign("right").run()}
                active={editor.getAttributes("image").align === "right"}
                label="Align right"
                testId="image-align-right"
              />
              <div className="bubble-sep" />
              {[25, 50, 75, 100].map((size) => (
                <BubbleBtn
                  key={size}
                  onClick={() => editor.chain().focus().setImageWidth(`${size}%`).run()}
                  active={String(editor.getAttributes("image").width ?? "").startsWith(String(size))}
                  label={`${size}%`}
                  testId={`image-width-${size}`}
                />
              ))}
            </div>
          </BubbleMenu>
        )}

        {/* Glass overlay: TipTap stays visible; ink layer covers the full page frame */}
        <div
          className="relative min-h-0 flex-1"
          data-testid="editor-surface"
          onPointerDownCapture={handleEditorPointerDownCapture}
          onClickCapture={handleEditorClickCapture}
          onClick={handleEditorClick}
          onMouseLeave={() => setHoveredHeadingKey(null)}
        >
          <div
            ref={scrollAreaRef}
            className={cn(
              "editor-scroll-area minimal-scrollbar relative h-full min-h-0 overflow-auto",
              workspacePanning && "editor-scroll-area--panning",
              !workspacePanning &&
                spacePanHeld &&
                shouldEnableWorkspacePan(workspaceZoom) &&
                "editor-scroll-area--pan-ready",
              !workspacePanning &&
                shouldEnableWorkspacePan(workspaceZoom) &&
                "editor-scroll-area--pannable"
            )}
            data-editor-pannable="true"
            onPointerDown={handleWorkspacePanPointerDown}
            onPointerMove={handleWorkspacePanPointerMove}
            onPointerUp={handleWorkspacePanPointerUp}
            onPointerCancel={handleWorkspacePanPointerUp}
            onAuxClick={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
          >
            <div
              className="relative w-full"
              style={editorZoomSpacerStyle(workspaceZoom, pageFrameHeight)}
            >
            <div
              ref={contentSizerRef}
              className={cn("relative w-full", MOBILE_EDITOR_FRAME_PADDING)}
              style={{
                ...(pageFrameHeight > 0 && workspaceZoom === EDITOR_ZOOM_DEFAULT
                  ? { minHeight: pageFrameHeight }
                  : undefined),
                ...editorZoomSurfaceStyle(workspaceZoom, workspacePan),
              }}
              data-testid="editor-content-frame"
              data-heading-collapse-scope={collapseScopeId}
              data-editor-zoom={workspaceZoom === EDITOR_ZOOM_DEFAULT ? undefined : workspaceZoom}
            >
              {collapsedHeadingCss ? <style>{collapsedHeadingCss}</style> : null}
              <EditorContent
                editor={editor}
                className={cn(
                  "editor-content focus:outline-none",
                  isDrawMode && "annotation-glass-readonly"
                )}
                onMouseOver={readOnly || isDrawMode ? undefined : handleEditorMouseOver}
                onMouseOut={readOnly || isDrawMode ? undefined : handleEditorMouseOut}
              />

              {!readOnly && !isDrawMode && headingChevronControls.length > 0 ? (
                <div className="pointer-events-none absolute inset-0 z-10" data-heading-collapse-ui="true">
                  {headingChevronControls
                    .filter((section) => !section.hiddenByAncestor)
                    .map((section) => {
                      const isVisible =
                        hoveredHeadingKey === section.key || section.collapsed;
                      const buttonTitle = section.disabled
                        ? DISABLED_HEADING_TOOLTIP
                        : section.collapsed
                          ? `Expand ${section.title}`
                          : `Collapse ${section.title}`;

                      return (
                        <div
                          key={section.key}
                          className="absolute left-0"
                          style={{
                            top: section.top + Math.max(section.headingHeight - 16, 0) / 2,
                          }}
                        >
                          <span
                            className="pointer-events-auto"
                            data-heading-collapse-control={section.key}
                            data-heading-collapse-key={section.key}
                            data-visible={isVisible ? "true" : "false"}
                            data-collapsed={section.collapsed ? "true" : "false"}
                            data-disabled={section.disabled ? "true" : "false"}
                            title={buttonTitle}
                            onMouseEnter={() => setHoveredHeadingKey(section.key)}
                            onMouseLeave={() => setHoveredHeadingKey(null)}
                          >
                            <button
                              type="button"
                              aria-label={buttonTitle}
                              aria-disabled={section.disabled}
                              aria-pressed={section.collapsed}
                              data-testid={`heading-collapse-toggle-${section.headingOrder}`}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (section.disabled) {
                                  return;
                                }
                                toggleHeadingSection(section.key);
                              }}
                              disabled={section.disabled}
                              className={cn(
                                "flex size-4 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground/45 shadow-none transition-[color,opacity,transform] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/30",
                                section.collapsed && "text-muted-foreground",
                                section.disabled
                                  ? "cursor-not-allowed opacity-35"
                                  : "hover:text-foreground active:text-foreground"
                              )}
                            >
                              <ChevronDown
                                className={cn(
                                  "size-2.5 transition-transform duration-200",
                                  section.collapsed && "-rotate-90"
                                )}
                                aria-hidden="true"
                              />
                            </button>
                          </span>
                        </div>
                      );
                    })}
                </div>
              ) : null}

              {pageTocPresent && !isDrawMode && headingBackToTopControls.length > 0 ? (
                <div
                  className="pointer-events-none absolute inset-0 z-20"
                  data-heading-back-to-top-ui="true"
                >
                  {headingBackToTopControls
                    .filter((section) => !section.hiddenByAncestor)
                    .map((section) => (
                      <div
                        key={`back-to-top-${section.key}`}
                        className="absolute"
                        style={{
                          // Sit on the last line's midline, just past its last
                          // glyph; the touch box grows around the chevron in CSS.
                          top: section.top,
                          left: section.left,
                          transform: "translateY(-50%)",
                        }}
                      >
                        <button
                          type="button"
                          className="pointer-events-auto inline-flex items-center border-0 bg-transparent text-muted-foreground shadow-none transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/30"
                          title="Back to table of contents"
                          aria-label={`Back to table of contents from ${section.title}`}
                          data-heading-back-to-top-control=""
                          data-back-to-top-align={section.align}
                          data-testid={`heading-back-to-top-${section.headingOrder}`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleBackToTop();
                          }}
                        >
                          <ChevronUp className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                </div>
              ) : null}

              {annotationOverlay ? (
                <div
                  className={cn(
                    "absolute inset-0",
                    isDrawMode ? "z-10 [&_.annotation-layer-host]:pointer-events-auto" : "pointer-events-none"
                  )}
                  data-print-ink-overlay
                >
                  {inkCaptureMode ? (
                    <div
                      className="relative w-full overflow-hidden"
                      style={pageFrameHeight > 0 ? { height: pageFrameHeight } : undefined}
                      data-print-ink-clip
                    >
                      <div className={cn("relative h-full w-full", MOBILE_EDITOR_FRAME_PADDING)}>
                        {React.isValidElement(annotationOverlay)
                          ? React.cloneElement(
                              annotationOverlay as React.ReactElement<{
                                scrollTop?: number;
                                viewportHeight?: number;
                                pageFrameHeight?: number;
                                scrollContainerRef?: React.RefObject<HTMLElement | null>;
                                onScrollMetricsChange?: (metrics: {
                                  scrollTop: number;
                                  viewportHeight: number;
                                }) => void;
                                onDrawableBottomChange?: (value: number) => void;
                              }>,
                              {
                                scrollTop: 0,
                                viewportHeight: pageFrameHeight || viewportHeight,
                                pageFrameHeight,
                                scrollContainerRef: scrollAreaRef,
                                onScrollMetricsChange: syncViewportMetrics,
                                onDrawableBottomChange,
                              }
                            )
                          : annotationOverlay}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="sticky top-0 w-full overflow-hidden"
                      style={{
                        ...(inkViewportClipHeight > 0 ? { height: inkViewportClipHeight } : {}),
                        // Prevents the browser from claiming touch gestures for
                        // page scroll before Tldraw can use them for drawing.
                        ...(isDrawMode ? { touchAction: "none" } : {}),
                      }}
                      data-print-ink-clip
                    >
                      <div className={cn("relative h-full w-full", MOBILE_EDITOR_FRAME_PADDING)}>
                        {React.isValidElement(annotationOverlay)
                          ? React.cloneElement(
                              annotationOverlay as React.ReactElement<{
                                scrollTop?: number;
                                viewportHeight?: number;
                                pageFrameHeight?: number;
                                workspaceZoom?: number;
                                scrollContainerRef?: React.RefObject<HTMLElement | null>;
                                onScrollMetricsChange?: (metrics: {
                                  scrollTop: number;
                                  viewportHeight: number;
                                }) => void;
                                onDrawableBottomChange?: (value: number) => void;
                              }>,
                              {
                                scrollTop,
                                viewportHeight,
                                pageFrameHeight,
                                workspaceZoom,
                                scrollContainerRef: scrollAreaRef,
                                onScrollMetricsChange: syncViewportMetrics,
                                onDrawableBottomChange,
                              }
                            )
                          : annotationOverlay}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            </div>
          </div>
        </div>

        {/* Right-click context menu */}
        {!readOnly && contextMenu && editor && (
          <EditorContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            editor={editor}
            mobile={contextMenu.mobile}
            canAddComment={hasCommentableText}
            canCopy={canCopyText}
            canPaste={canPasteFromClipboard}
            onAddComment={openComposer}
            onCopy={copySelectedText}
            onPaste={pasteFromClipboard}
            onSelectAll={selectAllText}
            onOpenLink={openLinkDialog}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Hover popover */}
        {!readOnly && popoverState && (
          <CommentPopover
            ref={popoverRef}
            comment={popoverState.comment}
            anchorRect={popoverState.anchorRect}
            onResolve={handleResolveComment}
            onDelete={handleDeleteComment}
            onClose={() => setPopoverState(null)}
            onMouseEnter={cancelPopoverClose}
            onMouseLeave={schedulePopoverClose}
          />
        )}
        </div>

        {pdfReader ? (
          <ImmersivePdfReader
            key={pdfReader.href}
            href={pdfReader.href}
            fileName={pdfReader.fileName}
            onClose={closePdfReader}
          />
        ) : null}
      </div>
    );
  }
);

function ToolbarBtn({
  onClick,
  active,
  title,
  testId,
  disabled = false,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  testId?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      data-testid={testId}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
      className={cn("toolbar-btn", active && "toolbar-btn--active", disabled && "opacity-40 cursor-not-allowed")}
    >
      {children}
    </button>
  );
}

function ToolbarSep() {
  return <div className="toolbar-sep" aria-hidden="true" />;
}

function MobileFontSheet({
  editor,
  open,
  onOpenChange,
}: {
  editor: import("@tiptap/react").Editor | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const currentFamily = editor?.getAttributes("textStyle").fontFamily as string | undefined;
  const currentSize = editor?.getAttributes("textStyle").fontSize as string | undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="px-4 pb-safe-bottom pb-8 pt-4" data-testid="mobile-font-sheet">
        <SheetHeader className="p-0 mb-3">
          <SheetTitle className="text-sm">Text Style</SheetTitle>
        </SheetHeader>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Font family</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {FONT_FAMILIES.map((f) => (
            <button
              key={f.value}
              type="button"
              data-testid={`toolbar-font-mobile-${f.label.toLowerCase().replace(/\s+/g, "-")}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setFontFamily(f.value).run(); }}
              onClick={() => onOpenChange(false)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                currentFamily === f.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background"
              )}
              style={{ fontFamily: f.value }}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            data-testid="toolbar-font-default-mobile"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().unsetFontFamily().run(); }}
            onClick={() => onOpenChange(false)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              !currentFamily
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground"
            )}
          >
            Default
          </button>
        </div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Font size</p>
        <div className="grid grid-cols-5 gap-2">
          {FONT_SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              data-testid={`toolbar-size-mobile-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
              onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setFontSize(s.value).run(); }}
              onClick={() => onOpenChange(false)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg border py-2.5 text-center transition-colors",
                currentSize === s.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background"
              )}
            >
              <span className="text-[11px] font-medium leading-none">{s.label}</span>
              <span className="text-[10px] text-muted-foreground leading-none">{s.value}</span>
            </button>
          ))}
          <button
            type="button"
            data-testid="toolbar-size-default-mobile"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().unsetFontSize().run(); }}
            onClick={() => onOpenChange(false)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-lg border py-2.5 text-center transition-colors",
              !currentSize
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground"
            )}
          >
            <span className="text-[11px] font-medium leading-none">Default</span>
            <span className="text-[10px] text-muted-foreground leading-none">16px</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DropdownMenuItemWithIcon({
  icon,
  label,
  trailing,
  onSelect,
  testId,
  active,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onSelect: () => void;
  testId?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuItem
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      data-testid={testId}
      data-active={active ? "true" : undefined}
      disabled={disabled}
      className="gap-2"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
      {trailing ? <span className="text-xs text-muted-foreground">{trailing}</span> : null}
    </DropdownMenuItem>
  );
}

function AaStyleDropdown({
  editor,
  mobile = false,
  onOpenFontSheet,
}: {
  editor: import("@tiptap/react").Editor | null;
  mobile?: boolean;
  onOpenFontSheet?: () => void;
}) {
  const activeSize = editor?.getAttributes("textStyle").fontSize as string | undefined;
  const sizeLabel = FONT_SIZES.find((s) => s.value === activeSize)?.value ?? "16px";
  const blockActive =
    (editor?.isActive("heading") ?? false) ||
    (editor?.isActive("blockquote") ?? false) ||
    (editor?.isActive("codeBlock") ?? false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "toolbar-btn toolbar-btn--wide",
          blockActive && "toolbar-btn--active"
        )}
        title="Text style"
        data-testid={mobile ? "toolbar-aa-mobile" : "toolbar-aa"}
        aria-label="Text style"
      >
        <span className="text-[13px] font-medium">Aa</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItemWithIcon
          icon={<Pilcrow className="size-3.5" />}
          label="Paragraph"
          testId={mobile ? "toolbar-paragraph-mobile" : "toolbar-paragraph"}
          active={!blockActive}
          onSelect={() => editor?.chain().focus().setParagraph().run()}
        />
        <DropdownMenuItemWithIcon
          icon={<Heading1 className="size-3.5" />}
          label="Heading 1"
          testId={mobile ? "toolbar-h1-mobile" : "toolbar-h1"}
          active={editor?.isActive("heading", { level: 1 }) ?? false}
          onSelect={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <DropdownMenuItemWithIcon
          icon={<Heading2 className="size-3.5" />}
          label="Heading 2"
          testId={mobile ? "toolbar-h2-mobile" : "toolbar-h2"}
          active={editor?.isActive("heading", { level: 2 }) ?? false}
          onSelect={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <DropdownMenuItemWithIcon
          icon={<Heading3 className="size-3.5" />}
          label="Heading 3"
          testId={mobile ? "toolbar-h3-mobile" : "toolbar-h3"}
          active={editor?.isActive("heading", { level: 3 }) ?? false}
          onSelect={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItemWithIcon
          icon={<Quote className="size-3.5" />}
          label="Quote"
          testId={mobile ? "toolbar-quote-mobile" : "toolbar-quote"}
          active={editor?.isActive("blockquote") ?? false}
          onSelect={() => editor?.chain().focus().toggleBlockquote().run()}
        />
        <DropdownMenuItemWithIcon
          icon={<SquareCode className="size-3.5" />}
          label="Code block"
          testId={mobile ? "toolbar-code-block-mobile" : "toolbar-code-block"}
          active={editor?.isActive("codeBlock") ?? false}
          onSelect={() => editor?.chain().focus().toggleCodeBlock().run()}
        />
        <DropdownMenuSeparator />
        {mobile ? (
          <DropdownMenuItemWithIcon
            icon={<Type className="size-3.5" />}
            label="Font & size"
            trailing={sizeLabel}
            testId="toolbar-font-sheet-trigger"
            onSelect={() => onOpenFontSheet?.()}
          />
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                <Type className="size-3.5" />
              </span>
              <span className="flex-1">Font & size</span>
              <span className="text-xs text-muted-foreground">{sizeLabel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44" data-testid="toolbar-font-family">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Font family</DropdownMenuLabel>
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().unsetFontFamily().run(); }}
                  data-testid="toolbar-font-default"
                >
                  Default
                </DropdownMenuItem>
                {FONT_FAMILIES.map((f) => (
                  <DropdownMenuItem
                    key={f.value}
                    onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setFontFamily(f.value).run(); }}
                    style={{ fontFamily: f.value }}
                    data-testid={`toolbar-font-${f.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {f.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel data-testid="toolbar-font-size">Font size</DropdownMenuLabel>
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().unsetFontSize().run(); }}
                  data-testid="toolbar-size-default"
                >
                  Default
                </DropdownMenuItem>
                {FONT_SIZES.map((s) => (
                  <DropdownMenuItem
                    key={s.value}
                    onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().setFontSize(s.value).run(); }}
                    data-testid={`toolbar-size-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {s.label} <span className="ml-auto text-muted-foreground">{s.value}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TextColorDropdown({
  editor,
  mobile = false,
}: {
  editor: import("@tiptap/react").Editor | null;
  mobile?: boolean;
}) {
  const currentColor = (editor?.getAttributes("textStyle").color as string | undefined) ?? "#000000";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="toolbar-btn"
        title="Text color"
        data-testid={mobile ? "toolbar-color-menu-mobile" : "toolbar-color-menu"}
        aria-label="Text color"
      >
        <span className="flex flex-col items-center leading-none">
          <span className="text-[13px] font-semibold">A</span>
          <span
            className="mt-0.5 h-[3px] w-3.5 rounded-full"
            style={{ backgroundColor: currentColor }}
          />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto p-2">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-0.5 py-0">Text color</DropdownMenuLabel>
          <div className="flex flex-wrap gap-1.5">
            {TEXT_COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                title={`Text color ${color}`}
                data-testid={
                  mobile
                    ? `toolbar-color-mobile-${color.slice(1)}`
                    : `toolbar-color-${color.slice(1)}`
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor?.chain().focus().setColor(color).run();
                }}
                className="size-7 rounded-md border border-border p-1"
              >
                <span className="block size-full rounded-full" style={{ backgroundColor: color }} />
              </button>
            ))}
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ListStyleDropdown({
  editor,
  mobile = false,
}: {
  editor: import("@tiptap/react").Editor | null;
  mobile?: boolean;
}) {
  const listActive =
    (editor?.isActive("bulletList") ?? false) ||
    (editor?.isActive("orderedList") ?? false) ||
    (editor?.isActive("taskList") ?? false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn("toolbar-btn toolbar-btn--wide", listActive && "toolbar-btn--active")}
        title="Lists"
        data-testid={mobile ? "toolbar-list-menu-mobile" : "toolbar-list-menu"}
        aria-label="Lists"
      >
        <List className="size-4" />
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItemWithIcon
          icon={<List className="size-3.5" />}
          label="Bullet list"
          testId={mobile ? "toolbar-bullet-list-mobile" : "toolbar-bullet-list"}
          active={editor?.isActive("bulletList") ?? false}
          onSelect={() => editor?.chain().focus().toggleBulletList().run()}
        />
        <DropdownMenuItemWithIcon
          icon={<ListOrdered className="size-3.5" />}
          label="Numbered list"
          testId={mobile ? "toolbar-ordered-list-mobile" : "toolbar-ordered-list"}
          active={editor?.isActive("orderedList") ?? false}
          onSelect={() => editor?.chain().focus().toggleOrderedList().run()}
        />
        <DropdownMenuItemWithIcon
          icon={<CheckSquare className="size-3.5" />}
          label="Task list"
          testId={mobile ? "toolbar-task-list-mobile" : "toolbar-task-list"}
          active={editor?.isActive("taskList") ?? false}
          onSelect={() => editor?.chain().focus().toggleTaskList().run()}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InsertOverflowDropdown({
  editor,
  mobile = false,
  onInsertImage,
  onTakePhoto,
  onInsertAttachment,
  onOpenLink,
  onOpenMathInline,
  onOpenMathBlock,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  pageTocPresent = false,
  onUpsertPageToc,
  onRemovePageToc,
}: {
  editor: import("@tiptap/react").Editor | null;
  mobile?: boolean;
  onInsertImage: () => void;
  /** Provided only on capture-capable mobile/tablet browsers (SN-140). */
  onTakePhoto?: () => void;
  onInsertAttachment: () => void;
  onOpenLink: () => void;
  onOpenMathInline: () => void;
  onOpenMathBlock: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  pageTocPresent?: boolean;
  onUpsertPageToc?: () => void;
  onRemovePageToc?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="toolbar-btn toolbar-btn--wide"
        title="Insert"
        data-testid={mobile ? "toolbar-insert-menu-mobile" : "toolbar-insert-menu"}
        aria-label="Insert"
      >
        <Plus className="size-4" />
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {/* SN-230: refresh lives here now that the format-bar control toggles. */}
        <DropdownMenuItemWithIcon
          icon={<ListTree className="size-3.5" />}
          label={pageTocPresent ? "Refresh contents" : "Table of contents"}
          testId={mobile ? "toolbar-page-toc-overflow-mobile" : "toolbar-page-toc-overflow"}
          onSelect={() => onUpsertPageToc?.()}
        />
        {pageTocPresent ? (
          <DropdownMenuItemWithIcon
            icon={<Minus className="size-3.5" />}
            label="Remove contents"
            testId={mobile ? "toolbar-page-toc-remove-mobile" : "toolbar-page-toc-remove"}
            onSelect={() => onRemovePageToc?.()}
          />
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItemWithIcon
          icon={<Minus className="size-3.5" />}
          label="Horizontal rule"
          testId={mobile ? "toolbar-hr-mobile" : "toolbar-hr"}
          onSelect={() => editor?.chain().focus().setHorizontalRule().run()}
        />
        <DropdownMenuItemWithIcon
          icon={<Highlighter className="size-3.5" />}
          label="Highlight"
          testId={mobile ? "toolbar-highlight-mobile" : "toolbar-highlight"}
          active={editor?.isActive("highlight") ?? false}
          onSelect={() => editor?.chain().focus().toggleHighlight().run()}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItemWithIcon
          icon={<ImageIcon className="size-3.5" />}
          label="Insert image"
          testId={mobile ? "toolbar-image-mobile" : "toolbar-image"}
          onSelect={onInsertImage}
        />
        {onTakePhoto ? (
          <DropdownMenuItemWithIcon
            icon={<Camera className="size-3.5" />}
            label="Take photo"
            testId={mobile ? "toolbar-camera-mobile" : "toolbar-camera"}
            onSelect={onTakePhoto}
          />
        ) : null}
        <DropdownMenuItemWithIcon
          icon={<Paperclip className="size-3.5" />}
          label="Attach file"
          testId={mobile ? "toolbar-attachment-mobile" : "toolbar-attachment"}
          onSelect={onInsertAttachment}
        />
        <DropdownMenuItemWithIcon
          icon={<TableIcon className="size-3.5" />}
          label="Insert table"
          testId={mobile ? "toolbar-table-mobile" : "toolbar-table"}
          onSelect={() =>
            editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        />
        <DropdownMenuSeparator />
        <DropdownMenuItemWithIcon
          icon={<Calendar className="size-3.5" />}
          label="Today"
          testId={mobile ? "toolbar-insert-today-mobile" : "toolbar-insert-today"}
          onSelect={() => editor?.chain().focus().insertContent(formatLocalDate()).run()}
        />
        <DropdownMenuItemWithIcon
          icon={<LinkIcon className="size-3.5" />}
          label="Insert link"
          testId={mobile ? "toolbar-link-overflow-mobile" : "toolbar-link-overflow"}
          onSelect={onOpenLink}
        />
        <DropdownMenuItemWithIcon
          icon={<Sigma className="size-3.5" />}
          label="Inline equation"
          testId={mobile ? "toolbar-math-inline-mobile" : "toolbar-math-inline"}
          onSelect={onOpenMathInline}
        />
        <DropdownMenuItemWithIcon
          icon={<span className="text-[10px] font-mono">∑</span>}
          label="Block equation"
          testId={mobile ? "toolbar-math-block-mobile" : "toolbar-math-block"}
          onSelect={onOpenMathBlock}
        />
        {mobile && onUndo && onRedo ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItemWithIcon
              icon={<Undo2 className="size-3.5" />}
              label="Undo"
              testId="toolbar-undo-mobile"
              disabled={!canUndo}
              onSelect={onUndo}
            />
            <DropdownMenuItemWithIcon
              icon={<Redo2 className="size-3.5" />}
              label="Redo"
              testId="toolbar-redo-mobile"
              disabled={!canRedo}
              onSelect={onRedo}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BubbleBtn({
  onClick,
  active,
  label,
  style,
  className,
  disabled = false,
  testId,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  style?: React.CSSProperties;
  className?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn("bubble-btn", active && "bubble-btn--active", disabled && "bubble-btn--disabled", className)}
      style={style}
    >
      {label}
    </button>
  );
}
