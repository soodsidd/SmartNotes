"use client";

import * as React from "react";
import { countAnnotationShapes, logAnnotationDebug } from "@/lib/annotation-debug";
import {
  computeDrawableBottomFromInkEngine,
  drawableBottomFromStrokeBottom,
} from "@/lib/annotation-extent";
import {
  type RemapAnnotationResult,
} from "@/lib/annotation-vertical-remap";
import {
  autoGrowBottomMargin,
} from "@/lib/page-frame";
import type { PageInkExport } from "@/lib/page-export";
import { isWorkspaceZoomWheel } from "@/lib/editor-workspace-zoom";
import { logDrawEvent } from "@/lib/draw-mode-debug";
import { cn } from "@/lib/utils";
import { InkEngineSurface } from "@/components/ink-engine-surface";
import { inkDocumentsMatch, type InkColor, type InkDocument, type InkEngine, type InkScene, type InkSize, type InkTool } from "@/lib/ink-engine";
import { DEFAULT_INK_ENGINE, type AvailableInkEngineId } from "@/lib/ink-engine-preference";
import { inkSidecars } from "@/lib/ink-engine-sidecars";
import { decidePenAwareTouchGesture } from "@/lib/pen-aware-touch";
import { registerReloadDrain } from "@/lib/reload-guard";

export { decidePenAwareTouchGesture, type PenAwareTouchAction } from "@/lib/pen-aware-touch";

const AUTOSAVE_DELAY_MS = 1200;
export const ANNOTATION_HISTORY_THROTTLE_MS = 100;

export interface AnnotationLayerHandle {
  flush: () => Promise<void>;
  flushPending: () => Promise<void>;
  setTool: (tool: InkTool) => void;
  undo: () => void;
  redo: () => void;
  setColor: (color: InkColor) => void;
  setStroke: (size: InkSize) => void;
  loadScene: (scene: InkScene | null) => void;
  /**
   * Shift all page-space ink by `deltaY` after a prose reflow (SN-220 TOC).
   * Persists the remapped scene. Returns a refuse reason when unsafe.
   */
  applyVerticalRemap: (deltaY: number) => RemapAnnotationResult;
  exportInkOverlay: () => Promise<PageInkExport | null>;
  prepareForPrint: () => void;
  restoreAfterPrint: () => void;
}

export type AnnotationLayerMode = "edit" | "draw";

export interface AnnotationLayerProps {
  pagePath: string;
  inkEngine?: AvailableInkEngineId;
  mode: AnnotationLayerMode;
  /** Raw annotations sidecar JSON for version preview. */
  previewSidecarJson?: string;
  readOnly?: boolean;
  onSaveStatusChange?: (status: "idle" | "saving" | "saved" | "error") => void;
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  onSceneChange?: (scene: InkScene | null) => void;
  /** Scroll offset of the editor pane — keeps page-space ink aligned while viewport-clipped. */
  scrollTop?: number;
  /** Active ink color from the draw toolbar — synced even before the imperative ref is ready. */
  inkColor?: InkColor;
  /** Active stroke size from the draw toolbar. */
  inkStroke?: InkSize;
  /** Active ink tool from the draw toolbar. */
  inkTool?: InkTool;
  /** Visible scroll-pane height — sizes the Tldraw host to the viewport, not full document. */
  viewportHeight?: number;
  /** Full page frame height including drawable margin below text. */
  pageFrameHeight?: number;
  /** Live scroll container — used for immediate camera sync and draw-mode wheel scrolling. */
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  /** Workspace zoom on the content frame (SN-113) — keeps camera + clip aligned when scaled. */
  workspaceZoom?: number;
  /** A document-positioned host moves with its page and needs no scroll offset. */
  cameraTracksScroll?: boolean;
  /** Engine zoom for a host sized in screen pixels rather than CSS-scaled. */
  cameraZoom?: number;
  /** Virtualized page hosts can share one pen latch per Draw entry. */
  penState?: { mode: boolean; down: boolean };
  /** Called when scroll metrics change from wheel passthrough or direct container sync. */
  onScrollMetricsChange?: (metrics: { scrollTop: number; viewportHeight: number }) => void;
  /**
   * SN-tablet-pinch (SN-67): a two-finger touch gesture in Draw mode already
   * pans via scrollTop (below); this reports the incremental finger-
   * separation ratio each move so the host can also scale workspaceZoom.
   */
  onWorkspacePinchZoom?: (ratio: number) => void;
  /** Called when ink near the drawable bottom should extend the page frame. */
  onDrawableBottomChange?: (value: number) => void;
  /**
   * Imperative handle passed as a regular prop. `next/dynamic` (used to lazy-load
   * this component) does not forward `ref`, so consumers behind the dynamic
   * boundary must use `handleRef` to reach `undo`/`redo`/`flush` etc. (SN-153).
   */
  handleRef?: React.Ref<AnnotationLayerHandle | null>;
  className?: string;
}

function emitHistoryState(editor: InkEngine, onHistoryChange?: AnnotationLayerProps["onHistoryChange"]) {
  onHistoryChange?.({
    canUndo: editor.canUndo(),
    canRedo: editor.canRedo(),
  });
}

/** Map scroll-container offset to page-space Y when the content frame is CSS-scaled. */
export function pageScrollTopFromContainer(scrollTop: number, workspaceZoom = 1): number {
  if (!Number.isFinite(workspaceZoom) || workspaceZoom <= 0 || workspaceZoom === 1) {
    return scrollTop;
  }
  return scrollTop / workspaceZoom;
}

/** Page-space y at viewport top equals scrollTop (÷ zoom when workspace-scaled); Tldraw camera uses negated page coords. */
export function syncAnnotationCamera(
  editor: InkEngine,
  scrollTop: number,
  viewportEl?: HTMLElement | null,
  workspaceZoom = 1,
  cameraZoom = 1
) {
  const pageTop = pageScrollTopFromContainer(scrollTop, workspaceZoom);
  editor.setCamera({ x: 0, y: -pageTop, z: cameraZoom }, { immediate: true, force: true });
  if (viewportEl) {
    editor.updateViewport(viewportEl);
  }
}

/** Prefer live scroll-container metrics; fall back to props when the ref is unavailable. */
export function readAnnotationScrollMetrics(
  scrollContainer: HTMLElement | null | undefined,
  fallback: { scrollTop?: number; viewportHeight?: number } = {}
) {
  if (scrollContainer) {
    return {
      scrollTop: scrollContainer.scrollTop,
      viewportHeight: scrollContainer.clientHeight,
    };
  }
  return {
    scrollTop: fallback.scrollTop ?? 0,
    viewportHeight: fallback.viewportHeight ?? 0,
  };
}

/** Vertical centroid of the first two active touches; null when fewer than two. */
export function twoFingerCentroidY(touches: ArrayLike<{ clientY: number }>): number | null {
  if (touches.length < 2) return null;
  return (touches[0].clientY + touches[1].clientY) / 2;
}

/** Separation between the first two active touches; null when fewer than two. */
export function twoFingerDistance(touches: ArrayLike<{ clientX: number; clientY: number }>): number | null {
  if (touches.length < 2) return null;
  return Math.max(Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY), 1);
}

/** Throttle history callbacks during active strokes; flush immediately on stroke end. */
export function createThrottledHistoryEmitter(
  editor: InkEngine,
  onHistoryChange: AnnotationLayerProps["onHistoryChange"],
  throttleMs = ANNOTATION_HISTORY_THROTTLE_MS
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emitNow = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    emitHistoryState(editor, onHistoryChange);
  };

  const emitThrottled = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      emitHistoryState(editor, onHistoryChange);
    }, throttleMs);
  };

  const onDocumentChange = () => {
    if (editor.isPointing()) {
      emitThrottled();
      return;
    }
    emitNow();
  };

  return { emitNow, emitThrottled, onDocumentChange, clear: () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  } };
}

/**
 * Page-space ink layer for text pages. Always stays mounted for the active page
 * so Edit ↔ Draw toggles swap interactivity without remounting Tldraw.
 */
export const AnnotationLayer = React.forwardRef<AnnotationLayerHandle, AnnotationLayerProps>(
  function AnnotationLayer(
    {
      pagePath,
      inkEngine = DEFAULT_INK_ENGINE,
      mode,
      previewSidecarJson,
      readOnly = false,
      onSaveStatusChange,
      onHistoryChange,
      onSceneChange,
      scrollTop = 0,
      viewportHeight = 0,
      pageFrameHeight = 0,
      scrollContainerRef,
      workspaceZoom = 1,
      cameraTracksScroll = true,
      cameraZoom = 1,
      penState,
      onScrollMetricsChange,
      onWorkspacePinchZoom,
      onDrawableBottomChange,
      inkColor = "black",
      inkStroke = "m",
      inkTool = "draw",
      handleRef,
      className,
    },
    ref
  ) {
    const sidecar = inkSidecars[inkEngine].annotation;
    const hydratedSceneRef = React.useRef<InkScene | null>(null);
    const [sceneVersion, setSceneVersion] = React.useState(0);
    const [isHydrated, setIsHydrated] = React.useState(false);
    const [editorMounted, setEditorMounted] = React.useState(false);
    const [hasDrawableContent, setHasDrawableContent] = React.useState(false);
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const editorRef = React.useRef<InkEngine | null>(null);
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const emptySnapshotRef = React.useRef<InkScene | null>(null);
    const loadedPathRef = React.useRef<string | null>(null);
    const loadingStoreRef = React.useRef(false);
    const savedDocumentRef = React.useRef<InkDocument | null>(null);
    const saveInFlightRef = React.useRef<{ ownerPath: string; document: InkDocument; promise: Promise<void> } | null>(null);
    const hydratedPathRef = React.useRef<string | null>(null);
    const [loadedPath, setLoadedPath] = React.useState<string | null>(null);
    const pendingInkColorRef = React.useRef<InkColor>(inkColor);
    const pendingInkStrokeRef = React.useRef<InkSize>(inkStroke);
    const localPenState = React.useRef({ mode: false, down: false });
    const pen = penState ?? localPenState.current;
    // SN-tablet-pinch: syncHostCamera (and so the touch-gesture effect below,
    // which depends on it) legitimately re-identifies whenever workspaceZoom
    // actually changes - which a real pinch does, every frame. A gesture
    // object declared fresh inside that effect would get wiped mid-pinch by
    // its own teardown/reattach, silently truncating the compounded zoom
    // ratio (observed: a 2.5x finger-separation pinch only reached 1.25x).
    // Keeping it in a ref declared outside the effect survives that churn.
    const gestureRef = React.useRef<{ anchor: { x: number; y: number } | null; distance: number }>({ anchor: null, distance: 0 });
    const debugShapeCountRef = React.useRef(-1);
    // Viewport-scaled blank margin kept below the lowest stroke so the canvas
    // always extends past the last stroke. Read from a ref so save/flush
    // callbacks stay stable across viewport changes.
    const growthMarginRef = React.useRef(autoGrowBottomMargin(0));
    growthMarginRef.current = autoGrowBottomMargin(viewportHeight);
    const loadedPageIsCurrent = isHydrated && loadedPath === pagePath;
    const interactive = mode === "draw" && !readOnly && loadedPageIsCurrent;

    const applyScene = React.useCallback((loaded: InkScene | null, forPath: string) => {
      logAnnotationDebug("layer.apply-scene", {
        pagePath,
        forPath,
        shapeCount: countAnnotationShapes(loaded),
      });
      hydratedPathRef.current = forPath;
      hydratedSceneRef.current = loaded;
      setHasDrawableContent(countAnnotationShapes(loaded) > 0);
      setIsHydrated(true);
      setSceneVersion((current) => current + 1);
    }, [pagePath]);

    const persistStoreToOwner = React.useCallback(async (force = false) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const editor = editorRef.current;
      const ownerPath = loadedPathRef.current;
      if (!editor || readOnly || !ownerPath) return;

      const document = editor.getDocument();
      const activeSave = saveInFlightRef.current;
      if (activeSave?.ownerPath === ownerPath && inkDocumentsMatch(activeSave.document, document)) {
        return activeSave.promise;
      }
      const savedDocument = savedDocumentRef.current;
      if (!force && !activeSave && savedDocument && inkDocumentsMatch(savedDocument, document)) {
        await sidecar.flushWrites((path) => path === ownerPath);
        return;
      }

      const snap = editor.getScene();
      const drawableBottom = cameraTracksScroll
        ? computeDrawableBottomFromInkEngine(editor, growthMarginRef.current)
        : undefined;
      logAnnotationDebug("layer.persist-owner", {
        pagePath,
        ownerPath,
        shapeCount: countAnnotationShapes(snap),
        drawableBottom,
      });
      sidecar.remember(ownerPath, snap, drawableBottom);
      if (drawableBottom != null && ownerPath === pagePath) {
        onDrawableBottomChange?.(drawableBottom);
      }
      onSaveStatusChange?.("saving");
      // Enqueue the captured document immediately. The sidecar orders saves
      // by owner even when the layer is remounted.
      const promise = (async () => {
        try {
          await sidecar.save(ownerPath, snap, drawableBottom);
          if (loadedPathRef.current === ownerPath && editorRef.current === editor) {
            savedDocumentRef.current = document;
            onSaveStatusChange?.("saved");
          }
        } catch {
          onSaveStatusChange?.("error");
          throw new Error("Failed to save annotations.");
        }
      })();
      saveInFlightRef.current = { ownerPath, document, promise };
      try {
        await promise;
      } finally {
        if (saveInFlightRef.current?.promise === promise) saveInFlightRef.current = null;
      }
    }, [cameraTracksScroll, onDrawableBottomChange, onSaveStatusChange, pagePath, readOnly, sidecar]);

    const loadSceneIntoStore = React.useCallback(
      (targetPath: string, scene: InkScene | null) => {
        const editor = editorRef.current;
        if (!editor) return;

        if (loadedPathRef.current && loadedPathRef.current !== targetPath) {
          logAnnotationDebug("layer.load.flush-dirty-owner", {
            pagePath,
            fromOwnerPath: loadedPathRef.current,
            targetPath,
          });
          void persistStoreToOwner().catch(() => undefined);
        }

        logAnnotationDebug("layer.load-store.start", {
          pagePath,
          targetPath,
          previousOwnerPath: loadedPathRef.current,
          shapeCount: countAnnotationShapes(scene),
        });
        loadingStoreRef.current = true;
        try {
          if (scene) {
            editor.loadScene(scene);
          } else if (emptySnapshotRef.current) {
            editor.loadScene(emptySnapshotRef.current);
          }
          // SN-153: `loadSnapshot` records the loaded scene as an undoable change;
          // tldraw's own file-open path always follows it with `clearHistory()`.
          // Without this the freshly hydrated scene sits on the undo stack, so
          // `canUndo` is true before the user draws anything and a later undo can
          // walk back past their strokes and erase the whole pre-existing scene.
          editor.clearHistory();
        } finally {
          loadingStoreRef.current = false;
        }

        loadedPathRef.current = targetPath;
        setLoadedPath(targetPath);
        savedDocumentRef.current = editor.getDocument();
        setHasDrawableContent(countAnnotationShapes(scene) > 0);
        onSceneChange?.(scene);
        emitHistoryState(editor, onHistoryChange);
        logAnnotationDebug("layer.load-store.done", {
          pagePath,
          loadedPath: targetPath,
          interactive: mode === "draw" && !readOnly && targetPath === pagePath,
        });
      },
      [mode, onHistoryChange, onSceneChange, pagePath, persistStoreToOwner, readOnly]
    );

    React.useEffect(() => {
      let cancelled = false;
      logAnnotationDebug("layer.hydrate.start", { pagePath, hasPreview: previewSidecarJson !== undefined });
      setIsHydrated(false);
      setHasDrawableContent(false);
      hydratedPathRef.current = null;
      hydratedSceneRef.current = null;
      const forPath = pagePath;

      if (previewSidecarJson !== undefined) {
        const { scene, drawableBottom } = sidecar.parse(previewSidecarJson);
        const loaded = (scene) ?? null;
        logAnnotationDebug("layer.hydrate.preview", {
          pagePath,
          shapeCount: countAnnotationShapes(loaded),
          drawableBottom,
        });
        if (drawableBottom != null) {
          onDrawableBottomChange?.(drawableBottom);
        }
        applyScene(loaded, forPath);
        return;
      }

      const cached = sidecar.getCached(pagePath);
      if (cached?.annotationsReady) {
        logAnnotationDebug("layer.hydrate.cache-hit", {
          pagePath,
          shapeCount: countAnnotationShapes(cached.annotationsScene),
        });
        if (cached.drawableBottom != null) onDrawableBottomChange?.(cached.drawableBottom);
        applyScene((cached.annotationsScene) ?? null, forPath);
        return;
      }

      sidecar
        .load(pagePath)
        .then((payload) => {
          if (!cancelled) {
            logAnnotationDebug("layer.hydrate.fetch-done", {
              pagePath,
              shapeCount: countAnnotationShapes(payload.scene),
              drawableBottom: payload.drawableBottom,
            });
            if (payload.drawableBottom != null) {
              onDrawableBottomChange?.(payload.drawableBottom);
            }
            applyScene((payload.scene) ?? null, forPath);
          }
        })
        .catch(() => {
          if (!cancelled) {
            logAnnotationDebug("layer.hydrate.fetch-error", { pagePath });
            applyScene(null, forPath);
          }
        });

      return () => {
        cancelled = true;
        logAnnotationDebug("layer.hydrate.cancel", { pagePath });
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }, [applyScene, onDrawableBottomChange, pagePath, previewSidecarJson, sidecar]);

    const loadedSceneKeyRef = React.useRef<string | null>(null);
    const sceneKey = `${pagePath}:${previewSidecarJson ?? "live"}:${isHydrated ? "ready" : "pending"}:${sceneVersion}`;

    React.useEffect(() => {
      if (!editorRef.current || !isHydrated || !editorMounted) return;
      if (hydratedPathRef.current !== pagePath) return;
      if (loadedSceneKeyRef.current === sceneKey) return;
      loadedSceneKeyRef.current = sceneKey;
      loadSceneIntoStore(pagePath, hydratedSceneRef.current);
    }, [editorMounted, isHydrated, loadSceneIntoStore, pagePath, sceneKey]);

    const loadScene = React.useCallback(
      (scene: InkScene | null) => {
        logAnnotationDebug("layer.handle.load-scene", {
          pagePath,
          shapeCount: countAnnotationShapes(scene),
        });
        applyScene(scene, pagePath);
        sidecar.remember(pagePath, scene);
      },
      [applyScene, pagePath, sidecar]
    );

    const flushPending = React.useCallback(async () => {
      const editor = editorRef.current;
      const ownerPath = loadedPathRef.current;
      if (!editor || readOnly || !ownerPath) return;
      do {
        const document = editor.getDocument();
        await persistStoreToOwner();
        if (inkDocumentsMatch(document, editor.getDocument())) return;
      } while (editorRef.current === editor && loadedPathRef.current === ownerPath);
    }, [persistStoreToOwner, readOnly]);

    React.useEffect(() => {
      if (readOnly) return;
      return registerReloadDrain(flushPending);
    }, [flushPending, readOnly]);

    // PDF frames can be virtualized away as the user scrolls. Retain their
    // pending snapshot before the engine is released, even without host navigation.
    const flushOnUnmount = React.useRef(flushPending);
    flushOnUnmount.current = flushPending;
    React.useLayoutEffect(() => () => {
      void flushOnUnmount.current().catch(() => undefined);
    }, []);

    const setTool = React.useCallback((tool: InkTool) => {
      editorRef.current?.setTool(tool);
    }, []);

    const undo = React.useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.undo();
      emitHistoryState(editor, onHistoryChange);
    }, [onHistoryChange]);

    const redo = React.useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.redo();
      emitHistoryState(editor, onHistoryChange);
    }, [onHistoryChange]);

    const setColor = React.useCallback((color: InkColor) => {
      pendingInkColorRef.current = color;
      editorRef.current?.setColor(color);
    }, []);

    const setStroke = React.useCallback((size: InkSize) => {
      pendingInkStrokeRef.current = size;
      editorRef.current?.setSize(size);
    }, []);

    const applyPendingInkStyles = React.useCallback((editor: InkEngine) => {
      editor.setColor(pendingInkColorRef.current);
      editor.setSize(pendingInkStrokeRef.current);
    }, []);

    const printStateRef = React.useRef<{ scrollTop: number } | null>(null);

    const scheduleSave = React.useCallback(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flushPending().catch(() => undefined);
      }, AUTOSAVE_DELAY_MS);
    }, [flushPending]);

    const applyVerticalRemap = React.useCallback(
      (deltaY: number): RemapAnnotationResult => {
        const editor = editorRef.current;
        if (!editor) {
          return {
            ok: false,
            reason: "Cannot adjust ink safely: annotation layer is not ready.",
          };
        }

        if (!Number.isFinite(deltaY)) {
          return {
            ok: false,
            reason: "Cannot adjust ink safely: vertical shift is invalid.",
          };
        }

        if (deltaY === 0) {
          const snap = editor.getScene();
          const drawableBottom = computeDrawableBottomFromInkEngine(
            editor,
            growthMarginRef.current
          );
          return { ok: true, scene: snap, drawableBottom };
        }

        let drawableBottom: number | undefined;
        const translated = editor.translateStrokesY(deltaY, (bottom) => {
          drawableBottom = drawableBottomFromStrokeBottom(bottom, growthMarginRef.current);
          return drawableBottom == null || drawableBottom >= 0;
        });
        if (!translated.ok) return translated;

        const snap = editor.getScene();
        if (!translated.count) return { ok: true, scene: snap };

        onSceneChange?.(snap);
        if (drawableBottom != null) {
          onDrawableBottomChange?.(drawableBottom);
        }
        void persistStoreToOwner().catch(() => undefined);
        logAnnotationDebug("layer.vertical-remap", {
          pagePath,
          deltaY,
          shapeCount: translated.count,
          drawableBottom,
        });
        return { ok: true, scene: snap, drawableBottom };
      },
      [onDrawableBottomChange, onSceneChange, pagePath, persistStoreToOwner]
    );

    const [cameraScrollTop, setCameraScrollTop] = React.useState(0);
    const syncHostCamera = React.useCallback((editor: InkEngine, top: number) => {
      const cameraTop = cameraTracksScroll ? top : 0;
      syncAnnotationCamera(editor, cameraTop, hostRef.current, workspaceZoom, cameraZoom);
      setCameraScrollTop(cameraTop);
    }, [cameraTracksScroll, cameraZoom, workspaceZoom]);

    const syncCameraFromContainer = React.useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const metrics = readAnnotationScrollMetrics(scrollContainerRef?.current, {
        scrollTop,
        viewportHeight,
      });
      syncHostCamera(editor, metrics.scrollTop);
      return metrics;
    }, [scrollContainerRef, scrollTop, syncHostCamera, viewportHeight]);

    const exportInkOverlay = React.useCallback(async (): Promise<PageInkExport | null> => {
      const editor = editorRef.current;
      if (!editor || editor.getStrokeCount() === 0) {
        return null;
      }

      syncCameraFromContainer();
      const result = await editor.toSvg();
      syncCameraFromContainer();

      if (!result) {
        return null;
      }

      return {
        svg: result.svg,
        width: result.width,
        height: result.height,
      };
    }, [syncCameraFromContainer]);

    const prepareForPrint = React.useCallback(() => {
      const editor = editorRef.current;
      const container = scrollContainerRef?.current;
      if (!editor || !container) {
        return;
      }

      printStateRef.current = { scrollTop: container.scrollTop };
      container.scrollTop = 0;
      const host = hostRef.current;
      syncAnnotationCamera(editor, 0, host);
      if (host) {
        editor.updateViewport(host);
      }
      setCameraScrollTop(0);
    }, [scrollContainerRef]);

    const restoreAfterPrint = React.useCallback(() => {
      const editor = editorRef.current;
      const container = scrollContainerRef?.current;
      const saved = printStateRef.current;
      printStateRef.current = null;
      if (!editor || !container || !saved) {
        return;
      }

      container.scrollTop = saved.scrollTop;
      syncCameraFromContainer();
    }, [scrollContainerRef, syncCameraFromContainer]);

    const buildHandle = React.useCallback(
      (): AnnotationLayerHandle => ({
        flush: () => persistStoreToOwner(true),
        flushPending,
        setTool,
        undo,
        redo,
        setColor,
        setStroke,
        loadScene,
        applyVerticalRemap,
        exportInkOverlay,
        prepareForPrint,
        restoreAfterPrint,
      }),
      [
        applyVerticalRemap,
        exportInkOverlay,
        flushPending,
        persistStoreToOwner,
        loadScene,
        prepareForPrint,
        redo,
        restoreAfterPrint,
        setColor,
        setStroke,
        setTool,
        undo,
      ]
    );

    // Bind the imperative handle to both the forwarded `ref` and the `handleRef`
    // prop. `next/dynamic` drops `ref`, so the prop path is what actually reaches
    // consumers in production; `ref` stays wired for any direct (non-lazy) mount.
    React.useImperativeHandle(ref, buildHandle, [buildHandle]);
    React.useImperativeHandle(handleRef, buildHandle, [buildHandle]);

    const handleMount = React.useCallback(
      (editor: InkEngine) => {
        editorRef.current = editor;
        logAnnotationDebug("layer.mount", { pagePath, interactive });
        logDrawEvent("layer.mount", {
          pagePath,
          interactive,
          viewportHeight,
          scrollTop,
          workspaceZoom,
          touchActionApplied: interactive,
          ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
        });
        editor.setReadOnly(!interactive);
        emptySnapshotRef.current = editor.getScene();
        const metrics = readAnnotationScrollMetrics(scrollContainerRef?.current, {
          scrollTop,
          viewportHeight,
        });
        syncHostCamera(editor, metrics.scrollTop);
        editor.setTool("draw");
        applyPendingInkStyles(editor);
        setEditorMounted(true);
        emitHistoryState(editor, onHistoryChange);
      },
      [applyPendingInkStyles, interactive, onHistoryChange, scrollContainerRef, scrollTop, syncHostCamera, viewportHeight, workspaceZoom]
    );

    React.useLayoutEffect(() => {
      if (!editorMounted) return;
      syncCameraFromContainer();
    }, [editorMounted, interactive, mode, syncCameraFromContainer, workspaceZoom]);

    React.useEffect(() => {
      const editor = editorRef.current;
      const container = scrollContainerRef?.current;
      const host = hostRef.current;
      if (!editor || !container || !host || !editorMounted) return;

      const publishMetrics = (metrics: { scrollTop: number; viewportHeight: number }) => {
        onScrollMetricsChange?.(metrics);
      };

      const syncFromScroll = () => {
        const metrics = readAnnotationScrollMetrics(container);
        syncHostCamera(editor, metrics.scrollTop);
        publishMetrics(metrics);
      };

      syncFromScroll();
      container.addEventListener("scroll", syncFromScroll, { passive: true });

      const onPointerDown = () => {
        const top = container.scrollTop;
        syncHostCamera(editor, top);
      };
      host.addEventListener("pointerdown", onPointerDown, { capture: true });

      const onWheel = (event: WheelEvent) => {
        if (!interactive || editor.isPointing()) return;
        // Workspace zoom (Ctrl/Cmd+scroll / trackpad pinch) scales text+ink together.
        if (isWorkspaceZoomWheel(event)) return;
        event.preventDefault();
        event.stopPropagation();
        container.scrollTop += event.deltaY;
        syncFromScroll();
      };
      if (cameraTracksScroll) container.addEventListener("wheel", onWheel, { capture: true, passive: false });

      return () => {
        container.removeEventListener("scroll", syncFromScroll);
        host.removeEventListener("pointerdown", onPointerDown, { capture: true });
        container.removeEventListener("wheel", onWheel, { capture: true });
      };
    }, [cameraTracksScroll, editorMounted, interactive, onScrollMetricsChange, scrollContainerRef, syncHostCamera]);

    // Pen mode latches per draw-mode entry: reset each time draw mode is
    // (re)entered so a finger draws again until a stylus is next seen (SN-156).
    // Also clears any in-progress pan/pinch gesture from a prior draw-mode
    // session - gestureRef now survives the touch effect's own
    // teardown/reattach (SN-tablet-pinch), so it needs this explicit reset.
    React.useEffect(() => {
      if (interactive && !penState) {
        pen.mode = false;
        pen.down = false;
      }
      if (interactive) {
        gestureRef.current.anchor = null;
        gestureRef.current.distance = 0;
      }
    }, [interactive, pen, penState]);

    // Touch navigation + stylus-aware finger routing in draw mode (SN-156).
    // `touch-action: none` hands every touch to Tldraw for inking, and touch
    // swipes never become `wheel` events — so navigation has no browser path.
    // We drive the scroll container directly from touch deltas.
    //
    // Gesture model (Android tablet primary): a stylus always inks. "Pen mode"
    // latches on the first stylus contact of a draw-mode entry; while it is off
    // a lone finger draws (as before), and once it is on a lone finger pans
    // instead. Two fingers always navigate (centroid delta → `scrollTop`, plus
    // finger-separation ratio → onWorkspacePinchZoom, SN-67/SN-tablet-pinch).
    // While the stylus is actually touching, every touch is rejected, so a
    // resting palm neither inks nor scrolls.
    React.useEffect(() => {
      const container = scrollContainerRef?.current;
      const host = hostRef.current;
      if (!container || !host || !editorMounted || !interactive) return;

      const gesture = gestureRef.current;

      const readAnchor = (touches: TouchList) => {
        const first = touches[0];
        if (!first) return null;
        const second = touches[1];
        return {
          x: second ? (first.clientX + second.clientX) / 2 : first.clientX,
          y: twoFingerCentroidY(touches) ?? first.clientY,
        };
      };
      const rebase = (touches: TouchList) => {
        gesture.anchor = readAnchor(touches);
        gesture.distance = twoFingerDistance(touches) ?? 0;
      };

      const syncFromScroll = () => {
        const editor = editorRef.current;
        if (!editor) return;
        const metrics = readAnnotationScrollMetrics(container);
        syncHostCamera(editor, metrics.scrollTop);
        onScrollMetricsChange?.(metrics);
      };

      const onPenDown = (event: PointerEvent) => {
        if (event.pointerType !== "pen") return;
        pen.mode = true;
        pen.down = true;
        gesture.anchor = null;
      };
      const onPenUp = (event: PointerEvent) => {
        if (event.pointerType !== "pen") return;
        pen.down = false;
      };

      const onTouchStart = (event: TouchEvent) => {
        if (event.target instanceof Element && event.target.closest("[data-sn-ink-controls]")) return;
        const action = decidePenAwareTouchGesture({
          touchCount: event.touches.length,
          penMode: pen.mode,
          penDown: pen.down,
        });
        logDrawEvent("layer.touchstart", {
          pagePath,
          touchCount: event.touches.length,
          action,
          penMode: pen.mode,
          penDown: pen.down,
          shapeCount: editorRef.current ? editorRef.current.getStrokeCount() : 0,
        });
        if (action === "draw") return; // lone finger, pen mode off: let Tldraw ink
        if (action === "ignore") {
          // Palm/finger while the stylus is drawing: swallow so it can't reach
          // Tldraw as a stray pointer, but neither scroll nor cancel the stroke.
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // Navigate, not draw: abort any stroke the finger began and take over.
        editorRef.current?.cancel();
        rebase(event.touches);
        event.preventDefault();
        event.stopPropagation();
      };

      const onTouchMove = (event: TouchEvent) => {
        if (pen.down || !gesture.anchor) return;
        const next = readAnchor(event.touches);
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        container.scrollLeft += gesture.anchor.x - next.x;
        container.scrollTop += gesture.anchor.y - next.y;
        gesture.anchor = next;
        syncFromScroll();
        if (event.touches.length >= 2) {
          const dist = twoFingerDistance(event.touches);
          // Reassign gesture.distance every move and let the host apply the
          // ratio to *its* current zoom (not a fixed gesture-start zoom) -
          // the same fixed-base-vs-reassigned-reference mismatch produced
          // the Music-page in-place jitter (ink-canvas.tsx) when it compared
          // a per-frame ratio against an absolute start value instead.
          if (dist != null && gesture.distance > 0) onWorkspacePinchZoom?.(dist / gesture.distance);
          if (dist != null) gesture.distance = dist;
        }
      };

      // Hold the gesture until every finger lifts, so degrading from two touches
      // to one keeps panning instead of letting the stray finger start a stroke.
      const endGesture = (event: TouchEvent) => {
        if (gesture.anchor) rebase(event.touches);
      };

      // Tldraw draws/pinches from pointer events, a separate stream from touch
      // events; swallow touch-pointer input while our scroll gesture runs or
      // while the stylus is drawing (palm rejection). The stylus itself reports
      // `pointerType === "pen"` and is never blocked.
      const blockPointerDuringGesture = (event: PointerEvent) => {
        if (event.target instanceof Element && event.target.closest("[data-sn-ink-controls]")) return;
        if ((gesture.anchor || pen.mode || pen.down) && event.pointerType === "touch") {
          event.stopPropagation();
        }
      };

      host.addEventListener("pointerdown", onPenDown, { capture: true });
      window.addEventListener("pointerup", onPenUp, { capture: true });
      window.addEventListener("pointercancel", onPenUp, { capture: true });
      host.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
      host.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
      host.addEventListener("touchend", endGesture, { capture: true });
      host.addEventListener("touchcancel", endGesture, { capture: true });
      host.addEventListener("pointerdown", blockPointerDuringGesture, { capture: true });
      host.addEventListener("pointermove", blockPointerDuringGesture, { capture: true });

      return () => {
        host.removeEventListener("pointerdown", onPenDown, { capture: true });
        window.removeEventListener("pointerup", onPenUp, { capture: true });
        window.removeEventListener("pointercancel", onPenUp, { capture: true });
        host.removeEventListener("touchstart", onTouchStart, { capture: true });
        host.removeEventListener("touchmove", onTouchMove, { capture: true });
        host.removeEventListener("touchend", endGesture, { capture: true });
        host.removeEventListener("touchcancel", endGesture, { capture: true });
        host.removeEventListener("pointerdown", blockPointerDuringGesture, { capture: true });
        host.removeEventListener("pointermove", blockPointerDuringGesture, { capture: true });
      };
    }, [editorMounted, interactive, onScrollMetricsChange, onWorkspacePinchZoom, pagePath, pen, scrollContainerRef, syncHostCamera]);

    React.useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.setReadOnly(!interactive);
      logAnnotationDebug("layer.interactive-state", {
        pagePath,
        loadedPath,
        isHydrated,
        interactive,
      });
      if (interactive) {
        editor.setTool(inkTool);
        applyPendingInkStyles(editor);
      }
      logDrawEvent("layer.interactive-state", {
        pagePath,
        loadedPath,
        isHydrated,
        interactive,
        mode,
        hasDrawableContent,
        shapeCount: editor.getStrokeCount(),
        currentTool: editor.getTool(),
      });
    }, [applyPendingInkStyles, hasDrawableContent, inkTool, interactive, isHydrated, loadedPath, mode, pagePath]);

    React.useEffect(() => {
      pendingInkColorRef.current = inkColor;
      pendingInkStrokeRef.current = inkStroke;
      const editor = editorRef.current;
      if (!editor || !editorMounted || !interactive) return;
      applyPendingInkStyles(editor);
      editor.setTool(inkTool);
    }, [applyPendingInkStyles, editorMounted, inkColor, inkStroke, inkTool, interactive]);

    React.useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !isHydrated || !editorMounted) return;

      const historyEmitter = createThrottledHistoryEmitter(editor, onHistoryChange);
      let strokeActive = false;

      const flushStrokeEnd = () => {
        if (!strokeActive) return;
        strokeActive = false;
        historyEmitter.emitNow();

        const editor = editorRef.current;
        if (!editor || !interactive || !onDrawableBottomChange) return;
        const drawableBottom = computeDrawableBottomFromInkEngine(editor, growthMarginRef.current);
        if (drawableBottom != null) {
          onDrawableBottomChange(drawableBottom);
        }
      };

      const host = hostRef.current;
      host?.addEventListener("pointerup", flushStrokeEnd);
      host?.addEventListener("pointercancel", flushStrokeEnd);

      const cleanupDocument = editor.subscribe(
        () => {
          if (loadingStoreRef.current) {
            logAnnotationDebug("layer.document-change.ignored-load", {
              pagePath,
              loadedPath: loadedPathRef.current,
            });
            return;
          }
          setHasDrawableContent(editor.getStrokeCount() > 0);
          onSceneChange?.(editor.getScene());
          logAnnotationDebug("layer.document-change.user", {
            pagePath,
            loadedPath: loadedPathRef.current,
            interactive,
            pointing: editor.isPointing(),
          });
          if (interactive) {
            scheduleSave();
          }
          const shapeCount = editor.getStrokeCount();
          if (!editor.isPointing() || shapeCount !== debugShapeCountRef.current) {
            debugShapeCountRef.current = shapeCount;
            logDrawEvent("layer.document-change", {
              pagePath,
              loadedPath: loadedPathRef.current,
              interactive,
              pointing: editor.isPointing(),
              shapeCount,
            });
          }
          if (editor.isPointing()) {
            strokeActive = true;
          }
          historyEmitter.onDocumentChange();
        }
      );

      const cleanupSession = editor.subscribe(
        () => historyEmitter.emitNow(),
        "session"
      );

      return () => {
        cleanupDocument();
        cleanupSession();
        historyEmitter.clear();
        host?.removeEventListener("pointerup", flushStrokeEnd);
        host?.removeEventListener("pointercancel", flushStrokeEnd);
      };
    }, [
      editorMounted,
      interactive,
      isHydrated,
      onDrawableBottomChange,
      onHistoryChange,
      onSceneChange,
      sceneKey,
      scheduleSave,
    ]);

    const isVisible = mode === "draw" || (loadedPageIsCurrent && hasDrawableContent);

    const logCommittedPaintState = React.useCallback(
      (tag: "layer.pointerup" | "layer.pointercancel", event: React.PointerEvent<HTMLDivElement>) => {
        const pointer = {
          pointerType: event.pointerType,
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
          isPrimary: event.isPrimary,
        };
        window.setTimeout(() => {
          const editor = editorRef.current;
          const host = hostRef.current;
          const hostStyle = host ? window.getComputedStyle(host) : null;
          logDrawEvent(tag, {
            ...pointer,
            pagePath,
            loadedPath: loadedPathRef.current,
            interactive,
            mode,
            hasDrawableContent,
            shapeCount: editor ? editor.getStrokeCount() : 0,
            currentTool: editor ? editor.getTool() : null,
            isPointing: editor?.isPointing() ?? null,
            ...editor?.inspectPaint(host),
            hostVisibility: hostStyle?.visibility ?? null,
            hostOpacity: hostStyle?.opacity ?? null,
          });
        }, 0);
      },
      [hasDrawableContent, interactive, mode, pagePath]
    );

    return (
      <div
        ref={hostRef}
        data-testid="annotation-layer"
        data-annotation-mode={mode}
        data-annotation-ready={loadedPageIsCurrent ? "true" : "false"}
        data-annotation-loaded-path={loadedPath ?? ""}
        data-annotation-visible={isVisible ? "true" : "false"}
        data-annotation-camera-scroll-top={String(cameraScrollTop)}
        className={cn(
          "annotation-layer-host relative h-full w-full",
          !interactive && "annotation-layer-passive",
          !isVisible && "annotation-layer-hidden",
          className
        )}
        // touch-action:none hands touch events to Tldraw for drawing instead of
        // letting the browser claim them for page scroll — required on mobile.
        style={interactive ? { touchAction: "none" } : undefined}
        aria-hidden={!isVisible}
        onPointerDown={(e) => {
          if (!interactive) return;
          logDrawEvent("layer.pointerdown", {
            pointerType: e.pointerType,
            x: Math.round(e.clientX),
            y: Math.round(e.clientY),
            buttons: e.buttons,
            pressure: e.pressure,
            isPrimary: e.isPrimary,
            target: (e.target as HTMLElement)?.tagName,
            targetClass: (e.target as Element)?.getAttribute?.("class") ?? null,
            shapeCount: editorRef.current ? editorRef.current.getStrokeCount() : 0,
            currentTool: editorRef.current ? editorRef.current.getTool() : null,
          });
        }}
        onPointerUp={(event) => logCommittedPaintState("layer.pointerup", event)}
        onPointerCancel={(event) => logCommittedPaintState("layer.pointercancel", event)}
      >
        <div className="absolute inset-0">
          <InkEngineSurface engine={inkEngine} variant="annotation" onMount={handleMount} />
        </div>
      </div>
    );
  }
);
