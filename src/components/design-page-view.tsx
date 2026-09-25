"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Menu, Pen, Eye, Code2, FolderOpen, Link2 } from "lucide-react";
import type {
  AnnotationLayerHandle,
  AnnotationStrokeSize,
  AnnotationTool,
} from "@/components/annotation-layer";
import { AnnotationDrawToolbar } from "@/components/annotation-draw-toolbar";
import type { TLDefaultColorStyle } from "tldraw";
import { buildDesignSrcDoc, isDesignFrameMessage } from "@/components/ui-render-view";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
}: DesignPageViewProps) {
  const editable = typeof onBodyChange === "function" && !sourceMissing;
  const showLinkFromSource = !designLinked && typeof onLinkFromSource === "function";
  const [tab, setTab] = React.useState<DesignTab>("preview");
  const [drawMode, setDrawMode] = React.useState(false);
  const [frameHeight, setFrameHeight] = React.useState(900);
  const [viewportHeight, setViewportHeight] = React.useState(900);
  const [body, setBody] = React.useState(bodyHtml);
  const isEmptyArtifact = !body.trim();
  const sourceFileName = resolvedDiskPath?.split(/[\\/]/).filter(Boolean).at(-1);
  const [inkTool, setInkTool] = React.useState<AnnotationTool>("draw");
  const [inkColor, setInkColor] = React.useState<TLDefaultColorStyle>("black");
  const [inkStroke, setInkStroke] = React.useState<AnnotationStrokeSize>("m");
  const [inkHistory, setInkHistory] = React.useState({ canUndo: false, canRedo: false });

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const annotationLayerRef = React.useRef<AnnotationLayerHandle | null>(null);

  const srcDoc = React.useMemo(() => buildDesignSrcDoc(body, tokenCss), [body, tokenCss]);

  React.useEffect(() => {
    setDrawMode(false);
    setTab("preview");
    setBody(bodyHtml);
    setInkTool("draw");
    setInkColor("black");
    setInkStroke("m");
    setInkHistory({ canUndo: false, canRedo: false });
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
      if (
        event.data.kind === "height" &&
        Number.isFinite(event.data.height) &&
        event.data.height > 0
      ) {
        const next = Math.max(event.data.height, 900);
        setFrameHeight((current) => (Math.abs(next - current) > 1 ? next : current));
      } else if (event.data.kind === "external-link") {
        window.open(event.data.href, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

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
      setTab(next);
    },
    [drawMode, tab]
  );

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
      </header>

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

      {sourceMissing ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          Restore the HTML file or use Relink to continue.
        </div>
      ) : tab === "source" ? (
        <div className="min-h-0 flex-1 overflow-hidden" data-testid="design-source-textarea">
          <CodeMirrorEditor
            testId="design-source-editor"
            value={body}
            onChange={handleSourceChange}
            readOnly={!editable}
            className="h-full w-full"
          />
        </div>
      ) : (
        <div ref={scrollRef} data-testid="design-scroll" className="relative min-h-0 flex-1 overflow-auto">
          <div style={{ position: "relative", width: "100%", height: `${frameHeight}px` }}>
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
          </div>
        </div>
      )}
    </div>
  );
}
