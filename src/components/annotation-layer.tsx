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
import { inkDocumentsMatch, type InkColor, type InkEngine, type InkScene, type InkSize, type InkTool } from "@/lib/ink-engine";
import { DEFAULT_INK_ENGINE, type AvailableInkEngineId } from "@/lib/ink-engine-preference";
import { inkSidecars } from "@/lib/ink-engine-sidecars";

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
  /** Called when scroll metrics change from wheel passthrough or direct container sync. */
  onScrollMetricsChange?: (metrics: { scrollTop: number; viewportHeight: number }) => void;
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
  workspaceZoom = 1
) {
  const pageTop = pageScrollTopFromContainer(scrollTop, workspaceZoom);
  editor.setCamera({ x: 0, y: -pageTop, z: 1 }, { immediate: true, force: true });
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

export type PenAwareTouchAction = "draw" | "pan" | "ignore";

/**
 * Resolves what a touch contact should do in draw mode given stylus state
 * (SN-156 stylus gesture model, Android-tablet primary):
 * - While the stylus is in contact, every touch is rejected — a resting palm
 *   neither inks nor scrolls (palm rejection).
 * - Two touches always navigate (scroll / pinch-zoom).
 * - A lone touch draws only while "pen mode" is off; once a stylus has been
 *   seen this draw-mode entry, a lone finger pans instead of drawing.
 */
export function decidePenAwareTouchGesture(params: {
  touchCount: number;
  penMode: boolean;
  penDown: boolean;
}): PenAwareTouchAction {
  const { touchCount, penMode, penDown } = params;
  if (penDown) return "ignore";
  if (touchCount >= 2) return "pan";
  if (touchCount === 1) return penMode ? "pan" : "draw";
  return "ignore";
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
      onScrollMetricsChange,
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
    const savingRef = React.useRef(false);
    const pendingRef = React.useRef(false);
    const editorRef = React.useRef<InkEngine | null>(null);
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const emptySnapshotRef = React.useRef<InkScene | null>(null);
    const loadedPathRef = React.useRef<string | null>(null);
    const loadingStoreRef = React.useRef(false);
    const dirtyRef = React.useRef(false);
    const ownerSaveRef = React.useRef<Promise<void> | null>(null);
    const hydratedPathRef = React.useRef<string | null>(null);
    const [loadedPath, setLoadedPath] = React.useState<string | null>(null);
    const pendingInkColorRef = React.useRef<InkColor>(inkColor);
    const pendingInkStrokeRef = React.useRef<InkSize>(inkStroke);
    // Stylus-aware touch routing (SN-156). `penModeRef` latches true on the first
    // stylus contact of a draw-mode entry (see the reset effect below);
    // `penDownRef` tracks whether the stylus is currently touching the screen.
    const penModeRef = React.useRef(false);
    const penDownRef = React.useRef(false);
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
      onSceneChange?.(loaded);
    }, [onSceneChange, pagePath]);

    const persistStoreToOwner = React.useCallback(() => {
      const editor = editorRef.current;
      const ownerPath = loadedPathRef.current;
      if (!editor || readOnly || !ownerPath) {
        logAnnotationDebug("layer.persist-skip", {
          pagePath,
          ownerPath,
          hasEditor: Boolean(editor),
          readOnly,
        });
        return;
      }

      const snap = editor.getScene();
      const drawableBottom = computeDrawableBottomFromInkEngine(editor, growthMarginRef.current);
      logAnnotationDebug("layer.persist-owner", {
        pagePath,
        ownerPath,
        shapeCount: countAnnotationShapes(snap),
        drawableBottom,
      });
      sidecar.remember(ownerPath, snap, drawableBottom);
      ownerSaveRef.current = sidecar.save(ownerPath, snap, drawableBottom).catch(() => undefined);
      if (drawableBottom != null) {
        onDrawableBottomChange?.(drawableBottom);
      }
      dirtyRef.current = false;
    }, [onDrawableBottomChange, pagePath, readOnly, sidecar]);

    const loadSceneIntoStore = React.useCallback(
      (targetPath: string, scene: InkScene | null) => {
        const editor = editorRef.current;
        if (!editor) return;

        if (dirtyRef.current && loadedPathRef.current && loadedPathRef.current !== targetPath) {
          logAnnotationDebug("layer.load.flush-dirty-owner", {
            pagePath,
            fromOwnerPath: loadedPathRef.current,
            targetPath,
          });
          persistStoreToOwner();
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
        dirtyRef.current = false;
        setHasDrawableContent(countAnnotationShapes(scene) > 0);
        emitHistoryState(editor, onHistoryChange);
        logAnnotationDebug("layer.load-store.done", {
          pagePath,
          loadedPath: targetPath,
          interactive: mode === "draw" && !readOnly && targetPath === pagePath,
        });
      },
      [mode, onHistoryChange, pagePath, persistStoreToOwner, readOnly]
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

    const flushSave = React.useCallback(async () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const editor = editorRef.current;
      if (!editor || readOnly) {
        return;
      }

      if (savingRef.current) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (!savingRef.current) {
              resolve();
              return;
            }
            window.setTimeout(check, 50);
          };
          check();
        });
      }

      savingRef.current = true;
      onSaveStatusChange?.("saving");

      const snap = editor.getScene();
      const ownerPath = loadedPathRef.current;
      if (!ownerPath) {
        logAnnotationDebug("layer.flush.skip-no-owner", { pagePath });
        onSaveStatusChange?.("idle");
        savingRef.current = false;
        pendingRef.current = false;
        return;
      }
      const drawableBottom = computeDrawableBottomFromInkEngine(editor, growthMarginRef.current);
      sidecar.remember(ownerPath, snap, drawableBottom);
      setHasDrawableContent(countAnnotationShapes(snap) > 0);
      logAnnotationDebug("layer.flush.save", {
        pagePath,
        ownerPath,
        shapeCount: countAnnotationShapes(snap),
        drawableBottom,
      });
      try {
        await sidecar.save(ownerPath, snap, drawableBottom);
        if (drawableBottom != null) {
          onDrawableBottomChange?.(drawableBottom);
        }
        dirtyRef.current = false;
        onSaveStatusChange?.("saved");
      } catch {
        onSaveStatusChange?.("error");
        throw new Error("Failed to save annotations.");
      } finally {
        savingRef.current = false;
        pendingRef.current = false;
      }
    }, [onDrawableBottomChange, onSaveStatusChange, pagePath, readOnly, sidecar]);

    const flushPending = React.useCallback(async () => {
      const editor = editorRef.current;
      if (!editor || readOnly || !loadedPathRef.current) return;
      await ownerSaveRef.current;
      let document = editor.getDocument();
      await flushSave();
      while (editorRef.current === editor) {
        const liveDocument = editor.getDocument();
        if (inkDocumentsMatch(document, liveDocument)) return;
        document = liveDocument;
        await flushSave();
      }
    }, [flushSave, readOnly]);

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
      if (!interactive) return;
      logAnnotationDebug("layer.autosave.schedule", {
        pagePath,
        loadedPath: loadedPathRef.current,
      });
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const editor = editorRef.current;
        if (!editor) return;

        if (savingRef.current) {
          logAnnotationDebug("layer.autosave.pending", {
            pagePath,
            loadedPath: loadedPathRef.current,
          });
          pendingRef.current = true;
          return;
        }

        savingRef.current = true;
        onSaveStatusChange?.("saving");

        const snap = editor.getScene();
        const ownerPath = loadedPathRef.current;
        if (!ownerPath) {
          logAnnotationDebug("layer.autosave.skip-no-owner", { pagePath });
          savingRef.current = false;
          pendingRef.current = false;
          onSaveStatusChange?.("idle");
          return;
        }
        // Recompute the drawable extent on every live save so the canvas grows
        // to one page-length past the lowest stroke while the user is still
        // drawing — not only when they leave draw mode. This is the reliable
        // growth path; the pointerup handler below is just the faster trigger.
        const drawableBottom = computeDrawableBottomFromInkEngine(editor, growthMarginRef.current);
        sidecar.remember(ownerPath, snap, drawableBottom);
        logAnnotationDebug("layer.autosave.save", {
          pagePath,
          ownerPath,
          shapeCount: countAnnotationShapes(snap),
          drawableBottom,
        });
        sidecar.save(ownerPath, snap, drawableBottom)
          .then(() => {
            setHasDrawableContent(countAnnotationShapes(snap) > 0);
            if (drawableBottom != null) {
              onDrawableBottomChange?.(drawableBottom);
            }
            dirtyRef.current = false;
            onSaveStatusChange?.("saved");
            setTimeout(() => onSaveStatusChange?.("idle"), 1200);
          })
          .catch(() => onSaveStatusChange?.("error"))
          .finally(() => {
            savingRef.current = false;
            if (pendingRef.current) {
              pendingRef.current = false;
              scheduleSave();
            }
          });
      }, AUTOSAVE_DELAY_MS);
    }, [interactive, onDrawableBottomChange, onSaveStatusChange, pagePath, sidecar]);

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

        dirtyRef.current = true;
        onSceneChange?.(snap);
        if (drawableBottom != null) {
          onDrawableBottomChange?.(drawableBottom);
        }
        sidecar.remember(pagePath, snap, drawableBottom);
        persistStoreToOwner();
        logAnnotationDebug("layer.vertical-remap", {
          pagePath,
          deltaY,
          shapeCount: translated.count,
          drawableBottom,
        });
        return { ok: true, scene: snap, drawableBottom };
      },
      [onDrawableBottomChange, onSceneChange, pagePath, persistStoreToOwner, sidecar]
    );

    const [cameraScrollTop, setCameraScrollTop] = React.useState(0);

    const syncCameraFromContainer = React.useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const metrics = readAnnotationScrollMetrics(scrollContainerRef?.current, {
        scrollTop,
        viewportHeight,
      });
      syncAnnotationCamera(editor, metrics.scrollTop, hostRef.current, workspaceZoom);
      setCameraScrollTop(metrics.scrollTop);
      return metrics;
    }, [scrollContainerRef, scrollTop, viewportHeight, workspaceZoom]);

    const exportInkOverlay = React.useCallback(async (): Promise<PageInkExport | null> => {
      const editor = editorRef.current;
      if (!editor || countAnnotationShapes(editor.getScene()) === 0) {
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
        flush: flushSave,
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
        flushSave,
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
        syncAnnotationCamera(editor, metrics.scrollTop, hostRef.current, workspaceZoom);
        setCameraScrollTop(metrics.scrollTop);
        editor.setTool("draw");
        applyPendingInkStyles(editor);
        setEditorMounted(true);
        emitHistoryState(editor, onHistoryChange);
      },
      [applyPendingInkStyles, interactive, onHistoryChange, scrollContainerRef, scrollTop, viewportHeight, workspaceZoom]
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
        syncAnnotationCamera(editor, metrics.scrollTop, host, workspaceZoom);
        setCameraScrollTop(metrics.scrollTop);
        publishMetrics(metrics);
      };

      syncFromScroll();
      container.addEventListener("scroll", syncFromScroll, { passive: true });

      const onPointerDown = () => {
        const top = container.scrollTop;
        syncAnnotationCamera(editor, top, host, workspaceZoom);
        setCameraScrollTop(top);
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
      container.addEventListener("wheel", onWheel, { capture: true, passive: false });

      return () => {
        container.removeEventListener("scroll", syncFromScroll);
        host.removeEventListener("pointerdown", onPointerDown, { capture: true });
        container.removeEventListener("wheel", onWheel, { capture: true });
      };
    }, [editorMounted, interactive, onScrollMetricsChange, scrollContainerRef, workspaceZoom]);

    // Pen mode latches per draw-mode entry: reset each time draw mode is
    // (re)entered so a finger draws again until a stylus is next seen (SN-156).
    React.useEffect(() => {
      if (interactive) {
        penModeRef.current = false;
        penDownRef.current = false;
      }
    }, [interactive]);

    // Touch navigation + stylus-aware finger routing in draw mode (SN-156).
    // `touch-action: none` hands every touch to Tldraw for inking, and touch
    // swipes never become `wheel` events — so navigation has no browser path.
    // We drive the scroll container directly from touch deltas.
    //
    // Gesture model (Android tablet primary): a stylus always inks. "Pen mode"
    // latches on the first stylus contact of a draw-mode entry; while it is off
    // a lone finger draws (as before), and once it is on a lone finger pans
    // instead. Two fingers always navigate (centroid delta → `scrollTop`;
    // pinch-zoom scaling itself is left to SN-67). While the stylus is actually
    // touching, every touch is rejected, so a resting palm neither inks nor
    // scrolls.
    React.useEffect(() => {
      const container = scrollContainerRef?.current;
      const host = hostRef.current;
      if (!container || !host || !editorMounted || !interactive) return;

      const gesture = { active: false, startAnchorY: 0, startScrollTop: 0 };

      // Pan anchor: two-finger centroid, else the lone touch's Y.
      const panAnchorY = (touches: TouchList): number | null => {
        if (touches.length >= 2) return twoFingerCentroidY(touches);
        if (touches.length === 1) return touches[0].clientY;
        return null;
      };

      const syncFromScroll = () => {
        const editor = editorRef.current;
        if (!editor) return;
        const metrics = readAnnotationScrollMetrics(container);
        syncAnnotationCamera(editor, metrics.scrollTop, host, workspaceZoom);
        setCameraScrollTop(metrics.scrollTop);
        onScrollMetricsChange?.(metrics);
      };

      const onPenDown = (event: PointerEvent) => {
        if (event.pointerType !== "pen") return;
        penModeRef.current = true;
        penDownRef.current = true;
      };
      const onPenUp = (event: PointerEvent) => {
        if (event.pointerType !== "pen") return;
        penDownRef.current = false;
      };

      const onTouchStart = (event: TouchEvent) => {
        const action = decidePenAwareTouchGesture({
          touchCount: event.touches.length,
          penMode: penModeRef.current,
          penDown: penDownRef.current,
        });
        logDrawEvent("layer.touchstart", {
          pagePath,
          touchCount: event.touches.length,
          action,
          penMode: penModeRef.current,
          penDown: penDownRef.current,
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
        const anchorY = panAnchorY(event.touches);
        if (anchorY == null) return;
        // Navigate, not draw: abort any stroke the finger began and take over.
        editorRef.current?.cancel();
        gesture.active = true;
        gesture.startAnchorY = anchorY;
        gesture.startScrollTop = container.scrollTop;
        event.preventDefault();
        event.stopPropagation();
      };

      const onTouchMove = (event: TouchEvent) => {
        if (!gesture.active) return;
        const anchorY = panAnchorY(event.touches);
        if (anchorY == null) return;
        event.preventDefault();
        event.stopPropagation();
        container.scrollTop = gesture.startScrollTop + (gesture.startAnchorY - anchorY);
        syncFromScroll();
      };

      // Hold the gesture until every finger lifts, so degrading from two touches
      // to one keeps panning instead of letting the stray finger start a stroke.
      const endGesture = (event: TouchEvent) => {
        if (gesture.active && event.touches.length === 0) {
          gesture.active = false;
        }
      };

      // Tldraw draws/pinches from pointer events, a separate stream from touch
      // events; swallow touch-pointer input while our scroll gesture runs or
      // while the stylus is drawing (palm rejection). The stylus itself reports
      // `pointerType === "pen"` and is never blocked.
      const blockPointerDuringGesture = (event: PointerEvent) => {
        if ((gesture.active || penDownRef.current) && event.pointerType === "touch") {
          event.stopPropagation();
        }
      };

      host.addEventListener("pointerdown", onPenDown, { capture: true });
      host.addEventListener("pointerup", onPenUp, { capture: true });
      host.addEventListener("pointercancel", onPenUp, { capture: true });
      host.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
      host.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
      host.addEventListener("touchend", endGesture, { capture: true });
      host.addEventListener("touchcancel", endGesture, { capture: true });
      host.addEventListener("pointerdown", blockPointerDuringGesture, { capture: true });
      host.addEventListener("pointermove", blockPointerDuringGesture, { capture: true });

      return () => {
        host.removeEventListener("pointerdown", onPenDown, { capture: true });
        host.removeEventListener("pointerup", onPenUp, { capture: true });
        host.removeEventListener("pointercancel", onPenUp, { capture: true });
        host.removeEventListener("touchstart", onTouchStart, { capture: true });
        host.removeEventListener("touchmove", onTouchMove, { capture: true });
        host.removeEventListener("touchend", endGesture, { capture: true });
        host.removeEventListener("touchcancel", endGesture, { capture: true });
        host.removeEventListener("pointerdown", blockPointerDuringGesture, { capture: true });
        host.removeEventListener("pointermove", blockPointerDuringGesture, { capture: true });
      };
    }, [editorMounted, interactive, onScrollMetricsChange, scrollContainerRef, workspaceZoom]);

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
          setHasDrawableContent(true);
          dirtyRef.current = true;
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

    const isVisible = mode === "draw" || hasDrawableContent;

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
        data-annotation-ready={isHydrated ? "true" : "false"}
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
