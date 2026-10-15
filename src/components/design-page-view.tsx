"use client";
import { invokeInlineAi } from "@/lib/inline-ai";

import * as React from "react";
import dynamic from "next/dynamic";
import { Menu, Pen, Eye, Code2, FolderOpen, Link2, Download, Bold, Italic, Underline, List, ListOrdered, Undo2, Redo2, MessageSquare } from "lucide-react";
import type {
  AnnotationLayerHandle,
  AnnotationStrokeSize,
  AnnotationTool,
} from "@/components/annotation-layer";
import { AnnotationDrawToolbar } from "@/components/annotation-draw-toolbar";
import type { TLDefaultColorStyle } from "tldraw";
import { buildDesignSrcDoc, isDesignFrameMessage, type DesignCommentRect } from "@/components/ui-render-view";
import { CommentComposer } from "@/components/comment-layer";
import { DesignCommentsPanel, type DesignCommentAnchor } from "@/components/design-comments-panel";
import { generateCommentId, type PageComment } from "@/lib/comment-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { A4_WIDTH_PX, measureDesignPages } from "@/lib/design-pagination";
import { applyDesignElementEdit, readDesignMaxPages, setDesignMaxPages } from "@/lib/design-html-edit";

const AnnotationLayer = dynamic(
  () => import("@/components/annotation-layer").then((module) => module.AnnotationLayer),
  { ssr: false }
);

// CodeMirror needs the DOM — load client-only so /render/ui SSR stays clean.
const CodeMirrorEditor = dynamic(
  () => import("@/components/code-mirror-editor").then((module) => module.CodeMirrorEditor),
  { ssr: false }
);

type DesignTab = "preview" | "source";

export interface DesignPageViewProps {
  pagePath: string;
  title: string;
  /** Raw HTML/CSS artifact body (draft.content) rendered verbatim in an isolated frame. */
  bodyHtml: string;
  onOpenSidebar?: () => void;
  onSaveStatusChange?: (status: "idle" | "saving" | "saved" | "error") => void;
  /**
   * Called when the owner edits the raw artifact body in the Source tab. The
   * shell routes this into draft.content, and the generic autosave persists it
   * verbatim (no Tiptap normalization). Omit to make the page read-only.
   */
  onBodyChange?: (nextBody: string) => void;
  /** Optional target-project token stylesheet injected into the frame <head>. */
  tokenCss?: string;
  /** SN-168: body is an ordinary linked HTML file (no vault frontmatter). */
  designLinked?: boolean;
  /** SN-168: link metadata exists but the HTML ground-truth file is missing. */
  sourceMissing?: boolean;
  /** Absolute OS path of the linked HTML when known. */
  resolvedDiskPath?: string | null;
  onRevealSource?: () => void;
  onRelinkSource?: () => void;
  /**
   * SN-168: open the in-app portable HTML browser to link an ordinary file
   * in place. Shown on unlinked design pages inside a portable notebook.
   */
  onLinkFromSource?: () => void;
  /** SN-310: owner comments for the companion (page `comments` metadata). */
  comments?: PageComment[];
  /** SN-310: persist the full comments array (PUT /api/page/comments). Omit to hide comments. */
  onCommentsChange?: (comments: PageComment[]) => void;
}

/** An anchor captured on right-click/press is only trusted for the menu it opened. */
const COMMENT_ANCHOR_TTL_MS = 2000;
const PAGE_ANCHOR: DesignCommentAnchor = { path: null, tag: "", quote: "" };

function pointRect(x: number, y: number): DOMRect {
  return { x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
}

/**
 * Live design-page surface (note_type=design, SN-167). Two tabs:
 * - Preview: the raw HTML/CSS artifact rendered verbatim in an isolated `srcDoc`
 *   iframe (NOT Tiptap) with an editable stylus overlay for pen authoring. Ink
 *   persists to `.annotations.json` and is composited into `renderUiToPng`.
 * - Source: a plain-text editor over the raw artifact body so the owner can edit
 *   the HTML/CSS directly; changes flow to draft.content and autosave verbatim.
 *
 * Linked designs (SN-168) reuse this surface; Source writes through to the
 * ordinary HTML file, and Reveal/Relink cover missing-source recovery.
 */
export function DesignPageView({
  pagePath,
  title,
  bodyHtml,
  onOpenSidebar,
  onSaveStatusChange,
  onBodyChange,
  tokenCss,
  designLinked = false,
  sourceMissing = false,
  resolvedDiskPath,
  onRevealSource,
  onRelinkSource,
  onLinkFromSource,
  comments,
  onCommentsChange,
}: DesignPageViewProps) {
  const editable = typeof onBodyChange === "function" && !sourceMissing;
  const showLinkFromSource = !designLinked && typeof onLinkFromSource === "function";
  const [tab, setTab] = React.useState<DesignTab>("preview");
  const [drawMode, setDrawMode] = React.useState(false);
  const [frameHeight, setFrameHeight] = React.useState(900);
  const [viewportHeight, setViewportHeight] = React.useState(900);
  const [body, setBody] = React.useState(bodyHtml);
  const bodyRef = React.useRef(bodyHtml);
  const [previewBody, setPreviewBody] = React.useState(bodyHtml);
  const [pageLayout, setPageLayout] = React.useState(false);
  const [pageMeasurement, setPageMeasurement] = React.useState(() => measureDesignPages(900));
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const isEmptyArtifact = !body.trim();
  const sourceFileName = resolvedDiskPath?.split(/[\\/]/).filter(Boolean).at(-1);
  const [inkTool, setInkTool] = React.useState<AnnotationTool>("draw");
  const [inkColor, setInkColor] = React.useState<TLDefaultColorStyle>("black");
  const [inkStroke, setInkStroke] = React.useState<AnnotationStrokeSize>("m");
  const [inkHistory, setInkHistory] = React.useState({ canUndo: false, canRedo: false });

  const commentsEnabled = typeof onCommentsChange === "function" && !sourceMissing;
  const commentsKey = JSON.stringify(comments ?? []);
  const [pageComments, setPageComments] = React.useState<PageComment[]>(() => comments ?? []);
  const pageCommentsRef = React.useRef(pageComments);
  const onCommentsChangeRef = React.useRef(onCommentsChange);
  onCommentsChangeRef.current = onCommentsChange;
  const commentsEnabledRef = React.useRef(commentsEnabled);
  commentsEnabledRef.current = commentsEnabled;
  const lastAnchorRef = React.useRef<(DesignCommentAnchor & { at: number }) | null>(null);
  const [composer, setComposer] = React.useState<{ anchor: DesignCommentAnchor; rect: DOMRect } | null>(null);
  const [commentsOpen, setCommentsOpen] = React.useState(false);
  const [focusedCommentId, setFocusedCommentId] = React.useState<string | null>(null);
  const [pinRects, setPinRects] = React.useState<DesignCommentRect[]>([]);
  const activeComments = pageComments.filter((comment) => !comment.resolvedAt);

  React.useEffect(() => {
    const next = JSON.parse(commentsKey) as PageComment[];
    pageCommentsRef.current = next;
    setPageComments(next);
  }, [commentsKey]);

  const commitComments = React.useCallback((next: PageComment[]) => {
    pageCommentsRef.current = next;
    setPageComments(next);
    onCommentsChangeRef.current?.(next);
  }, []);

  const openComposer = React.useCallback((anchor: DesignCommentAnchor, rect: DOMRect) => {
    setComposer({ anchor, rect });
  }, []);

  const submitComment = React.useCallback(
    (text: string) => {
      if (!composer) return;
      const { anchor } = composer;
      const comment: PageComment = {
        id: generateCommentId(),
        quote: anchor.quote,
        text,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        ...(anchor.path && anchor.path.length > 0
          ? { target: { kind: "design-element" as const, path: anchor.path, tag: anchor.tag } }
          : {}),
      };
      commitComments([...pageCommentsRef.current, comment]);
      setComposer(null);
      setCommentsOpen(true);
      setFocusedCommentId(comment.id);
    },
    [commitComments, composer]
  );

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const annotationLayerRef = React.useRef<AnnotationLayerHandle | null>(null);

  const srcDoc = React.useMemo(() => buildDesignSrcDoc(previewBody, tokenCss, editable), [previewBody, tokenCss, editable]);
  const maxPages = readDesignMaxPages(body);

  React.useEffect(() => {
    setDrawMode(false);
    setTab("preview");
    setBody(bodyHtml);
    bodyRef.current = bodyHtml;
    setPreviewBody(bodyHtml);
    setInkTool("draw");
    setInkColor("black");
    setInkStroke("m");
    setInkHistory({ canUndo: false, canRedo: false });
    setComposer(null);
    setFocusedCommentId(null);
    setPinRects([]);
    lastAnchorRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagePath]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setViewportHeight((h) => (Math.abs(el.clientHeight - h) > 1 ? el.clientHeight : h));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow || !isDesignFrameMessage(event.data)) {
        return;
      }
      if (event.data.kind === "comment-anchor") {
        lastAnchorRef.current = { path: event.data.path, tag: event.data.tag, quote: event.data.quote, at: Date.now() };
        return;
      }
      if (event.data.kind === "comment-rects") {
        setPinRects(event.data.rects);
        return;
      }
      if (event.data.kind === "ask-companion") {
        const rect = iframeRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = rect.left + event.data.x;
        const y = rect.top + event.data.y;
        const captured = lastAnchorRef.current;
        lastAnchorRef.current = null;
        const anchor: DesignCommentAnchor =
          captured && Date.now() - captured.at < COMMENT_ANCHOR_TTL_MS
            ? { path: captured.path, tag: captured.tag, quote: captured.quote }
            : PAGE_ANCHOR;
        invokeInlineAi({
          context: event.data.context,
          x,
          y,
          menu: true,
          menuActions: commentsEnabledRef.current
            ? [{ id: "add-comment", label: "Add comment", run: () => openComposer(anchor, pointRect(x, y)) }]
            : undefined,
        });
        return;
      }
      if (
        event.data.kind === "height" &&
        Number.isFinite(event.data.height) &&
        event.data.height > 0
      ) {
        const next = Math.max(event.data.height, 900);
        setFrameHeight((current) => (Math.abs(next - current) > 1 ? next : current));
        setPageMeasurement(measureDesignPages(event.data.height));
      } else if (event.data.kind === "edit") {
        const next = applyDesignElementEdit(bodyRef.current, event.data.path, event.data.html, event.data.mode);
        if (next !== null && next !== bodyRef.current) {
          bodyRef.current = next;
          setBody(next);
          onBodyChange?.(next);
        }
      } else if (event.data.kind === "external-link") {
        window.open(event.data.href, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onBodyChange, openComposer]);

  // SN-310 pins: ask the frame where commented elements are whenever comments
  // change or the frame reports a new content height (load, reflow, resize).
  const pinTargetsKey = JSON.stringify(
    activeComments.flatMap((comment) => (comment.target ? [{ id: comment.id, path: comment.target.path }] : []))
  );
  React.useEffect(() => {
    if (tab !== "preview" || !commentsEnabled) {
      setPinRects([]);
      return;
    }
    const items = JSON.parse(pinTargetsKey) as Array<{ id: string; path: number[] }>;
    if (items.length === 0) {
      setPinRects([]);
      return;
    }
    iframeRef.current?.contentWindow?.postMessage({ source: "smart-notes-design-frame", kind: "comment-rects-request", items }, "*");
  }, [pinTargetsKey, frameHeight, pageMeasurement, tab, commentsEnabled]);

  React.useEffect(() => {
    const ref = annotationLayerRef;
    return () => {
      void ref.current?.flush().catch(() => undefined);
    };
  }, [pagePath]);

  const enterDrawMode = React.useCallback(() => {
    setInkTool("draw");
    annotationLayerRef.current?.setTool("draw");
    setDrawMode(true);
  }, []);

  const exitDrawMode = React.useCallback(async () => {
    try {
      await annotationLayerRef.current?.flush();
    } catch {
      // keep in-memory ink visible even if flush fails
    }
    setDrawMode(false);
  }, []);

  const handleSourceChange = React.useCallback(
    (next: string) => {
      setBody(next);
      bodyRef.current = next;
      onBodyChange?.(next);
    },
    [onBodyChange]
  );

  const selectTab = React.useCallback(
    async (next: DesignTab) => {
      if (next === tab) return;
      if (tab === "preview" && drawMode) {
        try {
          await annotationLayerRef.current?.flush();
        } catch {
          // keep in-memory ink visible even if flush fails
        }
        setDrawMode(false);
      }
      if (next === "preview") setPreviewBody(bodyRef.current);
      setTab(next);
    },
    [drawMode, tab]
  );

  const format = React.useCallback((command: string, value?: string) => {
    iframeRef.current?.contentWindow?.postMessage({ source: "smart-notes-design-frame", kind: "format", command, value }, "*");
  }, []);

  const changeMaxPages = React.useCallback((value: string) => {
    const parsed = value === "" ? null : Number(value);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 100)) return;
    const next = setDesignMaxPages(bodyRef.current, parsed);
    bodyRef.current = next;
    setBody(next);
    onBodyChange?.(next);
  }, [onBodyChange]);

  const exportPdf = React.useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/design/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pagePath, bodyHtml: bodyRef.current }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error ?? "PDF export failed");
      }
      const pages = Number(response.headers.get("X-Design-Page-Count"));
      if (Number.isFinite(pages) && pages > 0) setPageMeasurement((current) => ({ ...current, pages }));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.trim() || "Design page"}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }, [pagePath, title]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="design-page-view">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {onOpenSidebar ? (
          <button
            data-testid="design-sidebar-toggle"
            onClick={onOpenSidebar}
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open sidebar"
          >
            <Menu className="size-4" />
          </button>
        ) : null}
        <h1 className="min-w-0 flex-1 basis-[calc(100%-2.25rem)] truncate text-sm font-semibold tracking-tight sm:basis-auto">
          {title.trim() || "Untitled design"}
        </h1>

        {showLinkFromSource ? (
          <button
            data-testid="design-link-from-source"
            onClick={onLinkFromSource}
            title="Link an existing self-contained HTML file in place"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Link2 className="size-3.5" />
            Link from source…
          </button>
        ) : null}

        {designLinked && onRevealSource ? (
          <button
            data-testid="design-reveal-source"
            onClick={onRevealSource}
            title={resolvedDiskPath ?? "Reveal linked HTML"}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-surface hover:text-foreground"
          >
            <FolderOpen className="size-3.5" />
            Reveal
          </button>
        ) : null}

        <div className="flex shrink-0 items-center rounded-md border border-border p-0.5" role="tablist">
          <button
            data-testid="design-tab-preview"
            role="tab"
            aria-selected={tab === "preview"}
            onClick={() => void selectTab("preview")}
            disabled={sourceMissing}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition",
              tab === "preview" ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground",
              sourceMissing && "opacity-50"
            )}
          >
            <Eye className="size-3.5" />
            Preview
          </button>
          <button
            data-testid="design-tab-source"
            role="tab"
            aria-selected={tab === "source"}
            onClick={() => void selectTab("source")}
            disabled={sourceMissing}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition",
              tab === "source" ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground",
              sourceMissing && "opacity-50"
            )}
          >
            <Code2 className="size-3.5" />
            Source
          </button>
        </div>

        {tab === "preview" && !drawMode && !sourceMissing ? (
          <button
            data-testid="design-pen-toggle"
            onClick={enterDrawMode}
            aria-pressed={false}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-surface hover:text-foreground"
          >
            <Pen className="size-3.5" />
            Annotate
          </button>
        ) : null}

        {commentsEnabled ? (
          <button
            type="button"
            data-testid="design-comments-toggle"
            onClick={() => setCommentsOpen((open) => !open)}
            aria-pressed={commentsOpen}
            aria-label={`Comments (${activeComments.length} open)`}
            title="Comments for the companion"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-surface aria-pressed:text-foreground max-sm:min-h-11"
          >
            <MessageSquare className="size-3.5" />
            Comments
            {activeComments.length > 0 ? (
              <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-4 text-accent-foreground">{activeComments.length}</span>
            ) : null}
          </button>
        ) : null}

        {tab === "preview" && !sourceMissing ? (
          <>
            <button type="button" data-testid="design-page-layout" aria-pressed={pageLayout} onClick={() => setPageLayout((value) => !value)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-surface aria-pressed:text-foreground max-sm:min-h-11">A4 guides</button>
            <span data-testid="design-page-count" className="text-xs text-muted-foreground" role="status">{pageLayout ? `${pageMeasurement.pages} ${pageMeasurement.pages === 1 ? "page" : "pages"}` : "A4 PDF"}</span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">Max pages <input aria-label="Maximum pages" data-testid="design-max-pages" type="number" min="1" max="100" value={maxPages ?? ""} onChange={(event) => changeMaxPages(event.target.value)} disabled={!editable} className="w-14 rounded border border-input bg-background px-1 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11" /></label>
            <Button type="button" size="sm" variant="outline" data-testid="design-export-pdf" disabled={exporting} onClick={() => void exportPdf()} className="gap-1.5 max-sm:h-11"><Download className="size-3.5" />{exporting ? "Exporting…" : "Export PDF"}</Button>
          </>
        ) : null}
      </header>

      {tab === "preview" && !drawMode && editable && !sourceMissing ? (
        <div data-testid="design-format-toolbar" role="toolbar" aria-label="Design text formatting" className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1">
          {([["bold", Bold, "Bold"], ["italic", Italic, "Italic"], ["underline", Underline, "Underline"], ["insertUnorderedList", List, "Bulleted list"], ["insertOrderedList", ListOrdered, "Numbered list"], ["undo", Undo2, "Undo"], ["redo", Redo2, "Redo"]] as const).map(([command, Icon, label]) => <button key={command} type="button" aria-label={label} title={label} onClick={() => format(command)} className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-11"><Icon className="size-4" /></button>)}
          <button type="button" aria-label="Insert link" title="Insert link" onClick={() => { const href = window.prompt("Link URL"); if (href && /^(https?:\/\/|mailto:|#)/i.test(href)) format("createLink", href); }} className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-11"><Link2 className="size-4" /></button>
        </div>
      ) : null}
      {pageLayout && maxPages !== null && pageMeasurement.pages > maxPages ? <div role="alert" data-testid="design-page-warning" className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{pageMeasurement.pages} A4 pages exceed the {maxPages}-page limit.</div> : null}
      {exportError ? <div role="alert" className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{exportError}</div> : null}

      {sourceMissing ? (
        <div
          className="flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/5 px-3 py-3"
          data-testid="design-source-missing"
          role="alert"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Linked design source is missing</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {resolvedDiskPath
                ? `Expected file: ${resolvedDiskPath}`
                : "The ordinary HTML file this design points to could not be found."}{" "}
              Relink to another self-contained HTML file inside the portable notebook root.
            </p>
          </div>
          {onRelinkSource ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="design-relink-source"
              onClick={onRelinkSource}
              className="shrink-0 gap-1.5"
            >
              <Link2 className="size-3.5" />
              Relink…
            </Button>
          ) : null}
        </div>
      ) : designLinked && resolvedDiskPath ? (
        <div
          className="flex min-w-0 items-baseline gap-1 overflow-hidden border-b border-border bg-surface/40 px-3 py-1.5 text-[11px] text-muted-foreground"
          data-testid="design-linked-source-path"
          title={resolvedDiskPath}
        >
          <span className="shrink-0">Linked source:</span>
          <span className="min-w-0 flex-1 truncate font-mono text-foreground/80 sm:hidden">
            {sourceFileName}
          </span>
          <span className="hidden min-w-0 flex-1 truncate font-mono text-foreground/80 sm:block">
            {resolvedDiskPath}
          </span>
        </div>
      ) : showLinkFromSource && isEmptyArtifact ? (
        <div
          className="flex flex-wrap items-center gap-3 border-b border-border bg-surface/50 px-3 py-3"
          data-testid="design-link-from-source-banner"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Link an existing HTML design</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Keep the ordinary self-contained <code className="font-mono">.html</code> file as
              ground truth. This empty design entry is replaced by that file, so it appears only
              once in the tree.
            </p>
          </div>
          <Button
            size="sm"
            data-testid="design-link-from-source-primary"
            onClick={onLinkFromSource}
            className="shrink-0 gap-1.5"
          >
            <Link2 className="size-3.5" />
            Link from source…
          </Button>
        </div>
      ) : null}

      {tab === "preview" && drawMode && !sourceMissing ? (
        <div
          className="flex items-center border-b border-border px-2 py-1"
          data-testid="design-draw-toolbar"
        >
          <AnnotationDrawToolbar
            layerRef={annotationLayerRef}
            activeTool={inkTool}
            activeColor={inkColor}
            activeStroke={inkStroke}
            canUndo={inkHistory.canUndo}
            canRedo={inkHistory.canRedo}
            onToolChange={setInkTool}
            onColorChange={setInkColor}
            onStrokeChange={setInkStroke}
            onExitDrawMode={() => void exitDrawMode()}
          />
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
      {sourceMissing ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          Restore the HTML file or use Relink to continue.
        </div>
      ) : tab === "source" ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="design-source-textarea">
          <CodeMirrorEditor
            testId="design-source-editor"
            value={body}
            onChange={handleSourceChange}
            readOnly={!editable}
            className="h-full w-full"
          />
        </div>
      ) : (
        <div ref={scrollRef} data-testid="design-scroll" className="relative min-h-0 min-w-0 flex-1 overflow-auto">
          <div style={{ position: "relative", width: pageLayout ? `${A4_WIDTH_PX}px` : "100%", height: `${frameHeight}px`, margin: pageLayout ? "0 auto" : undefined }}>
            <iframe
              ref={iframeRef}
              title={title.trim() || "Design page"}
              data-testid="design-page-frame"
              srcDoc={srcDoc}
              sandbox="allow-scripts"
              scrolling="no"
              style={{
                display: "block",
                width: "100%",
                height: `${frameHeight}px`,
                border: "0",
                background: "#ffffff",
                pointerEvents: drawMode ? "none" : "auto",
              }}
            />
            {pageLayout ? pageMeasurement.boundaries.map((offset, index) => <div key={index} data-testid="design-page-break" aria-hidden="true" className="pointer-events-none absolute left-0 right-0 border-t-2 border-dashed border-accent" style={{ top: `${offset}px` }}><span className="absolute right-2 top-1 rounded bg-surface px-1 text-xs text-muted-foreground">Page {index + 2}</span></div>) : null}
            <div
              className={cn(
                "absolute inset-0",
                drawMode
                  ? "z-10 [&_.annotation-layer-host]:pointer-events-auto"
                  : "pointer-events-none"
              )}
            >
              <div
                className="sticky top-0 w-full overflow-hidden"
                style={{
                  height: `${viewportHeight}px`,
                  ...(drawMode ? { touchAction: "none" } : {}),
                }}
              >
                <div className="relative h-full w-full">
                  <AnnotationLayer
                    handleRef={annotationLayerRef}
                    pagePath={pagePath}
                    mode={drawMode ? "draw" : "edit"}
                    scrollContainerRef={scrollRef}
                    viewportHeight={viewportHeight}
                    pageFrameHeight={frameHeight}
                    onSaveStatusChange={onSaveStatusChange}
                    onHistoryChange={setInkHistory}
                    inkTool={inkTool}
                    inkColor={inkColor}
                    inkStroke={inkStroke}
                  />
                </div>
              </div>
            </div>
            {!drawMode
              ? pinRects.map((rect) => {
                  const index = activeComments.findIndex((comment) => comment.id === rect.id);
                  if (index < 0) return null;
                  return (
                    <button
                      key={rect.id}
                      type="button"
                      data-testid="design-comment-pin"
                      aria-label={`Comment ${index + 1}: ${activeComments[index].text}`}
                      title={activeComments[index].text}
                      onClick={() => {
                        setCommentsOpen(true);
                        setFocusedCommentId(rect.id);
                      }}
                      className="absolute z-20 flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground shadow-sm ring-2 ring-background before:absolute before:-inset-2.5 before:content-[''] focus-visible:outline-none focus-visible:ring-ring"
                      style={{ top: `${Math.max(0, rect.top - 10)}px`, left: `${Math.max(0, rect.left + rect.width - 14)}px` }}
                    >
                      {index + 1}
                    </button>
                  );
                })
              : null}
          </div>
        </div>
      )}
      {commentsEnabled && commentsOpen ? (
        <DesignCommentsPanel
          comments={pageComments}
          focusedId={focusedCommentId}
          onFocusHandled={() => setFocusedCommentId(null)}
          onChange={commitComments}
          onAddPageComment={(rect) => openComposer(PAGE_ANCHOR, rect)}
          onClose={() => setCommentsOpen(false)}
        />
      ) : null}
      </div>
      {composer ? (
        <CommentComposer anchorRect={composer.rect} onSubmit={submitComment} onCancel={() => setComposer(null)} />
      ) : null}
    </div>
  );
}
