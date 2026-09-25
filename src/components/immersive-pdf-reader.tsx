"use client";

/**
 * Immersive PDF attachment reader (SN-135, SN-148) with annotation (SN-136).
 *
 * A full-viewport reading surface for PDF attachments, replacing the old
 * desktop-only side pane and mobile-hidden preview. Built on EmbedPDF
 * (PDFium/WASM). The WASM binary is self-hosted from `/pdfium.wasm` and font
 * fallback is disabled so the reader makes no external network requests — the
 * vault is a local-first, offline-capable app.
 *
 * Chrome is a single collapsible top bar (no nested/permanent toolbar stack).
 * Tapping the document toggles the chrome; a minimal back affordance always
 * remains so the reader can be dismissed. Last-read page and view preference
 * are remembered per attachment via {@link readPdfReaderPrefs}. Night mode
 * (SN-225) inverts EmbedPDF page render/tile bitmaps only; annotation, search,
 * and selection overlays stay true-color. The choice is global reader prefs
 * (not per attachment) and follows Settings theme until the owner toggles it.
 *
 * ## Loading architecture (SN-148)
 *
 * PDFium WASM engine init and the PDF fetch run in parallel. Engine loading
 * uses `worker: false` (main thread) because the worker engine relies on a
 * blob-URL Web Worker that loads the WASM from a relative URL — in a blob:
 * origin context the relative fetch resolves against `about:blank`, not the
 * app origin, causing a silent 404.  Main-thread cost is an explicit residual
 * risk; re-opening the same tab reuses the already-loaded engine instance.
 *
 * Progressive / range-aware first-page paint is not available with the
 * EmbedPDF engine path we ship: `openDocumentUrl` still ends in a full
 * `arrayBuffer()` before PDFium can open the document, and the document
 * manager is fed a complete buffer. Vault `/vault/*` responses do advertise
 * `Accept-Ranges` for future engines; until then first-open latency is
 * dominated by full download + parse. Re-open latency is improved via cache.
 *
 * Download progress is tracked via the Fetch `ReadableStream` API so the
 * loading UI can show byte-level progress when Content-Length is provided.
 * After download, a third "Opening document" phase covers PDFium parse until
 * the first page is ready.
 *
 * ## Annotation (SN-136)
 *
 * Annotation uses `@embedpdf/plugin-annotation` only — no Tldraw/canvas layer
 * over PDFs. An Annotate toggle in the reader chrome switches from read/pan to
 * ink + highlight tools plus an Eraser for strokes. Creating a highlight stays
 * quiet (no auto-selected dish); re-tapping an existing highlight opens the
 * comment/delete dish. Ink is removed on contact with Eraser — not
 * select-then-delete. Persistence is a vault sidecar beside the PDF asset via
 * exportAnnotations()/importAnnotations(); `autoCommit` is off so the original
 * PDF bytes are never mutated.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  ExternalLink,
  ChevronDown,
  Hand,
  Highlighter,
  ListTree,
  BookOpen,
  Loader2,
  Maximize2,
  Minus,
  Pencil,
  Plus,
  Search as SearchIcon,
  Sparkles,
  Trash2,
  Moon,
  MoreHorizontal,
  Presentation,
  Redo2,
  Undo2,
  X as XIcon,
} from "lucide-react";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { usePdfiumEngine } from "@embedpdf/engines/react";
import { EmbedPDF } from "@embedpdf/core/react";
import { useDocumentState } from "@embedpdf/core/react";
import { createPluginRegistration } from "@embedpdf/core";
import {
  DocumentManagerPluginPackage,
  useActiveDocument,
} from "@embedpdf/plugin-document-manager/react";
import {
  ViewportPluginPackage,
  Viewport,
  useViewportCapability,
  useViewportPlugin,
} from "@embedpdf/plugin-viewport/react";
import {
  ScrollPluginPackage,
  ScrollStrategy,
  useScroll,
  useScrollCapability,
  useScrollPlugin,
  type ScrollerLayout,
} from "@embedpdf/plugin-scroll/react";
import {
  RenderPluginPackage,
  RenderLayer,
  useRenderCapability,
} from "@embedpdf/plugin-render/react";
import {
  TilingPluginPackage,
  TilingLayer,
  useTilingCapability,
} from "@embedpdf/plugin-tiling/react";
import {
  ZoomPluginPackage,
  ZoomMode,
  ZoomGestureWrapper,
  useZoom,
} from "@embedpdf/plugin-zoom/react";
import { SearchPluginPackage, SearchLayer, useSearch } from "@embedpdf/plugin-search/react";
import {
  InteractionManagerPluginPackage,
  PagePointerProvider,
  useInteractionManagerCapability,
} from "@embedpdf/plugin-interaction-manager/react";
import {
  SelectionPluginPackage,
  SelectionLayer,
  useSelectionCapability,
} from "@embedpdf/plugin-selection/react";
import {
  HistoryPluginPackage,
  useHistoryCapability,
} from "@embedpdf/plugin-history/react";
import {
  AnnotationLayer,
  AnnotationPluginPackage,
  useAnnotation,
} from "@embedpdf/plugin-annotation/react";
import {
  BookmarkPluginPackage,
  useBookmarkCapability,
} from "@embedpdf/plugin-bookmark/react";
import {
  SpreadMode,
  SpreadPluginPackage,
  useSpread,
} from "@embedpdf/plugin-spread/react";

import {
  clampReaderPage,
  parseJumpPage,
  parseZoomPercent,
  readPdfReaderPrefs,
  resolvePdfReaderNightMode,
  writePdfReaderNightModePref,
  writePdfReaderPrefs,
  type PdfReaderPrefs,
  type PdfReaderZoom,
} from "@/lib/pdf-reader-prefs";
import { useTheme } from "@/components/theme-provider";
import { fmtBytes } from "@/lib/pdf-fetch-utils";
import { prefetchPdfiumWasm } from "@/lib/pdf-engine-prefetch";
import {
  resolvePdfTapTurn,
  shouldPreservePdfFingerNavigation,
} from "@/lib/pdf-reader-interaction";
import {
  fetchPdfWithVaultCache,
  type PdfVaultFetchSource,
} from "@/lib/pdf-vault-cache";
import {
  createPdfFontFallbackConfig,
  preloadPdfFonts,
} from "@/lib/pdf-font-fallback";
import {
  filterUserAuthoredAnnotationItems,
  vaultHrefToPdfPath,
} from "@/lib/pdf-annotations";
import {
  fetchPdfAnnotations,
  savePdfAnnotations,
} from "@/lib/api/pdf-annotations";
import {
  createPdfRenderOpenId,
  logPdfRenderEvent,
} from "@/lib/pdf-render-debug";
import { buildPdfOutline, type OutlineEntry } from "@/lib/pdf-outline";
import {
  resolvePdfReaderEscapeAction,
  usePdfPerformanceMode,
  controlsVisibleAfterPerformanceChange,
} from "@/lib/use-pdf-performance-mode";

const WASM_URL = "/pdfium.wasm";
const SAVE_DEBOUNCE_MS = 450;
/** Stable across renders so usePdfiumEngine does not recreate the engine. */
const PDF_FONT_FALLBACK = createPdfFontFallbackConfig();

/**
 * Session-scoped PDFium engine. EmbedPDF's usePdfiumEngine destroys WASM on
 * every unmount; recreating it on each open of a large book costs many seconds.
 * Keep one engine for the tab lifetime and only close documents on reader exit.
 */
type PdfiumEngine = NonNullable<ReturnType<typeof usePdfiumEngine>["engine"]>;
let retainedPdfiumEngine: PdfiumEngine | null = null;
let retainedPdfiumPromise: Promise<PdfiumEngine> | null = null;
let retainedPdfiumError: Error | null = null;

async function getRetainedPdfiumEngine(): Promise<PdfiumEngine> {
  if (retainedPdfiumEngine) return retainedPdfiumEngine;
  if (retainedPdfiumPromise) return retainedPdfiumPromise;
  retainedPdfiumPromise = (async () => {
    const { createPdfiumEngine } = await import(
      "@embedpdf/engines/pdfium-direct-engine"
    );
    const engine = (await createPdfiumEngine(WASM_URL, {
      fontFallback: PDF_FONT_FALLBACK,
    })) as PdfiumEngine;
    retainedPdfiumEngine = engine;
    return engine;
  })().catch((error: unknown) => {
    retainedPdfiumPromise = null;
    retainedPdfiumError =
      error instanceof Error ? error : new Error("PDFium engine failed");
    throw retainedPdfiumError;
  });
  return retainedPdfiumPromise;
}

/** Annotate-mode tools. Pan is the safe default; Eraser deletes EmbedPDF ink. */
type ReaderTool = "pan" | "ink" | "highlight" | "eraser";

const READER_TOOLS: ReaderTool[] = ["pan", "ink", "highlight", "eraser"];
const TOOL_META: Record<
  ReaderTool,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pan: { label: "Pan", icon: Hand },
  ink: { label: "Ink", icon: Pencil },
  highlight: { label: "Highlight", icon: Highlighter },
  eraser: { label: "Eraser", icon: Eraser },
};

/** Finger/stylus-friendly hit radius in unscaled PDF points. */
const INK_ERASER_RADIUS_PT = 14;

type InkPoint = { x: number; y: number };
type InkStroke = { points?: InkPoint[] };
type ErasableInkObject = {
  id: string;
  type: number;
  pageIndex: number;
  rect?: {
    origin: { x: number; y: number };
    size: { width: number; height: number };
  };
  inkList?: InkStroke[];
};

function distanceToSegmentSquared(
  point: InkPoint,
  start: InkPoint,
  end: InkPoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy)
    )
  );
  const nearestX = start.x + t * dx;
  const nearestY = start.y + t * dy;
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2;
}

function pointNearInk(
  pdfX: number,
  pdfY: number,
  obj: ErasableInkObject,
  radius: number
): boolean {
  if (obj.type !== PdfAnnotationSubtype.INK) return false;
  const target = { x: pdfX, y: pdfY };
  const radiusSquared = radius * radius;
  const strokes = obj.inkList;
  if (Array.isArray(strokes) && strokes.length > 0) {
    for (const stroke of strokes) {
      const points = stroke?.points;
      if (!Array.isArray(points) || points.length === 0) continue;
      if (points.length === 1) {
        if (distanceToSegmentSquared(target, points[0], points[0]) <= radiusSquared) {
          return true;
        }
        continue;
      }
      for (let index = 1; index < points.length; index += 1) {
        if (
          distanceToSegmentSquared(target, points[index - 1], points[index]) <=
          radiusSquared
        ) {
          return true;
        }
      }
    }
    return false;
  }
  const rect = obj.rect;
  if (!rect) return false;
  return (
    pdfX >= rect.origin.x - radius &&
    pdfX <= rect.origin.x + rect.size.width + radius &&
    pdfY >= rect.origin.y - radius &&
    pdfY <= rect.origin.y + rect.size.height + radius
  );
}

function usePdfiumEngineWhenFontsReady() {
  const [fontsReady, setFontsReady] = React.useState(false);
  const [fontError, setFontError] = React.useState<Error | null>(null);
  const [engine, setEngine] = React.useState<PdfiumEngine | null>(
    retainedPdfiumEngine
  );
  const [engineLoading, setEngineLoading] = React.useState(!retainedPdfiumEngine);
  const [engineError, setEngineError] = React.useState<Error | null>(
    retainedPdfiumError
  );

  React.useEffect(() => {
    let cancelled = false;
    void preloadPdfFonts()
      .then(() => {
        if (!cancelled) setFontsReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFontError(
            error instanceof Error ? error : new Error("PDF font preload failed")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!fontsReady) return;
    if (retainedPdfiumEngine) {
      setEngine(retainedPdfiumEngine);
      setEngineLoading(false);
      return;
    }
    let cancelled = false;
    setEngineLoading(true);
    void getRetainedPdfiumEngine()
      .then((pdfEngine) => {
        if (cancelled) return;
        setEngine(pdfEngine);
        setEngineLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEngineError(
          error instanceof Error ? error : new Error("PDFium engine failed")
        );
        setEngineLoading(false);
      });
    return () => {
      cancelled = true;
      // Intentionally do not destroy retainedPdfiumEngine — recreating WASM on
      // every reader open is the multi-second reopen cost (SN-151).
    };
  }, [fontsReady]);

  return {
    engine: fontsReady ? engine : null,
    fontsReady,
    fontError,
    isLoading: !fontsReady || engineLoading,
    error: fontError ?? engineError,
  };
}

// ── Download progress state ────────────────────────────────────────────────

/**
 * Tracks the state of the streaming PDF fetch so the loading UI can show
 * per-phase status. `total` is `null` when the server did not send a
 * Content-Length header; in that case we show bytes-received only.
 */
export type DownloadPhase = "idle" | "checking" | "downloading" | "done" | "error";

export interface DownloadProgress {
  phase: DownloadPhase;
  /** Bytes received so far. */
  loaded: number;
  /** Total bytes if Content-Length was present, otherwise null. */
  total: number | null;
  /** True when bytes came from Cache Storage (no network transfer). */
  fromCache?: boolean;
  /** Selected source, reported before byte progress begins. */
  source?: PdfVaultFetchSource;
}

const INITIAL_DOWNLOAD: DownloadProgress = { phase: "idle", loaded: 0, total: null };

export interface ImmersivePdfReaderProps {
  /** The `/vault/...` href of the PDF attachment. */
  href: string;
  /** Display name of the attachment. */
  fileName: string;
  /** Called when the reader is dismissed (back / close / Escape). */
  onClose: () => void;
  /** False keeps one loaded document session warm but removes it from the UI. */
  open?: boolean;
  /** Whether the AI companion overlay is open (shell-owned). */
  companionOpen?: boolean;
  /** SN-211: closed-panel companion answer-ready highlight (shell-owned). */
  companionAnswerReady?: boolean;
  /** SN-211: closed-panel companion working affordance (shell-owned). */
  companionWorking?: boolean;
  /** Toggle the AI companion while the reader stays open. */
  onToggleCompanion?: () => void;
  /** Reports the live 1-based page and loaded document page count. */
  onPageChange?: (page: number, pageCount?: number) => void;
}

/** Phone / tablet: prefer cheaper WASM paint (DPR 1, smaller tiles, buffer 1). */
function isCoarsePointerClient(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.matchMedia("(pointer: coarse)").matches ||
      (navigator.maxTouchPoints ?? 0) > 0
    );
  } catch {
    return false;
  }
}

// Cap the render DPR. DPR 2–3 full-page bitmaps are a known gray-frame / minutes-
// long paint failure mode on large books (SN-151); cap harder on touch.
function pdfPaintDpr(): number {
  // Cap at 1 for all devices — desktop DPR 2 on a 1920px pane doubles WASM
  // tile cost and was part of the minutes-long paint path (SN-151).
  return 1;
}

function prefZoomToLevel(zoom: PdfReaderZoom): ZoomMode | number {
  if (typeof zoom === "number") return zoom;
  if (zoom === "fit-page") return ZoomMode.FitPage;
  if (zoom === "automatic") return ZoomMode.Automatic;
  return ZoomMode.FitWidth;
}

/**
 * Always open at 100%. Live diag (desktop 1920px): FitWidth resolved to
 * zoom 3.769 (~377%) and queued 9 tiles with ready:0 for ~60s — worse than the
 * remembered 199% path. Native readers open near 100%/fit-page; EmbedPDF WASM
 * cannot absorb a 3–4× tile storm on a 622-page book.
 */
const SAFE_OPEN_ZOOM = 1;
/** Cap post-paint restore so a prior pinch cannot re-freeze the tab. */
const MAX_RESTORE_ZOOM = 1.5;

function openZoomLevel(_zoom: PdfReaderZoom): number {
  return SAFE_OPEN_ZOOM;
}

/** Zoom to apply once after first paint, or null to stay at SAFE_OPEN_ZOOM. */
function deferredRestoreZoom(zoom: PdfReaderZoom): ZoomMode | number | null {
  const level = prefZoomToLevel(zoom);
  if (typeof level === "number" && Number.isFinite(level) && level > 0) {
    const capped = Math.min(level, MAX_RESTORE_ZOOM);
    return Math.abs(capped - SAFE_OPEN_ZOOM) > 0.01 ? capped : null;
  }
  // Named Fit* modes: safe on narrow/touch (≈1×). On wide desktop FitWidth is
  // the 377% freeze — skip restore and leave 100%.
  if (isCoarsePointerClient()) return level;
  return null;
}

function levelToPrefZoom(level: unknown): PdfReaderZoom {
  if (typeof level === "number" && Number.isFinite(level) && level > 0) return level;
  if (level === ZoomMode.FitPage) return "fit-page";
  if (level === ZoomMode.Automatic) return "automatic";
  return "fit-width";
}

function displayName(fileName: string, href: string): string {
  if (fileName) return fileName;
  try {
    return decodeURIComponent(href.split("/").pop()?.split("?")[0] ?? "PDF");
  } catch {
    return "PDF";
  }
}

export default function ImmersivePdfReader({
  href,
  fileName,
  onClose,
  open = true,
  companionOpen = false,
  companionAnswerReady = false,
  companionWorking = false,
  onToggleCompanion,
  onPageChange,
}: ImmersivePdfReaderProps): React.ReactElement | null {
  const { engine, isLoading, error, fontsReady } = usePdfiumEngineWhenFontsReady();
  // Run PDFium on the main thread (SN-148). Worker blob: origin cannot fetch
  // /pdfium.wasm. Fonts are preloaded then handed via fontLoader (sync XHR to
  // /pdf-fonts was unreliable). StrictMode stays off in next.config (DocNotOpen).

  const [mounted, setMounted] = React.useState(false);
  const [pdfBuffer, setPdfBuffer] = React.useState<ArrayBuffer | null>(null);
  const [pdfFetchError, setPdfFetchError] = React.useState<Error | null>(null);
  const [downloadProgress, setDownloadProgress] = React.useState<DownloadProgress>(INITIAL_DOWNLOAD);
  React.useEffect(() => {
    setMounted(true);
    prefetchPdfiumWasm();
  }, []);

  // Master copy kept intact — PDFium may detach buffers it opens. Child session
  // always slices from this master so remounts still have bytes.
  const masterBuffer = React.useMemo(() => {
    if (!pdfBuffer || pdfBuffer.byteLength === 0) return null;
    return pdfBuffer.slice(0);
  }, [pdfBuffer]);

  // usePdfiumEngine StrictMode destroys engine A then creates B without clearing
  // React state in between. Key the session on the engine instance so EmbedPDF
  // re-inits against a live engine with a fresh buffer.slice(0).
  const engineEpochRef = React.useRef(0);
  const prevEngineRef = React.useRef<typeof engine>(null);
  if (engine && engine !== prevEngineRef.current) {
    engineEpochRef.current += 1;
    prevEngineRef.current = engine;
  }
  const engineEpoch = engineEpochRef.current;

  // Read remembered state once, at open time.
  const initialPrefs = React.useMemo<PdfReaderPrefs>(
    () => readPdfReaderPrefs(href),
    [href]
  );

  // Lock body scroll only while the retained reader is visible.
  React.useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const title = displayName(fileName, href);
  const pdfFetchLoading =
    downloadProgress.phase === "idle" ||
    downloadProgress.phase === "checking" ||
    downloadProgress.phase === "downloading";
  const readerReady = Boolean(
    engine && masterBuffer && !isLoading && !error && !pdfFetchError && !pdfFetchLoading
  );

  // Escape closes while loading/error; ReaderSurface owns Escape once ready so
  // Annotate mode can intercept it first.
  React.useEffect(() => {
    if (!open || readerReady) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, readerReady, onClose]);

  React.useEffect(() => {
    const controller = new AbortController();
    const openId = createPdfRenderOpenId();
    const fetchStarted = performance.now();
    setPdfBuffer(null);
    setPdfFetchError(null);
    setDownloadProgress(INITIAL_DOWNLOAD);
    logPdfRenderEvent(openId, "fetch-start", { href });

    void (async () => {
      try {
        setDownloadProgress({ phase: "checking", loaded: 0, total: null });
        const result = await fetchPdfWithVaultCache(href, {
          signal: controller.signal,
          onSource: (source) => {
            if (controller.signal.aborted) return;
            setDownloadProgress({
              phase: source === "network" ? "downloading" : "checking",
              loaded: 0,
              total: null,
              fromCache: source !== "network",
              source,
            });
          },
          onProgress: (loaded, total) => {
            if (controller.signal.aborted) return;
            setDownloadProgress((current) => ({
              phase: current.source === "network" ? "downloading" : "checking",
              loaded,
              total,
              fromCache: current.source !== "network",
              source: current.source,
            }));
          },
        });
        if (controller.signal.aborted) return;
        logPdfRenderEvent(openId, "fetch-done", {
          source: result.source,
          bytes: result.byteLength,
          durationMs: Math.round(performance.now() - fetchStarted),
        });
        setPdfBuffer(result.buffer);
        setDownloadProgress({
          phase: "done",
          loaded: result.byteLength,
          total: result.byteLength,
          fromCache: result.source === "cache" || result.source === "session",
          source: result.source,
        });
      } catch (fetchError: unknown) {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }
        if (controller.signal.aborted) return;
        const err =
          fetchError instanceof Error
            ? fetchError
            : new Error("PDF request failed");
        logPdfRenderEvent(openId, "fetch-failed", {
          message: err.message,
          durationMs: Math.round(performance.now() - fetchStarted),
        });
        setPdfFetchError(err);
        setDownloadProgress((prev) => ({ ...prev, phase: "error" }));
      }
    })();

    return () => controller.abort();
  }, [href]);

  React.useEffect(() => {
    if (fontsReady) {
      logPdfRenderEvent("pdf-engine", "fonts-ready", {});
    }
  }, [fontsReady]);

  React.useEffect(() => {
    if (engine && !isLoading) {
      logPdfRenderEvent("pdf-engine", "engine-ready", {});
    }
  }, [engine, isLoading]);

  const readerRootRef = React.useRef<HTMLDivElement>(null);
  const performanceMode = usePdfPerformanceMode(readerRootRef, open);
  const closeReader = React.useCallback(() => {
    performanceMode.disable();
    onClose();
  }, [onClose, performanceMode.disable]);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);
  React.useEffect(() => {
    const root = readerRootRef.current;
    if (!root) return;
    if (open) {
      root.removeAttribute("inert");
      if (!wasOpenRef.current) {
        const activeElement = document.activeElement;
        restoreFocusRef.current =
          activeElement instanceof HTMLElement && !root.contains(activeElement)
            ? activeElement
            : null;
      }
    } else {
      root.setAttribute("inert", "");
      if (wasOpenRef.current) restoreFocusRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, mounted]);

  if (!mounted || typeof document === "undefined") return null;

  const engineReady = !isLoading && !!engine;

  const surface = (
    <div
      ref={readerRootRef}
      className="pdf-reader"
      role={open ? "dialog" : undefined}
      aria-modal={open ? "true" : undefined}
      aria-hidden={open ? undefined : true}
      aria-label={`PDF reader: ${title}`}
      data-testid="pdf-reader"
      data-reader-state={open ? "open" : "retained"}
      style={
        open
          ? undefined
          : { visibility: "hidden", pointerEvents: "none" }
      }
    >
      {error || pdfFetchError ? (
        <ReaderMessage
          title={title}
          onClose={closeReader}
          href={href}
          message="This PDF could not be opened."
          detail={(error ?? pdfFetchError)?.message}
        />
      ) : isLoading || !engine || pdfFetchLoading || !masterBuffer ? (
        <ReaderLoading
          title={title}
          onClose={closeReader}
          engineReady={engineReady}
          downloadProgress={downloadProgress}
          openingDocument={false}
        />
      ) : (
        <PdfEmbedSession
          key={`${href}:${engineEpoch}`}
          engine={engine}
          masterBuffer={masterBuffer}
          href={href}
          title={title}
          initialPrefs={initialPrefs}
          onClose={closeReader}
          downloadProgress={downloadProgress}
          active={open}
          companionOpen={open && companionOpen}
          companionAnswerReady={open && companionAnswerReady}
          companionWorking={open && companionWorking}
          onToggleCompanion={onToggleCompanion}
          onPageChange={onPageChange}
          performanceMode={performanceMode.enabled}
          onPerformanceModeChange={performanceMode.setEnabled}
        />
      )}
    </div>
  );

  return createPortal(surface, document.body);
}

/**
 * Owns EmbedPDF plugin registration. Mounted as its own component so React
 * StrictMode remounts recalculate plugins with a fresh buffer.slice(0) from
 * the intact master copy (PDFium may detach the ArrayBuffer it opens).
 */
function PdfEmbedSession({
  engine,
  masterBuffer,
  href,
  title,
  initialPrefs,
  onClose,
  downloadProgress,
  active,
  companionOpen,
  companionAnswerReady,
  companionWorking,
  onToggleCompanion,
  onPageChange,
  performanceMode,
  onPerformanceModeChange,
}: {
  engine: NonNullable<ReturnType<typeof usePdfiumEngine>["engine"]>;
  masterBuffer: ArrayBuffer;
  href: string;
  title: string;
  initialPrefs: PdfReaderPrefs;
  onClose: () => void;
  downloadProgress: DownloadProgress;
  active: boolean;
  companionOpen?: boolean;
  companionAnswerReady?: boolean;
  companionWorking?: boolean;
  onToggleCompanion?: () => void;
  onPageChange?: (page: number, pageCount?: number) => void;
  performanceMode: boolean;
  onPerformanceModeChange: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const plugins = React.useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [
          {
            buffer: masterBuffer.slice(0),
            documentId: href,
            name: title,
            autoActivate: true,
          },
        ],
      }),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(ScrollPluginPackage, {
        defaultStrategy: ScrollStrategy.Vertical,
        // One offscreen page max — desktop buffer 2 + high remembered zoom
        // saturated WASM (~60s to first ready tile on the 622-page book).
        defaultBufferSize: 1,
      }),
      createPluginRegistration(SpreadPluginPackage, {
        defaultSpreadMode: SpreadMode.None,
      }),
      createPluginRegistration(RenderPluginPackage),
      // Base RenderLayer at scale 1 + TilingLayer: full-page high-DPR renders
      // fail silently on large mobile PDFs (gray frames, correct page count).
      createPluginRegistration(TilingPluginPackage, {
        tileSize: isCoarsePointerClient() ? 512 : 768,
        overlapPx: 5,
        extraRings: 0,
      }),
      createPluginRegistration(ZoomPluginPackage, {
        // Always 100% — never FitWidth/high numeric as the plugin default.
        defaultZoomLevel: openZoomLevel(initialPrefs.zoom),
        minZoom: 0.25,
        maxZoom: 10,
      }),
      createPluginRegistration(SearchPluginPackage),
      // Document outline / chapter navigation (SN-142). Read-only: exposes the
      // PDF's built-in bookmark tree; the reader hides all outline chrome when
      // the document has no outline.
      createPluginRegistration(BookmarkPluginPackage),
      // Annotation stack (SN-136). InteractionManager + Selection back the
      // ink/highlight tools; History enables undo. autoCommit off = sidecar
      // only, PDF bytes never mutated.
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage),
      createPluginRegistration(HistoryPluginPackage),
      createPluginRegistration(AnnotationPluginPackage, {
        annotationAuthor: "Smart Notes",
        autoCommit: false,
        // Creating a highlight/ink must stay quiet — no auto-selected
        // chrome. Comment/delete appear only when the user later taps an
        // existing highlight. Ink is removed with the Eraser tool.
        selectAfterCreate: false,
        deactivateToolAfterCreate: false,
      }),
    ],
    [href, title, initialPrefs.zoom, masterBuffer]
  );

  return (
    <EmbedPDF engine={engine} plugins={plugins}>
      <DocumentGate
        documentId={href}
        title={title}
        href={href}
        initialPrefs={initialPrefs}
        onClose={onClose}
        downloadProgress={downloadProgress}
        active={active}
        companionOpen={companionOpen}
        companionAnswerReady={companionAnswerReady}
        companionWorking={companionWorking}
        onToggleCompanion={onToggleCompanion}
        onPageChange={onPageChange}
        performanceMode={performanceMode}
        onPerformanceModeChange={onPerformanceModeChange}
      />
    </EmbedPDF>
  );
}

function DocumentGate({
  documentId,
  title,
  href,
  initialPrefs,
  onClose,
  downloadProgress,
  active,
  companionOpen,
  companionAnswerReady,
  companionWorking,
  onToggleCompanion,
  onPageChange,
  performanceMode,
  onPerformanceModeChange,
}: {
  documentId: string;
  title: string;
  href: string;
  initialPrefs: PdfReaderPrefs;
  onClose: () => void;
  downloadProgress: DownloadProgress;
  active: boolean;
  companionOpen?: boolean;
  companionAnswerReady?: boolean;
  companionWorking?: boolean;
  onToggleCompanion?: () => void;
  onPageChange?: (page: number, pageCount?: number) => void;
  performanceMode: boolean;
  onPerformanceModeChange: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const documentState = useDocumentState(documentId);
  const status = documentState?.status;
  const isError = status === "error";
  const isLoaded = status === "loaded";

  if (isError) {
    return (
      <ReaderMessage
        title={title}
        onClose={onClose}
        href={href}
        message="This PDF could not be opened."
        detail="Document failed to open"
      />
    );
  }

  if (!isLoaded) {
    return (
      <ReaderLoading
        title={title}
        onClose={onClose}
        engineReady={true}
        downloadProgress={downloadProgress}
        openingDocument={true}
      />
    );
  }

  return (
    <ReaderSurface
      documentId={documentId}
      title={title}
      href={href}
      initialPrefs={initialPrefs}
      onClose={onClose}
      active={active}
      companionOpen={companionOpen}
      companionAnswerReady={companionAnswerReady}
      companionWorking={companionWorking}
      onToggleCompanion={onToggleCompanion}
      onPageChange={onPageChange}
      performanceMode={performanceMode}
      onPerformanceModeChange={onPerformanceModeChange}
    />
  );
}

function ReaderLoading({
  title,
  onClose,
  engineReady,
  downloadProgress,
  openingDocument,
}: {
  title: string;
  onClose: () => void;
  engineReady: boolean;
  downloadProgress: DownloadProgress;
  /** True while PDFium is parsing the assembled buffer. */
  openingDocument: boolean;
}) {
  const { phase, loaded, total, source } = downloadProgress;
  const localResume = source === "cache" || source === "session";

  // Human-readable download detail line.
  const downloadDetail = React.useMemo<string>(() => {
    if (phase === "idle" || (phase === "checking" && !source)) {
      return "Checking device storage…";
    }
    if (phase === "done") {
      if (source === "session") return "Open session ready";
      if (source === "cache") return "Device cache ready";
      return "Complete";
    }
    if (phase === "error") return "Failed";
    if (source !== "network") return "Reading local copy…";
    // downloading
    if (total && total > 0) {
      const pct = Math.round((loaded / total) * 100);
      return `${pct}% · ${fmtBytes(loaded)} / ${fmtBytes(total)}`;
    }
    if (loaded > 0) return fmtBytes(loaded);
    return "Connecting…";
  }, [phase, loaded, total, source]);

  const downloadPercent =
    phase === "downloading" && total && total > 0
      ? Math.round((loaded / total) * 100)
      : null;

  const downloadPhaseActive = phase === "downloading" || phase === "checking";
  const downloadDone = phase === "done";
  const openPhaseActive = openingDocument;
  const openPhasePending = downloadDone && engineReady && !openingDocument;

  return (
    <>
      <BackButton onClose={onClose} />
      <div className="pdf-reader__status" data-testid="pdf-reader-loading">
        <p className="pdf-reader__status-title">
          {localResume ? "Resuming document" : "Opening document"}
        </p>
        <p className="pdf-reader__status-detail" title={title}>
          {title}
        </p>

        {/* Phase list — engine and download run in parallel; open follows */}
        <ul className="pdf-reader__phase-list" aria-label="Loading progress">
          {/* Engine phase */}
          <li className="pdf-reader__phase">
            <span className="pdf-reader__phase-icon" aria-hidden="true">
              {engineReady ? (
                <Check className="pdf-reader__phase-check" />
              ) : (
                <Loader2 className="pdf-reader__phase-spinner" />
              )}
            </span>
            <span className="pdf-reader__phase-label">PDF engine</span>
            {engineReady ? (
              <span className="pdf-reader__phase-detail">Ready</span>
            ) : null}
          </li>

          {/* Download phase */}
          <li className="pdf-reader__phase">
            <span className="pdf-reader__phase-icon" aria-hidden="true">
              {downloadDone ? (
                <Check className="pdf-reader__phase-check" />
              ) : downloadPhaseActive ? (
                <Loader2 className="pdf-reader__phase-spinner" />
              ) : (
                <span className="pdf-reader__phase-dot" aria-hidden="true" />
              )}
            </span>
            <span className="pdf-reader__phase-label">
              {source === "session"
                ? "Open session"
                : source === "cache"
                  ? "Device cache"
                  : source === "network"
                    ? "Downloading"
                    : "Checking local copy"}
            </span>
            {downloadDetail ? (
              <span
                className="pdf-reader__phase-detail"
                aria-live="polite"
                aria-atomic="true"
              >
                {downloadDetail}
              </span>
            ) : null}
          </li>

          {/* Parse / open phase */}
          <li className="pdf-reader__phase" data-testid="pdf-reader-phase-open">
            <span className="pdf-reader__phase-icon" aria-hidden="true">
              {openPhaseActive ? (
                <Loader2 className="pdf-reader__phase-spinner" />
              ) : openPhasePending || (!downloadDone && !engineReady) ? (
                <span className="pdf-reader__phase-dot" aria-hidden="true" />
              ) : (
                <span className="pdf-reader__phase-dot" aria-hidden="true" />
              )}
            </span>
            <span className="pdf-reader__phase-label">Opening document</span>
            {openPhaseActive ? (
              <span className="pdf-reader__phase-detail">Parsing…</span>
            ) : null}
          </li>
        </ul>

        {/* Byte progress bar — only when Content-Length is known */}
        {downloadPercent !== null ? (
          <div
            className="pdf-reader__progress"
            role="progressbar"
            aria-valuenow={downloadPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Downloading: ${downloadPercent}%`}
          >
            <div
              className="pdf-reader__progress-bar"
              style={{ width: `${downloadPercent}%` }}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function ReaderMessage({
  title,
  message,
  detail,
  href,
  onClose,
}: {
  title: string;
  message: string;
  detail?: string;
  href: string;
  onClose: () => void;
}) {
  return (
    <>
      <BackButton onClose={onClose} />
      <div className="pdf-reader__status" data-testid="pdf-reader-error">
        <p className="pdf-reader__status-title">{message}</p>
        <p className="pdf-reader__status-detail">{title}</p>
        {detail ? <p className="pdf-reader__status-detail">{detail}</p> : null}
        <a
          className="pdf-reader__external-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Open in new tab
        </a>
      </div>
    </>
  );
}

function BackButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="pdf-reader__back"
      data-testid="pdf-reader-back"
      aria-label="Close PDF reader"
      onClick={onClose}
    >
      <ArrowLeft className="size-5" aria-hidden="true" />
    </button>
  );
}

interface ReaderSurfaceProps {
  documentId: string;
  title: string;
  href: string;
  initialPrefs: PdfReaderPrefs;
  onClose: () => void;
  active: boolean;
  companionOpen?: boolean;
  companionAnswerReady?: boolean;
  companionWorking?: boolean;
  onToggleCompanion?: () => void;
  onPageChange?: (page: number, pageCount?: number) => void;
  performanceMode: boolean;
  onPerformanceModeChange: React.Dispatch<React.SetStateAction<boolean>>;
}

function HighlightCommentMenu({
  annotationId,
  content,
  editing,
  canEdit,
  onEdit,
  onSave,
  onDelete,
  onClose,
}: {
  annotationId: string;
  content: string;
  editing: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onSave: (content: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = React.useState(content);
  const inputId = `hl-note-${annotationId}`;

  React.useEffect(() => setDraft(content), [content]);

  if (!editing) {
    return (
      <div className="pdf-reader__anno-comment" data-testid="pdf-reader-highlight-comment">
        <div className="pdf-reader__anno-menu-header">
          <span>Comment</span>
          <div className="pdf-reader__anno-menu-actions">
            {canEdit ? (
              <button
                type="button"
                className="pdf-reader__anno-action"
                data-testid="pdf-reader-anno-edit"
                onClick={onEdit}
              >
                Edit
              </button>
            ) : null}
            <button
              type="button"
              className="pdf-reader__anno-icon-action"
              data-testid="pdf-reader-anno-close"
              aria-label="Close highlight comment"
              onClick={onClose}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="pdf-reader__anno-comment-text">{content}</p>
      </div>
    );
  }

  return (
    <div className="pdf-reader__anno-comment">
      <div className="pdf-reader__anno-menu-header">
        <span>Highlight</span>
        <div className="pdf-reader__anno-menu-actions">
          <button
            type="button"
            className="pdf-reader__anno-icon-action pdf-reader__anno-icon-action--danger"
            data-testid="pdf-reader-anno-delete"
            aria-label="Delete highlight"
            onClick={onDelete}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pdf-reader__anno-icon-action"
            data-testid="pdf-reader-anno-close"
            aria-label="Close highlight comment editor"
            onClick={onClose}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      {canEdit ? (
        <>
          <label className="pdf-reader__anno-note-label" htmlFor={inputId}>
            Comment
          </label>
          <textarea
            id={inputId}
            className="pdf-reader__anno-note-input"
            data-testid="pdf-reader-highlight-note-input"
            rows={3}
            value={draft}
            placeholder="Add a note to this highlight…"
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <div className="pdf-reader__anno-menu-footer">
            <button
              type="button"
              className="pdf-reader__anno-action"
              data-testid="pdf-reader-anno-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pdf-reader__anno-action pdf-reader__anno-action--primary"
              data-testid="pdf-reader-anno-save"
              onClick={() => onSave(draft)}
              disabled={draft === content}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <p className="pdf-reader__anno-comment-text">
          This highlight is read-only.
        </p>
      )}
    </div>
  );
}

type PdfPageLayout = ScrollerLayout["items"][number]["pageLayouts"][number];

/**
 * SN-151: EmbedPDF's stock Scroller relies on a ResizeObserver-driven layout
 * emission. Android (and cold desktop) can miss that first emission after a
 * fast cached document open, leaving a healthy viewport with zero page frames —
 * permanent gray, and on a large book the tab eventually trips the browser's
 * "page unresponsive" watchdog. This drop-in reads the plugin's current layout
 * immediately and seeds viewport metrics once after mount, while preserving the
 * stock component's virtualization and layout-ready contract.
 */
function ResilientScroller({
  documentId,
  renderPage,
}: {
  documentId: string;
  renderPage: (layout: PdfPageLayout) => React.ReactNode;
}) {
  const { plugin: scrollPlugin } = useScrollPlugin();
  const { plugin: viewportPlugin } = useViewportPlugin();
  const [layoutData, setLayoutData] = React.useState<{
    layout: ScrollerLayout | null;
    docId: string | null;
  }>({ layout: null, docId: null });

  React.useLayoutEffect(() => {
    if (!scrollPlugin || !documentId) return;

    const publish = (layout: ScrollerLayout) => {
      setLayoutData({ layout, docId: documentId });
    };

    const unsubscribe = scrollPlugin.onScrollerData(documentId, (layout) =>
      publish(layout)
    );

    try {
      publish(scrollPlugin.getScrollerLayout(documentId));
    } catch {
      // Layout not ready yet; the emitter subscription above will deliver it.
    }

    // Do not rely exclusively on Android ResizeObserver delivery. By the next
    // frame Viewport's child layout effect has registered this element, so seed
    // the viewport metrics and re-read the layout.
    const seedFrame = window.requestAnimationFrame(() => {
      const viewport = document.querySelector<HTMLElement>(
        ".pdf-reader__viewport"
      );
      if (!viewport || !viewportPlugin) return;
      viewportPlugin.setViewportResizeMetrics(documentId, {
        width: viewport.offsetWidth,
        height: viewport.offsetHeight,
        clientWidth: viewport.clientWidth,
        clientHeight: viewport.clientHeight,
        scrollTop: viewport.scrollTop,
        scrollLeft: viewport.scrollLeft,
        scrollWidth: viewport.scrollWidth,
        scrollHeight: viewport.scrollHeight,
        clientLeft: viewport.clientLeft,
        clientTop: viewport.clientTop,
      });
      try {
        publish(scrollPlugin.getScrollerLayout(documentId));
      } catch {
        // Still not ready; emitter will deliver.
      }
    });

    return () => {
      window.cancelAnimationFrame(seedFrame);
      unsubscribe();
      setLayoutData({ layout: null, docId: null });
      scrollPlugin.clearLayoutReady(documentId);
    };
  }, [documentId, scrollPlugin, viewportPlugin]);

  const layout = layoutData.docId === documentId ? layoutData.layout : null;
  React.useLayoutEffect(() => {
    if (!scrollPlugin || !layout) return;
    scrollPlugin.setLayoutReady(documentId);
  }, [documentId, layout, scrollPlugin]);

  if (!layout) return null;

  return (
    <div
      style={{
        width: `${layout.totalWidth}px`,
        height: `${layout.totalHeight}px`,
        position: "relative",
        boxSizing: "border-box",
        margin: "0 auto",
        ...(layout.strategy === ScrollStrategy.Horizontal
          ? { display: "flex", flexDirection: "row" as const }
          : {}),
      }}
    >
      <div
        style={
          layout.strategy === ScrollStrategy.Horizontal
            ? { width: layout.startSpacing, height: "100%", flexShrink: 0 }
            : { height: layout.startSpacing, width: "100%" }
        }
      />
      <div
        style={{
          gap: layout.pageGap,
          display: "flex",
          alignItems: "center",
          position: "relative",
          boxSizing: "border-box",
          ...(layout.strategy === ScrollStrategy.Horizontal
            ? { flexDirection: "row" as const, minHeight: "100%" }
            : { flexDirection: "column" as const, minWidth: "fit-content" }),
        }}
      >
        {layout.items.map((item) => (
          <div
            key={item.pageNumbers[0]}
            className="pdf-reader__spread-row"
            data-testid="pdf-reader-spread-row"
            data-page-count={item.pageLayouts.length}
            data-pages={item.pageNumbers.join(",")}
            style={{ display: "flex", justifyContent: "center", gap: layout.pageGap }}
          >
            {item.pageLayouts.map((pageLayout) => (
              <div
                key={pageLayout.pageNumber}
                style={{
                  width: `${pageLayout.rotatedWidth}px`,
                  height: `${pageLayout.rotatedHeight}px`,
                  position: "relative",
                  zIndex: pageLayout.elevated ? 1 : undefined,
                }}
              >
                {renderPage(pageLayout)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        style={
          layout.strategy === ScrollStrategy.Horizontal
            ? { width: layout.endSpacing, height: "100%", flexShrink: 0 }
            : { height: layout.endSpacing, width: "100%" }
        }
      />
    </div>
  );
}

function ReaderSurface({
  documentId,
  title,
  href,
  initialPrefs,
  onClose,
  active,
  companionOpen = false,
  companionAnswerReady = false,
  companionWorking = false,
  onToggleCompanion,
  onPageChange,
  performanceMode,
  onPerformanceModeChange,
}: ReaderSurfaceProps) {
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const { provides: scrollCap } = useScrollCapability();
  const { state: zoomState, provides: zoom } = useZoom(documentId);
  const { activeDocument } = useActiveDocument();
  const { provides: annotation } = useAnnotation(documentId);
  const { provides: interactionManager } = useInteractionManagerCapability();
  const { provides: selection } = useSelectionCapability();
  const { provides: history } = useHistoryCapability();
  const { plugin: viewportPlugin } = useViewportPlugin();
  const { provides: viewportCap } = useViewportCapability();
  const { provides: renderCap } = useRenderCapability();
  const { provides: tilingCap } = useTilingCapability();
  const { provides: bookmarkCap } = useBookmarkCapability();
  const { provides: spread } = useSpread(documentId);

  // Stable id correlating every render event for one open in AV diagnostics.
  const openIdRef = React.useRef<string>("");
  if (!openIdRef.current) openIdRef.current = createPdfRenderOpenId();
  const openId = openIdRef.current;

  const { theme } = useTheme();
  const [nightMode, setNightMode] = React.useState(() =>
    resolvePdfReaderNightMode(theme)
  );
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [outline, setOutline] = React.useState<OutlineEntry[]>([]);
  const [outlineOpen, setOutlineOpen] = React.useState(false);
  const [annotateMode, setAnnotateMode] = React.useState(false);
  const [spreadRequested, setSpreadRequested] = React.useState(initialPrefs.spreadMode);
  const [spreadOffset, setSpreadOffset] = React.useState(initialPrefs.spreadOffset);
  const [spreadViewportEligible, setSpreadViewportEligible] = React.useState(false);
  const [activeTool, setActiveTool] = React.useState<ReaderTool>("pan");
  const [annotationsReady, setAnnotationsReady] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved">("idle");
  const [historyState, setHistoryState] = React.useState({
    canUndo: false,
    canRedo: false,
  });

  // Performance mode starts immersive: hide the reader bar. Leaving restores
  // it. Center-page taps still toggle chrome while performance mode stays on.
  React.useEffect(() => {
    setControlsVisible(controlsVisibleAfterPerformanceChange(performanceMode));
  }, [performanceMode]);

  const pdfPath = React.useMemo(() => vaultHrefToPdfPath(href), [href]);
  const pendingItemsRef = React.useRef<unknown[] | null>(null);
  const importedRef = React.useRef(false);
  const saveTimerRef = React.useRef<number | null>(null);
  // EmbedPDF may recreate the annotation scope object on state ticks. Keep a
  // stable ref so import/save effects do not reset Annotate readiness (that
  // flash-disabled the pencil toggle).
  const annotationRef = React.useRef(annotation);
  annotationRef.current = annotation;

  React.useEffect(() => {
    setNightMode(resolvePdfReaderNightMode(theme));
  }, [theme]);

  const toggleNightMode = React.useCallback(() => {
    setNightMode((current) => {
      const next = !current;
      writePdfReaderNightModePref(next);
      return next;
    });
  }, []);

  // EmbedPDF defaults interaction modes to raw touch handling, which sets
  // touch-action:none on the page provider. Smart Notes routes touch to
  // navigation while pen/mouse input selects or authors; keep reading and
  // authoring modes non-raw so the browser can arbitrate scroll and pinch.
  React.useEffect(() => {
    for (const mode of [
      { id: "pointerMode", exclusive: false },
      { id: "ink", exclusive: true },
      { id: "highlight", exclusive: false },
    ]) {
      interactionManager?.registerMode({
        id: mode.id,
        scope: "page",
        exclusive: mode.exclusive,
        wantsRawTouch: false,
      });
    }
  }, [interactionManager]);

  React.useEffect(() => {
    if (!selection) return;
    const handleCopy = (event: ClipboardEvent) => {
      if (selection.getBoundingRects(documentId).length === 0) return;
      // Selection geometry is virtual (PDF glyphs, not DOM text), so delegate
      // copy to EmbedPDF and suppress the browser's otherwise-empty payload.
      event.preventDefault();
      selection.copyToClipboard(documentId);
    };
    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [documentId, selection]);

  React.useEffect(() => {
    if (!history) return;
    const scope = history.forDocument(documentId);
    const sync = () => {
      setHistoryState({
        canUndo: scope.canUndo("annotations"),
        canRedo: scope.canRedo("annotations"),
      });
    };
    sync();
    return scope.onHistoryChange(sync);
  }, [history, documentId]);

  // Load the PDF's built-in outline (bookmarks) once per document. The reader
  // only surfaces outline navigation when this resolves to a non-empty tree;
  // documents without bookmarks show no toggle, rail, or empty panel (SN-142).
  React.useEffect(() => {
    setOutline([]);
    setOutlineOpen(false);
    if (!bookmarkCap) return;
    let cancelled = false;
    const task = bookmarkCap.forDocument(documentId).getBookmarks();
    task.wait(
      (result) => {
        if (cancelled) return;
        setOutline(buildPdfOutline(result?.bookmarks));
      },
      () => {
        if (!cancelled) setOutline([]);
      }
    );
    return () => {
      cancelled = true;
      task.abort?.({ code: 1, message: "reader outline fetch cancelled" });
    };
  }, [bookmarkCap, documentId]);

  const hasOutline = outline.length > 0;

  const currentPage = scrollState.currentPage || 1;
  // `useScroll` only learns the page count from scroll events (0 before the
  // first scroll), so read the authoritative count from the loaded document.
  const totalPages =
    activeDocument?.document?.pageCount || scrollState.totalPages || 0;
  React.useEffect(() => {
    onPageChange?.(currentPage, totalPages || undefined);
  }, [currentPage, totalPages, onPageChange]);
  const zoomPercent = Math.round((zoomState.currentZoomLevel || 1) * 100);
  const spreadEffective = spreadRequested && spreadViewportEligible;
  const spreadZoomRef = React.useRef(zoom);
  spreadZoomRef.current = zoom;
  const appliedSpreadConfigRef = React.useRef("");

  React.useEffect(() => {
    const query = window.matchMedia(
      "(min-width: 768px) and (max-width: 1366px) and (orientation: landscape)"
    );
    const sync = () => setSpreadViewportEligible(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  React.useEffect(() => {
    if (!spread) return;
    const configKey = `${spreadEffective ? "on" : "off"}:${spreadOffset}`;
    if (appliedSpreadConfigRef.current === configKey) return;
    appliedSpreadConfigRef.current = configKey;
    spread.setSpreadMode(
      spreadEffective
        ? spreadOffset === "even"
          ? SpreadMode.Even
          : SpreadMode.Odd
        : SpreadMode.None
    );
    if (spreadEffective && spreadZoomRef.current) {
      const frame = window.requestAnimationFrame(() =>
        spreadZoomRef.current?.requestZoom(ZoomMode.FitWidth)
      );
      return () => window.cancelAnimationFrame(frame);
    }
  }, [spread, spreadEffective, spreadOffset]);

  // ---- SN-151 render diagnostics (relayed to AV diag via /api/pdf-render-diag).
  // Re-added after the SN-136 merge dropped them. These isolate *where* paint
  // breaks on a real device: PDFium engine (render-probe), the tiling queue
  // (tiles), DOM geometry (frame/image/loaded-image counts), and first paint.
  React.useEffect(() => {
    logPdfRenderEvent(openId, "reader-mounted", {
      href,
      dpr: typeof window !== "undefined" ? window.devicePixelRatio : null,
      ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
      viewportInner:
        typeof window !== "undefined"
          ? { w: window.innerWidth, h: window.innerHeight }
          : null,
    });
    return () => logPdfRenderEvent(openId, "reader-unmounted");
  }, [openId, href]);

  // Periodic DOM geometry: are frames mounting, are images present, and are
  // those images actually decoded (naturalWidth > 0) vs blank?
  React.useEffect(() => {
    const snapshot = (tag: string) => {
      const viewport = document.querySelector<HTMLElement>(".pdf-reader__viewport");
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>(".pdf-reader__page-frame img")
      );
      const canvases = document.querySelectorAll(".pdf-reader__page-frame canvas");
      logPdfRenderEvent(openId, tag, {
        pageCount: totalPages,
        currentPage,
        zoom: zoomState.currentZoomLevel,
        zoomLevel: zoomState.zoomLevel,
        gated: viewportCap?.isGated(documentId) ?? null,
        viewport: viewport
          ? {
              clientWidth: viewport.clientWidth,
              clientHeight: viewport.clientHeight,
              scrollWidth: viewport.scrollWidth,
              scrollHeight: viewport.scrollHeight,
            }
          : null,
        frameCount: document.querySelectorAll(".pdf-reader__page-frame").length,
        imageCount: images.length,
        loadedImageCount: images.filter((img) => img.naturalWidth > 0).length,
        firstImage: images[0]
          ? {
              naturalWidth: images[0].naturalWidth,
              naturalHeight: images[0].naturalHeight,
              displayWidth: Math.round(images[0].getBoundingClientRect().width),
            }
          : null,
        canvasCount: canvases.length,
      });
    };
    snapshot("geometry-mount");
    const timers = [500, 1_500, 4_000, 10_000].map((delay) =>
      window.setTimeout(() => snapshot(`geometry-${delay}ms`), delay)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [
    openId,
    documentId,
    currentPage,
    totalPages,
    viewportCap,
    zoomState.currentZoomLevel,
    zoomState.zoomLevel,
  ]);

  // Tiling queue state — reveals a stuck pipeline (tiles queued/rendering but
  // never ready) which paints frames blank.
  React.useEffect(() => {
    if (!tilingCap) {
      logPdfRenderEvent(openId, "tiling-capability-missing");
      return;
    }
    let lastSignature = "";
    let emitted = 0;
    return tilingCap.onTileRendering((event) => {
      if (event.documentId !== documentId || emitted >= 25) return;
      const pages = Object.entries(event.tiles).map(([page, tiles]) => ({
        page: Number(page) + 1,
        queued: tiles.filter((tile) => tile.status === "queued").length,
        rendering: tiles.filter((tile) => tile.status === "rendering").length,
        ready: tiles.filter((tile) => tile.status === "ready").length,
      }));
      const signature = JSON.stringify(pages);
      if (signature === lastSignature) return;
      lastSignature = signature;
      emitted += 1;
      logPdfRenderEvent(openId, "tiles", { pages });
    });
  }, [openId, documentId, tilingCap]);

  // Direct PDFium render probe: does the WASM engine produce a bitmap at all,
  // independent of the React tiling/scroller? render-probe-ready proves the
  // engine is healthy; -failed/-pending localizes the fault to the engine.
  React.useEffect(() => {
    if (!renderCap || totalPages <= 0) return;
    const scope = renderCap.forDocument(documentId);
    const startedAt = performance.now();
    const task = scope.renderPage({ pageIndex: 0, options: { scaleFactor: 0.2, dpr: 1 } });
    let settled = false;
    const slowTimer = window.setTimeout(() => {
      if (!settled) logPdfRenderEvent(openId, "render-probe-pending", { afterMs: 5_000 });
    }, 5_000);
    task.wait(
      (blob) => {
        settled = true;
        window.clearTimeout(slowTimer);
        logPdfRenderEvent(openId, "render-probe-ready", {
          durationMs: Math.round(performance.now() - startedAt),
          bytes: blob.size,
          type: blob.type,
        });
      },
      (reason) => {
        settled = true;
        window.clearTimeout(slowTimer);
        logPdfRenderEvent(openId, "render-probe-failed", {
          durationMs: Math.round(performance.now() - startedAt),
          reason,
        });
      }
    );
    return () => {
      window.clearTimeout(slowTimer);
      if (!settled) task.abort({ code: 1, message: "diagnostic probe unmounted" });
    };
  }, [openId, documentId, renderCap, totalPages]);

  // First real painted bitmap in the DOM (or a definitive absence).
  const paintLoggedRef = React.useRef(false);
  const [firstPaintAt, setFirstPaintAt] = React.useState<number | null>(null);
  React.useEffect(() => {
    paintLoggedRef.current = false;
    setFirstPaintAt(null);
  }, [openId]);
  React.useEffect(() => {
    if (paintLoggedRef.current) return;
    const tick = () => {
      const imgs = document.querySelectorAll<HTMLImageElement>(
        ".pdf-reader__viewport img, .pdf-reader__page-frame img"
      );
      for (const img of imgs) {
        if (img.naturalWidth > 0) {
          paintLoggedRef.current = true;
          logPdfRenderEvent(openId, "first-paint", {
            kind: "image",
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
          setFirstPaintAt(performance.now());
          return;
        }
      }
      if (document.querySelectorAll(".pdf-reader__page-frame canvas").length > 0) {
        paintLoggedRef.current = true;
        logPdfRenderEvent(openId, "first-paint", { kind: "canvas" });
        setFirstPaintAt(performance.now());
      }
    };
    tick();
    const id = window.setInterval(tick, 400);
    const stop = window.setTimeout(() => window.clearInterval(id), 20_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [openId]);

  const flushSave = React.useCallback(async () => {
    if (!pdfPath || !pendingItemsRef.current) return;
    const items = pendingItemsRef.current;
    pendingItemsRef.current = null;
    setSaveState("saving");
    try {
      await savePdfAnnotations(pdfPath, items);
      setSaveError(null);
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Annotation save failed");
      setSaveState("idle");
    }
  }, [pdfPath]);

  const scheduleSave = React.useCallback(
    (items: unknown[]) => {
      pendingItemsRef.current = items;
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave]
  );

  const exportAndSave = React.useCallback(() => {
    if (!annotation || !pdfPath || !importedRef.current) return;
    annotation.exportAnnotations().wait(
      (items) => {
        // exportAnnotations() dumps the whole store including native PDF
        // annotations (links etc.) — persisting those bloats the sidecar and
        // re-importing them freezes large books (SN-151).
        scheduleSave(
          filterUserAuthoredAnnotationItems(
            Array.isArray(items) ? (items as unknown[]) : []
          )
        );
      },
      () => {
        setSaveError("Could not export annotations");
      }
    );
  }, [annotation, pdfPath, scheduleSave]);

  // Reset import state only when the PDF target changes — not when EmbedPDF
  // replaces the annotation capability object identity.
  React.useEffect(() => {
    importedRef.current = false;
    setAnnotationsReady(false);
    setAnnotateMode(false);
    setActiveTool("pan");
    setSaveError(null);
    setSaveState("idle");
  }, [pdfPath, documentId]);

  // Load sidecar + import only after first paint so annotation work cannot
  // starve WASM tile rasterization on large books.
  React.useEffect(() => {
    if (!annotation || firstPaintAt == null) return;

    // Already imported for this document — keep the toggle enabled.
    if (importedRef.current) {
      setAnnotationsReady(true);
      return;
    }

    if (!pdfPath) {
      // No vault path (e.g. external blob) — annotations stay local-only.
      importedRef.current = true;
      setAnnotationsReady(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const sidecar = await fetchPdfAnnotations(pdfPath);
        if (cancelled) return;
        await new Promise<void>((resolve) => {
          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => resolve());
          } else {
            setTimeout(resolve, 0);
          }
        });
        if (cancelled) return;
        const cap = annotationRef.current;
        if (!cap) return;
        // Import in slices with event-loop yields so even a huge sidecar can
        // never freeze scrolling/tiling in a single main-thread task (SN-151).
        const IMPORT_SLICE = 200;
        for (let start = 0; start < sidecar.items.length; start += IMPORT_SLICE) {
          if (cancelled) return;
          const slice = sidecar.items.slice(start, start + IMPORT_SLICE);
          annotationRef.current?.importAnnotations(slice as never[]);
          if (start + IMPORT_SLICE < sidecar.items.length) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
        if (cancelled) return;
        importedRef.current = true;
        setAnnotationsReady(true);
      } catch {
        if (cancelled) return;
        // Missing/corrupt sidecar must not block reading or Annotate.
        importedRef.current = true;
        setAnnotationsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [annotation, pdfPath, documentId, firstPaintAt]);

  // Persist on annotation create/update/delete after import.
  React.useEffect(() => {
    if (!annotation || !pdfPath) return;
    const off = annotation.onAnnotationEvent((event) => {
      if (!importedRef.current) return;
      if (
        event.type === "create" ||
        event.type === "update" ||
        event.type === "delete"
      ) {
        exportAndSave();
      }
    });
    return off;
  }, [annotation, pdfPath, exportAndSave]);

  // Flush pending save on unmount / href change.
  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void flushSave();
    };
  }, [flushSave]);

  const undoAnnotation = React.useCallback(() => {
    if (!historyState.canUndo) return;
    history?.forDocument(documentId).undo("annotations");
    annotation?.deselectAnnotation();
    window.setTimeout(exportAndSave, 0);
  }, [history, documentId, annotation, exportAndSave, historyState.canUndo]);

  const redoAnnotation = React.useCallback(() => {
    if (!historyState.canRedo) return;
    history?.forDocument(documentId).redo("annotations");
    annotation?.deselectAnnotation();
    window.setTimeout(exportAndSave, 0);
  }, [history, documentId, annotation, exportAndSave, historyState.canRedo]);

  const leaveAnnotate = React.useCallback(() => {
    setAnnotateMode(false);
    setActiveTool("pan");
    annotation?.setActiveTool(null);
    annotation?.deselectAnnotation();
    void flushSave();
  }, [annotation, flushSave]);

  const enterAnnotate = React.useCallback(() => {
    if (!annotationsReady || !pdfPath) return;
    setSearchOpen(false);
    setAnnotateMode(true);
    setControlsVisible(true);
  }, [annotationsReady, pdfPath]);

  // Escape leaves performance mode before Annotate/outline/reader close.
  // Annotation-focused Cmd/Ctrl+Z uses the
  // history plugin without hijacking text editing inside the comment field.
  React.useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const editingText =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (
        annotateMode &&
        !editingText &&
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        if (e.shiftKey) redoAnnotation();
        else undoAnnotation();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        const action = resolvePdfReaderEscapeAction(
          performanceMode,
          annotateMode,
          outlineOpen
        );
        if (action === "performance") onPerformanceModeChange(false);
        else if (action === "annotate") leaveAnnotate();
        else if (action === "outline") setOutlineOpen(false);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    annotateMode,
    leaveAnnotate,
    onClose,
    performanceMode,
    onPerformanceModeChange,
    outlineOpen,
    undoAnnotation,
    redoAnnotation,
  ]);

  // Sync EmbedPDF active tool with Annotate mode + tool selection.
  // Eraser is app-owned: clear EmbedPDF's create tool so pointer scrubbing
  // can hit-test and delete ink without drawing or selecting.
  React.useEffect(() => {
    if (!annotation) return;
    if (annotateMode && annotationsReady) {
      annotation.setActiveTool(
        activeTool === "pan" || activeTool === "eraser" ? null : activeTool
      );
      if (activeTool === "pan" || activeTool === "eraser") {
        annotation.deselectAnnotation();
      }
      setControlsVisible(true);
    } else {
      annotation.setActiveTool(null);
    }
  }, [annotation, annotateMode, activeTool, annotationsReady]);

  // ZoomPlugin gates Viewport children on document open and only releases the
  // gate inside requestZoom(). Its resize recalc path only auto-releases for
  // FitWidth/FitPage/Automatic — a remembered *numeric* zoom (e.g. 100% after a
  // pinch) never releases the gate, so the reader keeps a live pager with zero
  // page frames forever (permanent gray on both desktop and mobile). Seed DOM
  // metrics once, then requestZoom + force-release. Must not re-run after the
  // user pinches/zooms: useZoom() identity churn would otherwise keep
  // re-applying initialPrefs.zoom and snap the view back (SN-151).
  //
  // Always requestZoom(1) on open. FitWidth on a wide desktop resolved to
  // ~377% (live diag) and froze harder than remembered 199%.
  const gateBootstrapDoneRef = React.useRef(false);
  const deferredZoomRestoredRef = React.useRef(false);
  React.useLayoutEffect(() => {
    gateBootstrapDoneRef.current = false;
    deferredZoomRestoredRef.current = false;
  }, [documentId]);
  React.useLayoutEffect(() => {
    // Wait for the zoom capability — marking done without requestZoom leaves the
    // gate closed on the numeric-zoom path.
    if (!viewportPlugin || !zoom || gateBootstrapDoneRef.current) return;
    let cancelled = false;
    const timers: number[] = [];
    const zoomLevel = openZoomLevel(initialPrefs.zoom);
    const deferred = deferredRestoreZoom(initialPrefs.zoom);

    const seed = () => {
      if (cancelled || gateBootstrapDoneRef.current) return;
      const viewport = document.querySelector<HTMLElement>(
        ".pdf-reader__viewport"
      );
      if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) {
        return;
      }
      viewportPlugin.setViewportResizeMetrics(documentId, {
        width: viewport.offsetWidth,
        height: viewport.offsetHeight,
        clientWidth: viewport.clientWidth,
        clientHeight: viewport.clientHeight,
        scrollTop: viewport.scrollTop,
        scrollLeft: viewport.scrollLeft,
        scrollWidth: viewport.scrollWidth,
        scrollHeight: viewport.scrollHeight,
        clientLeft: viewport.clientLeft,
        clientTop: viewport.clientTop,
      });
      try {
        zoom?.requestZoom(zoomLevel);
        logPdfRenderEvent(openId, "zoom-open", {
          openAs: zoomLevel,
          remembered: initialPrefs.zoom,
          deferred,
        });
      } catch {
        // requestZoom can throw before the document is fully wired; the retry
        // timers below cover that window.
      }
      if (viewportCap?.isGated(documentId)) {
        viewportPlugin.releaseGate("zoom", documentId);
      }
      // Mark complete only after a real metrics seed so empty-viewport retries
      // can still run, but never re-requestZoom once the gate path has fired.
      gateBootstrapDoneRef.current = true;
    };

    const frame = window.requestAnimationFrame(seed);
    timers.push(window.setTimeout(seed, 200));
    timers.push(window.setTimeout(seed, 750));

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [documentId, initialPrefs.zoom, openId, viewportCap, viewportPlugin, zoom]);

  // Optional capped restore after first paint (never FitWidth on wide desktop).
  const liveZoomRef = React.useRef(SAFE_OPEN_ZOOM);
  liveZoomRef.current = zoomState.currentZoomLevel || SAFE_OPEN_ZOOM;
  React.useEffect(() => {
    if (firstPaintAt == null || !zoom || deferredZoomRestoredRef.current) return;
    const deferred = deferredRestoreZoom(initialPrefs.zoom);
    if (deferred == null) {
      deferredZoomRestoredRef.current = true;
      return;
    }
    // The user already zoomed (toolbar/pinch) before this restore fired —
    // never override their choice with the remembered level (SN-151).
    if (Math.abs(liveZoomRef.current - SAFE_OPEN_ZOOM) > 0.01) {
      deferredZoomRestoredRef.current = true;
      return;
    }
    deferredZoomRestoredRef.current = true;
    try {
      zoom.requestZoom(deferred);
      logPdfRenderEvent(openId, "zoom-deferred-restored", {
        zoom: deferred,
        afterPaintMs: Math.round(performance.now() - firstPaintAt),
      });
    } catch {
      deferredZoomRestoredRef.current = false;
    }
  }, [firstPaintAt, initialPrefs.zoom, openId, zoom]);

  // Restore the remembered page. This must wait for the scroll *layout* to be
  // ready (the document's page count is known earlier than the scroller can
  // actually position to a page), so key off the layout-ready event.
  // Gate writes by the actual restore target—not a timer—so the temporary page
  // 1 cannot overwrite a stored page N, while a quick user page jump is still
  // persisted immediately after open.
  const restoredRef = React.useRef(false);
  const restoreTargetRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!scrollCap) return;
    const off = scrollCap.onLayoutReady((event) => {
      if (event.documentId !== documentId || restoredRef.current) return;
      restoredRef.current = true;
      const target = clampReaderPage(initialPrefs.page, event.totalPages);
      if (target > 1) {
        restoreTargetRef.current = target;
        scrollCap.forDocument(documentId).scrollToPage({
          pageNumber: target,
          behavior: "auto",
        });
      }
    });
    return off;
  }, [scrollCap, documentId, initialPrefs.page]);

  // Persist page + zoom (debounced) after the initial restore.
  React.useEffect(() => {
    if (!restoredRef.current) return;
    if (restoreTargetRef.current != null) {
      if (currentPage !== restoreTargetRef.current) return;
      restoreTargetRef.current = null;
    }
    const handle = window.setTimeout(() => {
      writePdfReaderPrefs(href, {
        page: currentPage,
        zoom: levelToPrefZoom(zoomState.zoomLevel),
        spreadMode: spreadRequested,
        spreadOffset,
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [href, currentPage, zoomState.zoomLevel, spreadRequested, spreadOffset]);

  const goPrev = React.useCallback(() => {
    if (currentPage > 1) scroll?.scrollToPreviousPage();
  }, [currentPage, scroll]);
  const goNext = React.useCallback(() => {
    if (!totalPages || currentPage < totalPages) scroll?.scrollToNextPage();
  }, [currentPage, scroll, totalPages]);
  const jumpToPage = React.useCallback(
    (page: number) => {
      scrollCap?.forDocument(documentId).scrollToPage({
        pageNumber: page,
        behavior: "auto",
      });
    },
    [scrollCap, documentId]
  );
  // Jump to an outline entry via the same scroll path the pager and last-read
  // restore use, so remembered place stays correct (SN-142). Outline is always
  // an overlay (SN-198); close after select so the jumped page is visible.
  // Narrow widths already did this; desktop now matches because the rail is gone.
  const jumpToOutlineTarget = React.useCallback(
    (pageIndex: number) => {
      jumpToPage(pageIndex + 1);
      setOutlineOpen(false);
    },
    [jumpToPage]
  );

  const zoomIn = React.useCallback(() => zoom?.zoomIn(), [zoom]);
  const zoomOut = React.useCallback(() => zoom?.zoomOut(), [zoom]);
  const applyZoomScale = React.useCallback(
    (scale: number) => {
      zoom?.requestZoom(scale);
    },
    [zoom]
  );
  const fitWidth = React.useCallback(() => {
    // True FitWidth on a wide desktop ≈ 300–400% for letter pages and freezes
    // WASM tiling. Use 100% as the desktop "readable width" stand-in; touch
    // keeps real FitWidth (narrow viewport ≈ 1×).
    if (isCoarsePointerClient()) {
      zoom?.requestZoom(ZoomMode.FitWidth);
    } else {
      zoom?.requestZoom(SAFE_OPEN_ZOOM);
    }
  }, [zoom]);

  // EmbedPDF selects/deselects annotations on pointerdown, before the click
  // that would toggle reader chrome. Remember whether a comment dish was open
  // when the tap began so neither opening a comment nor dismissing one also
  // hides the toolbar.
  const selectionAtPointerDownRef = React.useRef(false);
  const commentDismissedAtPointerDownRef = React.useRef(false);
  const rememberSelection = React.useCallback(() => {
    selectionAtPointerDownRef.current =
      (annotationRef.current?.getSelectedAnnotationIds().length ?? 0) > 0;
  }, []);

  React.useEffect(() => {
    if (!active) return;
    const dismissOpenComment = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".pdf-reader__anno-menu")) return;
      if (!document.querySelector(".pdf-reader__anno-menu")) return;
      commentDismissedAtPointerDownRef.current = true;
      selectionAtPointerDownRef.current = true;
      annotationRef.current?.deselectAnnotation();
    };
    document.addEventListener("pointerdown", dismissOpenComment, true);
    return () => document.removeEventListener("pointerdown", dismissOpenComment, true);
  }, [active]);

  const toggleControls = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (commentDismissedAtPointerDownRef.current) {
        commentDismissedAtPointerDownRef.current = false;
        pendingTapTurnRef.current = null;
        return;
      }
      const pendingTurn = pendingTapTurnRef.current;
      if (pendingTurn) {
        pendingTapTurnRef.current = null;
        if (pendingTurn === "previous") goPrev();
        else goNext();
        return;
      }
      const scope = annotationRef.current;
      const selectedNow = (scope?.getSelectedAnnotationIds().length ?? 0) > 0;
      if (selectionAtPointerDownRef.current) {
        // A comment dish was open when this tap began. Taps inside the dish
        // belong to it; anywhere else dismisses it. Chrome never toggles.
        const inMenu = Boolean(
          (event.target as HTMLElement | null)?.closest(".pdf-reader__anno-menu")
        );
        if (!inMenu && selectedNow) scope?.deselectAnnotation();
        return;
      }
      // In Annotate mode the tap belongs to the tools; keep chrome pinned.
      if (annotateMode) return;
      // This tap just opened a comment — it is not a chrome toggle.
      if (selectedNow) return;
      setControlsVisible((v) => !v);
    },
    [annotateMode, goNext, goPrev]
  );

  const tapTurnCandidateRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startedAt: number;
    multiTouch: boolean;
    button: number;
    modified: boolean;
  } | null>(null);
  const activeTapPointersRef = React.useRef(new Set<number>());
  const pendingTapTurnRef = React.useRef<"previous" | "next" | null>(null);
  const beginTapTurn = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    activeTapPointersRef.current.add(event.pointerId);
    if (activeTapPointersRef.current.size > 1 && tapTurnCandidateRef.current) {
      tapTurnCandidateRef.current.multiTouch = true;
    }
    const target = event.target as HTMLElement | null;
    const inMenu = Boolean(target?.closest(".pdf-reader__anno-menu"));
    const commentOpen = Boolean(document.querySelector(".pdf-reader__anno-menu"));
    if (commentDismissedAtPointerDownRef.current || selectionAtPointerDownRef.current || commentOpen) {
      selectionAtPointerDownRef.current = true;
      pendingTapTurnRef.current = null;
      if (!inMenu && !commentDismissedAtPointerDownRef.current) {
        annotationRef.current?.deselectAnnotation();
      }
      return;
    }
    if (annotateMode || !event.isPrimary || tapTurnCandidateRef.current) return;
    tapTurnCandidateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      multiTouch: false,
      button: event.button,
      modified: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
    };
  }, [annotateMode]);
  const finishTapTurn = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    activeTapPointersRef.current.delete(event.pointerId);
    const candidate = tapTurnCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    tapTurnCandidateRef.current = null;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, [contenteditable='true'], .pdf-reader__anno-menu")) return;
    if ((annotationRef.current?.getSelectedAnnotationIds().length ?? 0) > 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const turn = resolvePdfTapTurn({
      annotateMode,
      multiTouch: candidate.multiTouch,
      button: candidate.button,
      modified: candidate.modified,
      elapsedMs: performance.now() - candidate.startedAt,
      startX: candidate.startX,
      startY: candidate.startY,
      endX: event.clientX,
      endY: event.clientY,
      surfaceLeft: rect.left,
      surfaceWidth: rect.width,
    });
    if (!turn) return;
    pendingTapTurnRef.current = turn;
  }, [annotateMode]);
  const cancelTapTurn = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    activeTapPointersRef.current.delete(event.pointerId);
    if (tapTurnCandidateRef.current?.pointerId === event.pointerId) {
      tapTurnCandidateRef.current = null;
    }
    pendingTapTurnRef.current = null;
    commentDismissedAtPointerDownRef.current = false;
  }, []);

  // Comment/delete dish for an intentionally re-tapped highlight. Creating
  // stays quiet (`selectAfterCreate: false`); ink uses Eraser instead of this
  // menu. EmbedPDF's CounterRotate wrapper sizes itself to the annotation
  // rect — tiny highlights would crush the menu — so the wrapper stays as an
  // origin-only anchor and the panel floats inside.
  const renderSelectionMenu = React.useCallback(
    ({
      selected,
      context,
      menuWrapperProps,
      rect,
      placement,
    }: {
      selected: boolean;
      context: {
        type: string;
        annotation?: { object: { id: string; type: number; contents?: string } };
        pageIndex: number;
        contentLocked?: boolean;
      };
      menuWrapperProps: {
        style: React.CSSProperties;
        ref: (el: HTMLDivElement | null) => void;
      };
      rect?: { size: { width: number; height: number } };
      placement: { suggestTop?: boolean };
    }) => {
      if (!selected || context.type !== "annotation" || !context.annotation) {
        return null;
      }
      const obj = context.annotation.object;
      // Ink is erased with the Eraser tool — never via this dish.
      if (obj.type !== PdfAnnotationSubtype.HIGHLIGHT) return null;
      const canComment = !context.contentLocked;
      const content = typeof obj.contents === "string" ? obj.contents : "";
      // Quiet highlights remain quiet while reading. A highlight with a note
      // is directly readable without entering Annotate.
      if (!annotateMode && !content.trim()) return null;
      const anchorW = rect?.size.width ?? 0;
      const anchorH = rect?.size.height ?? 0;

      return (
        <div
          ref={menuWrapperProps.ref}
          className="pdf-reader__anno-menu-anchor"
          style={{
            ...menuWrapperProps.style,
            // Keep CounterRotate matrix/position; drop the annotation-sized
            // box so the dish is not crushed to a vertical "Add" stub.
            width: 0,
            height: 0,
            overflow: "visible",
            pointerEvents: "none",
            zIndex: 12,
          }}
        >
          <div
            className="pdf-reader__anno-menu"
            data-testid="pdf-reader-anno-menu"
            data-placement={placement.suggestTop ? "top" : "bottom"}
            style={{
              position: "absolute",
              left: anchorW / 2,
              top: placement.suggestTop ? 0 : anchorH,
              transform: placement.suggestTop
                ? "translate(-50%, calc(-100% - 8px))"
                : "translate(-50%, 8px)",
              pointerEvents: "auto",
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <HighlightCommentMenu
              annotationId={obj.id}
              content={content}
              editing={annotateMode}
              canEdit={canComment}
              onEdit={() => {
                setActiveTool("highlight");
                enterAnnotate();
              }}
              onSave={(next) => {
                if (next !== content) {
                  annotation?.updateAnnotation(context.pageIndex, obj.id, {
                    contents: next,
                  });
                }
                annotation?.deselectAnnotation();
              }}
              onDelete={() => {
                annotation?.deleteAnnotation(context.pageIndex, obj.id);
                annotation?.deselectAnnotation();
              }}
              onClose={() => annotation?.deselectAnnotation()}
            />
          </div>
        </div>
      );
    },
    [annotation, annotateMode, enterAnnotate]
  );

  const eraseInkAt = React.useCallback(
    (
      pageIndex: number,
      clientX: number,
      clientY: number,
      frameEl: HTMLElement,
      pageWidthPx: number,
      pageHeightPx: number
    ) => {
      const scope = annotationRef.current;
      if (!scope) return;
      const frame = frameEl.getBoundingClientRect();
      if (frame.width <= 0 || frame.height <= 0) return;
      const scaleX = pageWidthPx / frame.width;
      const scaleY = pageHeightPx / frame.height;
      // Page layout size is already zoom-scaled CSS px; annotation geometry is
      // in unscaled PDF points (layoutPx / zoom).
      const zoom = zoomState.currentZoomLevel || 1;
      const pdfX = ((clientX - frame.left) * scaleX) / zoom;
      const pdfY = ((clientY - frame.top) * scaleY) / zoom;
      const tracked = scope.getAnnotations({ pageIndex }) as Array<{
        object?: ErasableInkObject;
      }>;
      for (const item of tracked) {
        const obj = item.object;
        if (!obj?.id) continue;
        if (!pointNearInk(pdfX, pdfY, obj, INK_ERASER_RADIUS_PT)) continue;
        scope.deleteAnnotation(pageIndex, obj.id);
      }
    },
    [zoomState.currentZoomLevel]
  );

  const preserveFingerNavigation = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        !shouldPreservePdfFingerNavigation({
          annotateMode,
          activeTool,
          pointerType: event.pointerType,
        })
      ) {
        return;
      }
      // The provider installs native bubble listeners on this element. Stop
      // its selection/authoring path for document-first touch modes without
      // preventDefault, so native scroll and pinch navigation retain the
      // gesture. Highlight keeps its established touch selection handoff.
      event.nativeEvent.stopImmediatePropagation();
    },
    [activeTool, annotateMode]
  );

  // Annotation hit areas stay available in reading mode so a researcher can
  // open an existing comment. Eraser temporarily owns page hit-testing.
  const annotationPointerEvents =
    annotateMode && activeTool === "eraser" ? "none" : "auto";

  return (
    <>
      <header
        className="pdf-reader__bar"
        data-testid="pdf-reader-bar"
        data-hidden={!controlsVisible}
      >
        <div className="pdf-reader__bar-group pdf-reader__bar-group--start">
          <button
            type="button"
            className="pdf-reader__control"
            data-testid="pdf-reader-close"
            aria-label="Close PDF reader"
            onClick={onClose}
          >
            <ArrowLeft
              className="pdf-reader__close-icon pdf-reader__close-icon--desktop size-5"
              aria-hidden="true"
            />
            <XIcon
              className="pdf-reader__close-icon pdf-reader__close-icon--mobile size-5"
              aria-hidden="true"
            />
          </button>
          <span className="pdf-reader__title" title={title}>
            {title}
          </span>
        </div>

        <div className="pdf-reader__bar-group pdf-reader__bar-group--center">
          <button
            type="button"
            className="pdf-reader__control"
            data-testid="pdf-reader-prev"
            aria-label="Previous page"
            onClick={goPrev}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <PageJump
            currentPage={currentPage}
            totalPages={totalPages}
            onJump={jumpToPage}
          />
          <button
            type="button"
            className="pdf-reader__control"
            data-testid="pdf-reader-next"
            aria-label="Next page"
            onClick={goNext}
            disabled={totalPages > 0 && currentPage >= totalPages}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="pdf-reader__bar-group pdf-reader__bar-group--end">
          {hasOutline ? (
            <button
              type="button"
              className="pdf-reader__control pdf-reader__outline-toggle"
              data-testid="pdf-reader-outline-toggle"
              data-active={outlineOpen}
              aria-label={outlineOpen ? "Hide outline" : "Show outline"}
              aria-pressed={outlineOpen}
              title={outlineOpen ? "Hide chapter outline" : "Chapter outline"}
              onClick={() => setOutlineOpen((v) => !v)}
            >
              <ListTree className="size-5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="pdf-reader__control pdf-reader__control--hide-narrow"
            data-testid="pdf-reader-zoom-out"
            aria-label="Zoom out"
            onClick={zoomOut}
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>
          <ZoomJump
            zoomPercent={zoomPercent}
            onApply={applyZoomScale}
          />
          <button
            type="button"
            className="pdf-reader__control pdf-reader__control--hide-narrow"
            data-testid="pdf-reader-zoom-in"
            aria-label="Zoom in"
            onClick={zoomIn}
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pdf-reader__control pdf-reader__control--hide-narrow"
            data-testid="pdf-reader-fit-width"
            aria-label="Fit width"
            onClick={fitWidth}
          >
            <Maximize2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pdf-reader__control pdf-reader__spread-toggle pdf-reader__control--menu-phone"
            data-testid="pdf-reader-spread-mode"
            aria-label={spreadRequested ? "Turn off two-page spread" : "Turn on two-page spread"}
            aria-pressed={spreadRequested}
            title={spreadEffective ? "Two-page spread active" : spreadRequested ? "Spread will activate at landscape tablet widths" : "Two-page spread"}
            onClick={() => setSpreadRequested((current) => !current)}
          >
            <BookOpen className="size-5" aria-hidden="true" />
          </button>
          {spreadRequested ? (
            <label className="pdf-reader__spread-offset pdf-reader__control--hide-phone">
              <span className="sr-only">Page pairing</span>
              <select
                data-testid="pdf-reader-spread-offset"
                aria-label="Page pairing"
                value={spreadOffset}
                onChange={(event) => setSpreadOffset(event.target.value === "odd" ? "odd" : "even")}
              >
                <option value="even">Cover first</option>
                <option value="odd">Pair from 1</option>
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="pdf-reader__control pdf-reader__performance-toggle pdf-reader__control--menu-phone"
            data-testid="pdf-reader-performance-mode"
            aria-label={performanceMode ? "Exit performance mode" : "Enter performance mode"}
            aria-pressed={performanceMode}
            title={performanceMode ? "Exit fullscreen and allow screen sleep" : "Fullscreen and keep screen awake"}
            onClick={() => onPerformanceModeChange((current) => !current)}
          >
            <Presentation className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pdf-reader__control pdf-reader__night-toggle pdf-reader__control--menu-phone"
            data-testid="pdf-reader-night-mode"
            aria-label={nightMode ? "Turn off night mode" : "Turn on night mode"}
            aria-pressed={nightMode}
            title={
              nightMode
                ? "Night mode on — page pixels inverted; annotations stay true-color"
                : "Night mode — invert page pixels, keep annotations"
            }
            onClick={toggleNightMode}
          >
            <Moon className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pdf-reader__control pdf-reader__annotate-toggle"
            data-testid="pdf-reader-annotate-toggle"
            data-active={annotateMode}
            aria-label={annotateMode ? "Exit annotate mode" : "Annotate PDF"}
            aria-pressed={annotateMode}
            aria-busy={!annotationsReady && Boolean(pdfPath)}
            disabled={!annotationsReady || !pdfPath}
            title={
              !pdfPath
                ? "Annotations need a vault PDF attachment"
                : !annotationsReady
                  ? "Loading annotations…"
                  : annotateMode
                    ? "Exit annotate mode"
                    : "Annotate — ink, highlight, eraser"
            }
            onClick={() => (annotateMode ? leaveAnnotate() : enterAnnotate())}
          >
            <Pencil className="size-5" aria-hidden="true" />
          </button>
          {onToggleCompanion ? (
            <button
              type="button"
              className="pdf-reader__control"
              data-testid="pdf-reader-companion-toggle"
              aria-label={
                companionOpen
                  ? "Close Smart Notes AI"
                  : companionAnswerReady
                    ? "Open Smart Notes AI — answer ready"
                    : companionWorking
                      ? "Open Smart Notes AI — working"
                      : "Open Smart Notes AI"
              }
              aria-pressed={companionOpen}
              title={
                companionOpen
                  ? "Close AI companion"
                  : companionAnswerReady
                    ? "Companion answer ready"
                    : "Open AI companion beside this PDF"
              }
              onClick={onToggleCompanion}
            >
              <Sparkles className="size-5" aria-hidden="true" />
              {/* SN-211: mirror the shell's closed-panel companion affordance so a
                  turn that finishes while reading a PDF still surfaces here. */}
              {!companionOpen && companionAnswerReady ? (
                <span
                  className="pdf-reader__control-badge pdf-reader__control-badge--ready"
                  role="status"
                  aria-live="polite"
                  aria-label="Companion answer ready"
                  data-testid="pdf-reader-companion-ready-indicator"
                />
              ) : !companionOpen && companionWorking ? (
                <span
                  className="pdf-reader__control-badge pdf-reader__control-badge--working"
                  aria-hidden="true"
                  data-testid="pdf-reader-companion-working-indicator"
                />
              ) : null}
            </button>
          ) : null}
          <button
            type="button"
            className="pdf-reader__control"
            data-testid="pdf-reader-search-toggle"
            aria-label="Search document"
            aria-pressed={searchOpen}
            onClick={() => {
              if (annotateMode) leaveAnnotate();
              setSearchOpen((v) => !v);
            }}
          >
            <SearchIcon className="size-5" aria-hidden="true" />
          </button>
          <a
            className="pdf-reader__control pdf-reader__control--hide-phone"
            data-testid="pdf-reader-open-external"
            aria-label="Open in new tab"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="size-5" aria-hidden="true" />
          </a>
          <DropdownMenu>
            <DropdownMenuTrigger
              type="button"
              className="pdf-reader__control pdf-reader__more-menu"
              data-testid="pdf-reader-more-menu"
              aria-label="More reader controls"
              title="More reader controls"
            >
              <MoreHorizontal className="size-5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              // PDF reader shells at --z-pdf-reader (300); Positioner defaults to
              // z-50 and would paint the menu under the immersive surface.
              className="z-[400] min-w-52"
              positionerClassName="z-[400]"
              data-testid="pdf-reader-more-menu-content"
            >
              <DropdownMenuCheckboxItem
                checked={spreadRequested}
                data-testid="pdf-reader-more-spread"
                onCheckedChange={(next) => setSpreadRequested(Boolean(next))}
              >
                <BookOpen className="size-4" aria-hidden="true" />
                Two-page spread
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={performanceMode}
                data-testid="pdf-reader-more-performance"
                onCheckedChange={(next) => onPerformanceModeChange(Boolean(next))}
              >
                <Presentation className="size-4" aria-hidden="true" />
                Performance mode
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={nightMode}
                data-testid="pdf-reader-more-night"
                onCheckedChange={() => toggleNightMode()}
              >
                <Moon className="size-4" aria-hidden="true" />
                Night mode
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {annotateMode ? (
        <div
          className="pdf-reader__annotate-bar"
          data-testid="pdf-reader-annotate-bar"
          role="toolbar"
          aria-label="PDF annotation tools"
        >
          {READER_TOOLS.map((toolId) => {
            const isActive = activeTool === toolId;
            const { label, icon: Icon } = TOOL_META[toolId];
            return (
              <button
                key={toolId}
                type="button"
                className="pdf-reader__annotate-tool"
                data-testid={`pdf-reader-tool-${toolId}`}
                data-active={isActive}
                aria-label={label}
                aria-pressed={isActive}
                onClick={() => {
                  setActiveTool(toolId);
                  annotation?.deselectAnnotation();
                }}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="pdf-reader__annotate-tool-label">{label}</span>
              </button>
            );
          })}
          <span className="pdf-reader__annotate-divider" aria-hidden="true" />
          <button
            type="button"
            className="pdf-reader__annotate-tool pdf-reader__annotate-tool--icon"
            data-testid="pdf-reader-annotation-undo"
            aria-label="Undo annotation"
            title="Undo annotation"
            disabled={!historyState.canUndo}
            onClick={undoAnnotation}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pdf-reader__annotate-tool pdf-reader__annotate-tool--icon"
            data-testid="pdf-reader-annotation-redo"
            aria-label="Redo annotation"
            title="Redo annotation"
            disabled={!historyState.canRedo}
            onClick={redoAnnotation}
          >
            <Redo2 className="size-4" aria-hidden="true" />
          </button>
          <span className="pdf-reader__annotate-spacer" aria-hidden="true" />
          {activeTool === "eraser" ? (
            <span className="pdf-reader__annotate-hint" role="status">
              Scrub over ink strokes to erase them
            </span>
          ) : activeTool === "highlight" ? (
            <span className="pdf-reader__annotate-hint" role="status">
              Drag to highlight · tap a highlight to comment or delete
            </span>
          ) : activeTool === "pan" ? (
            <span className="pdf-reader__annotate-hint" role="status">
              Navigate safely · choose a tool to annotate
            </span>
          ) : null}
          <button
            type="button"
            className="pdf-reader__annotate-done"
            data-testid="pdf-reader-annotate-done"
            onClick={leaveAnnotate}
          >
            <Check className="size-4" aria-hidden="true" />
            <span>Done</span>
          </button>
          {saveState === "saving" ? (
            <span className="pdf-reader__annotate-hint" data-testid="pdf-reader-annotate-saving">
              Saving…
            </span>
          ) : null}
          {saveError ? (
            <span className="pdf-reader__annotate-error" role="status">
              {saveError}
            </span>
          ) : null}
        </div>
      ) : null}

      {searchOpen ? (
        <SearchPanel
          documentId={documentId}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}

      {/* Minimal always-available exit when the bar is collapsed. */}
      {!controlsVisible && !performanceMode ? <BackButton onClose={onClose} /> : null}

      <div className="pdf-reader__body">
        {hasOutline && outlineOpen ? (
          <>
            {/* Dismissible backdrop on all breakpoints (SN-198). Outline is
                always an overlay so the document viewport never reflows. */}
            <div
              className="pdf-reader__outline-backdrop"
              data-testid="pdf-reader-outline-backdrop"
              onClick={() => setOutlineOpen(false)}
              aria-hidden="true"
            />
            <PdfOutlinePanel
              entries={outline}
              onSelect={jumpToOutlineTarget}
              onClose={() => setOutlineOpen(false)}
            />
          </>
        ) : null}

        <Viewport
          documentId={documentId}
          className="pdf-reader__viewport"
          data-testid="pdf-reader-viewport"
          data-annotate={annotateMode ? "on" : "off"}
          data-annotation-tool={annotateMode ? activeTool : "none"}
          data-night-mode={nightMode ? "on" : "off"}
          data-spread-requested={spreadRequested ? "on" : "off"}
          data-spread-effective={spreadEffective ? "on" : "off"}
          data-tap-zones={annotateMode ? "off" : "on"}
          onPointerDownCapture={(event) => {
            rememberSelection();
            beginTapTurn(event);
          }}
          onPointerUpCapture={finishTapTurn}
          onPointerCancelCapture={cancelTapTurn}
          onClick={toggleControls}
        >
        <ZoomGestureWrapper documentId={documentId} className="pdf-reader__zoomwrap">
          <ResilientScroller
            documentId={documentId}
            renderPage={({ width, height, pageIndex }) => {
              const pageLayers = (
                <div
                  className="pdf-reader__page-frame"
                  style={{ width, height }}
                >
                  {/* Low-res full-page base so frames are never empty while
                      tiles load. Cap DPR so mobile does not OOM one bitmap.
                      Night-mode invert (SN-225) targets this wrapper only so
                      search/selection/annotation overlays stay true-color. */}
                  <div className="pdf-reader__page-bitmap" data-testid="pdf-reader-page-bitmap">
                    <RenderLayer
                      documentId={documentId}
                      pageIndex={pageIndex}
                      scale={1}
                      dpr={pdfPaintDpr()}
                      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                    />
                    <TilingLayer
                      documentId={documentId}
                      pageIndex={pageIndex}
                      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                    />
                  </div>
                  <SearchLayer documentId={documentId} pageIndex={pageIndex} />
                  {/* Selection visuals stay under annotations so re-tapping a
                      highlight reaches its precise hit area. Pointer gestures
                      flow through the page provider that wraps every mode. */}
                  <SelectionLayer
                    documentId={documentId}
                    pageIndex={pageIndex}
                  />
                  <AnnotationLayer
                    documentId={documentId}
                    pageIndex={pageIndex}
                    selectionMenu={
                      activeTool !== "eraser"
                        ? renderSelectionMenu
                        : undefined
                    }
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: annotationPointerEvents,
                    }}
                  />
                  {annotateMode && activeTool === "eraser" ? (
                    <div
                      className="pdf-reader__eraser-surface"
                      data-testid="pdf-reader-eraser-surface"
                      style={{
                        position: "absolute",
                        inset: 0,
                        touchAction: "pan-y pinch-zoom",
                        cursor: "crosshair",
                        pointerEvents: "auto",
                        zIndex: 6,
                      }}
                      onPointerDown={(event) => {
                        if (event.pointerType === "touch") return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        eraseInkAt(
                          pageIndex,
                          event.clientX,
                          event.clientY,
                          event.currentTarget,
                          width,
                          height
                        );
                      }}
                      onPointerMove={(event) => {
                        if (event.pointerType === "touch") return;
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                          return;
                        }
                        event.preventDefault();
                        eraseInkAt(
                          pageIndex,
                          event.clientX,
                          event.clientY,
                          event.currentTarget,
                          width,
                          height
                        );
                      }}
                    />
                  ) : null}
                </div>
              );

              // Selection, annotation hit-testing, and authoring all depend on
              // the same page pointer provider. Keep it mounted in read/pan
              // mode; capture filtering above leaves touch navigation native.
              return (
                <PagePointerProvider
                  documentId={documentId}
                  pageIndex={pageIndex}
                  style={{ width, height, position: "relative" }}
                  onPointerDownCapture={preserveFingerNavigation}
                  onPointerMoveCapture={preserveFingerNavigation}
                >
                  {pageLayers}
                </PagePointerProvider>
              );
            }}
          />
        </ZoomGestureWrapper>
        </Viewport>
      </div>
    </>
  );
}

/**
 * Chapter/subchapter navigation built from the PDF's own outline (SN-142).
 *
 * Rendered only when the document has a bookmark tree — the parent gates on
 * `hasOutline`, so this component never produces an empty panel. Presentation
 * is always an overlay drawer (SN-198) so opening TOC never shrinks or reflows
 * the document viewport on any breakpoint.
 */
function PdfOutlinePanel({
  entries,
  onSelect,
  onClose,
}: {
  entries: OutlineEntry[];
  onSelect: (pageIndex: number) => void;
  onClose: () => void;
}) {
  return (
    <aside
      className="pdf-reader__outline"
      data-testid="pdf-reader-outline"
      aria-label="Document outline"
    >
      <div className="pdf-reader__outline-header">
        <span className="pdf-reader__outline-title">Outline</span>
        <button
          type="button"
          className="pdf-reader__control"
          data-testid="pdf-reader-outline-close"
          aria-label="Close outline"
          onClick={onClose}
        >
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
      <nav className="pdf-reader__outline-scroll" aria-label="Chapters">
        <ul className="pdf-reader__outline-list" role="tree">
          {entries.map((entry, index) => (
            <OutlineNode
              key={`${index}`}
              pathKey={`${index}`}
              entry={entry}
              depth={0}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </nav>
    </aside>
  );
}

/**
 * One outline entry and its sub-entries. Parent nodes carry an expand/collapse
 * toggle (default expanded) so deep chapter trees stay browsable; leaf and
 * grouping nodes render just a label. A node with a page target jumps via
 * `onSelect`; a targetless grouping node's label toggles its children instead.
 */
function OutlineNode({
  entry,
  depth,
  pathKey,
  onSelect,
}: {
  entry: OutlineEntry;
  depth: number;
  pathKey: string;
  onSelect: (pageIndex: number) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const hasChildren = entry.children.length > 0;
  const canJump = entry.pageIndex !== null;

  return (
    <li className="pdf-reader__outline-item" role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className="pdf-reader__outline-row"
        style={{ paddingInlineStart: `${depth * 0.75}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="pdf-reader__outline-twisty"
            data-testid="pdf-reader-outline-twisty"
            aria-label={expanded ? "Collapse section" : "Expand section"}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown
              className="size-4 pdf-reader__outline-twisty-icon"
              data-collapsed={!expanded}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="pdf-reader__outline-twisty-spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          className="pdf-reader__outline-link"
          data-testid="pdf-reader-outline-link"
          data-jumpable={canJump}
          title={entry.title}
          onClick={() => {
            if (canJump) onSelect(entry.pageIndex as number);
            else if (hasChildren) setExpanded((v) => !v);
          }}
        >
          {entry.title}
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul className="pdf-reader__outline-list" role="group">
          {entry.children.map((child, index) => {
            const childKey = `${pathKey}.${index}`;
            return (
              <OutlineNode
                key={childKey}
                pathKey={childKey}
                entry={child}
                depth={depth + 1}
                onSelect={onSelect}
              />
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Editable current-page control with direct page jump. Shows the live current
 * page while idle; on focus it becomes an editable numeric field. Pressing
 * Enter clamps the entry into the document range and jumps there; Escape or
 * blur discards the draft and snaps back to the live page. The total page count
 * is shown alongside so position is obvious even on narrow (mobile) widths.
 */
function PageJump({
  currentPage,
  totalPages,
  onJump,
}: {
  currentPage: number;
  totalPages: number;
  onJump: (page: number) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const value = draft ?? String(currentPage);
  const disabled = totalPages <= 0;

  const commit = React.useCallback(() => {
    if (draft !== null) {
      const target = parseJumpPage(draft, totalPages);
      if (target !== null) onJump(target);
    }
    setDraft(null);
  }, [draft, totalPages, onJump]);

  return (
    <div className="pdf-reader__pager" data-testid="pdf-reader-pager">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="pdf-reader__page-input"
        data-testid="pdf-reader-page-input"
        aria-label={
          disabled
            ? "Current page"
            : `Page ${currentPage} of ${totalPages}. Type a page number and press Enter to jump.`
        }
        value={disabled ? "" : value}
        disabled={disabled}
        onFocus={(e) => {
          setDraft(String(currentPage));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => setDraft(null)}
      />
      <span className="pdf-reader__page-total" data-testid="pdf-reader-page-total">
        / {totalPages || "…"}
      </span>
    </div>
  );
}

/**
 * Editable zoom percent (SN-198). Same interaction class as PageJump: focus
 * selects the value, Enter applies via `parseZoomPercent` → `requestZoom`,
 * Escape/blur discard. Invalid entries leave the live zoom untouched. Hidden
 * on narrow widths with the rest of the zoom stepper (pinch remains).
 */
function ZoomJump({
  zoomPercent,
  onApply,
}: {
  zoomPercent: number;
  onApply: (scale: number) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const value = draft ?? String(zoomPercent);

  const commit = React.useCallback(() => {
    if (draft !== null) {
      const scale = parseZoomPercent(draft);
      if (scale !== null) onApply(scale);
    }
    setDraft(null);
  }, [draft, onApply]);

  return (
    <div
      className="pdf-reader__zoom pdf-reader__control--hide-narrow"
      data-testid="pdf-reader-zoom"
    >
      <input
        type="text"
        inputMode="decimal"
        className="pdf-reader__zoom-input"
        data-testid="pdf-reader-zoom-input"
        aria-label={`Zoom ${zoomPercent} percent. Type a zoom percent and press Enter to apply.`}
        value={value}
        onFocus={(e) => {
          setDraft(String(zoomPercent));
          e.currentTarget.select();
        }}
        onChange={(e) =>
          setDraft(e.target.value.replace(/[^0-9.%]/g, ""))
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => setDraft(null)}
      />
      <span className="pdf-reader__zoom-suffix" aria-hidden="true">
        %
      </span>
    </div>
  );
}

function SearchPanel({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const { state, provides: search } = useSearch(documentId);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced full-document search.
  React.useEffect(() => {
    if (!search) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      search.stopSearch();
      return;
    }
    const handle = window.setTimeout(() => {
      search.searchAllPages(trimmed);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, search]);

  const total = state.total ?? 0;
  const activeIndex = state.activeResultIndex ?? -1;

  return (
    <div className="pdf-reader__search" data-testid="pdf-reader-search">
      <SearchIcon className="size-4 pdf-reader__search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="pdf-reader__search-input"
        data-testid="pdf-reader-search-input"
        placeholder="Search document"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) search?.previousResult();
            else search?.nextResult();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="pdf-reader__search-count" data-testid="pdf-reader-search-count">
        {total > 0 ? `${activeIndex + 1} / ${total}` : query.trim().length >= 2 ? "0" : ""}
      </span>
      <button
        type="button"
        className="pdf-reader__control"
        aria-label="Previous match"
        onClick={() => search?.previousResult()}
        disabled={total <= 0}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pdf-reader__control"
        aria-label="Next match"
        onClick={() => search?.nextResult()}
        disabled={total <= 0}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pdf-reader__control"
        aria-label="Close search"
        onClick={() => {
          search?.stopSearch();
          onClose();
        }}
      >
        <XIcon className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
