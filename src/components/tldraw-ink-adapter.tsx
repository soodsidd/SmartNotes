"use client";

import * as React from "react";
import {
  Tldraw,
  DefaultColorStyle,
  DefaultSizeStyle,
  DrawShapeUtil,
  type Editor,
  type TLDrawShape,
  type TLEditorSnapshot,
  type TLGridProps,
  type TLStoreSnapshot,
} from "tldraw";
import "tldraw/tldraw.css";
import type { InkEngineSurfaceProps } from "@/components/ink-engine-surface";
import type { InkEngine } from "@/lib/ink-engine";

// SN-154: new annotation strokes are 25% thinner than tldraw's defaults.
// The scale is stamped onto each newly created draw shape instead of being
// applied globally at render time. Historical shapes have no marker and
// therefore retain their original rendered weight when a saved page reopens.
export const ANNOTATION_INK_STROKE_SCALE = 0.75;
export const ANNOTATION_INK_STROKE_SCALE_META_KEY = "smartNotesInkStrokeScale";

export class AnnotationDrawShapeUtil extends DrawShapeUtil {
  constructor(editor: Editor) {
    super(editor);
    const base = this.options;
    this.options = {
      ...base,
      getCustomDisplayValues: (editor, shape, theme, colorMode) => {
        const custom = base.getCustomDisplayValues(editor, shape, theme, colorMode);
        if (shape.meta[ANNOTATION_INK_STROKE_SCALE_META_KEY] !== ANNOTATION_INK_STROKE_SCALE) {
          return custom;
        }
        const defaults = base.getDefaultDisplayValues(editor, shape, theme, colorMode);
        return {
          ...custom,
          strokeWidth: defaults.strokeWidth * ANNOTATION_INK_STROKE_SCALE,
        };
      },
    };
  }

  override onBeforeCreate(next: TLDrawShape): TLDrawShape {
    return {
      ...next,
      meta: {
        ...next.meta,
        [ANNOTATION_INK_STROKE_SCALE_META_KEY]: ANNOTATION_INK_STROKE_SCALE,
      },
    };
  }
}

const ANNOTATION_SHAPE_UTILS = [AnnotationDrawShapeUtil];

const COMPONENTS_HIDDEN = {
  Background: null,
  SelectionBackground: null,
  Grid: null,
  PageMenu: null,
  Toolbar: null,
  StylePanel: null,
  NavigationPanel: null,
  Minimap: null,
  HelpMenu: null,
  MainMenu: null,
  ActionsMenu: null,
  ContextMenu: null,
  QuickActions: null,
  HelperButtons: null,
  ZoomMenu: null,
  TopPanel: null,
  SharePanel: null,
  MenuPanel: null,
  RichTextToolbar: null,
  ImageToolbar: null,
  VideoToolbar: null,
  KeyboardShortcutsDialog: null,
  DebugPanel: null,
  DebugMenu: null,
  Dialogs: null,
  Toasts: null,
  A11y: null,
  FollowingIndicator: null,
} as const;

// Custom grid component: renders graph-paper style lines that pan and scale with the camera.
// Receives camera position (x, y), zoom (z), and base grid size (size) from TLDraw.
function InkGridLines({ x, y, z, size }: TLGridProps) {
  const id = React.useId();
  const minorS = Math.max(size * z * 5, 1);  // minor grid cell — 5 grid units in screen px
  const majorS = minorS * 5;                  // major grid cell — 25 grid units in screen px

  // Compute pattern phase: positive modulo of camera offset in screen coordinates
  const rawX = 0.5 + x * z;
  const rawY = 0.5 + y * z;
  const gxo = ((rawX % majorS) + majorS) % majorS;
  const gyo = ((rawY % majorS) + majorS) % majorS;

  return (
    <svg
      className="tl-grid"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {/* Minor grid: thin lines every 5 grid units */}
        <pattern
          id={`${id}-minor`}
          width={minorS}
          height={minorS}
          patternUnits="userSpaceOnUse"
          x={gxo}
          y={gyo}
        >
          <path
            d={`M ${minorS} 0 L 0 0 0 ${minorS}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.15"
          />
        </pattern>
        {/* Major grid: slightly bolder lines every 25 grid units */}
        <pattern
          id={`${id}-major`}
          width={majorS}
          height={majorS}
          patternUnits="userSpaceOnUse"
          x={gxo}
          y={gyo}
        >
          <path
            d={`M ${majorS} 0 L 0 0 0 ${majorS}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.28"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-minor)`} />
      <rect width="100%" height="100%" fill={`url(#${id}-major)`} />
    </svg>
  );
}

// components object is stable (defined outside React) so it doesn't cause re-renders.
const COMPONENTS_GRID = { PageMenu: null, Grid: InkGridLines } as const;
const COMPONENTS_BLANK = { PageMenu: null } as const;
const COMPONENTS_MUSIC = {
  PageMenu: null,
  MainMenu: null,
  MenuPanel: null,
  StylePanel: null,
  Toolbar: null,
  NavigationPanel: null,
  QuickActions: null,
  HelperButtons: null,
} as const;


export function createTldrawInkEngine(editor: Editor): InkEngine {
  const getStrokeBottom = () => {
    let bottom: number | undefined;
    for (const id of editor.getCurrentPageShapeIds()) {
      const bounds = editor.getShapePageBounds(id);
      if (bounds) bottom = Math.max(bottom ?? 0, bounds.maxY);
    }
    return bottom;
  };

  return {
    loadScene: (scene) => editor.loadSnapshot(scene as TLEditorSnapshot | TLStoreSnapshot),
    getScene: () => editor.getSnapshot(),
    getDocument: () => editor.store.serialize("document"),
    setTool: (tool) => editor.setCurrentTool(tool),
    getTool: () => editor.getCurrentToolId(),
    setColor: (color) => editor.setStyleForNextShapes(DefaultColorStyle, color),
    setSize: (size) => editor.setStyleForNextShapes(DefaultSizeStyle, size),
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    canUndo: () => editor.getCanUndo(),
    canRedo: () => editor.getCanRedo(),
    clearHistory: () => editor.clearHistory(),
    setReadOnly: (isReadonly) => editor.updateInstanceState({ isReadonly }),
    setCamera: (camera, options) => editor.setCamera(camera, options),
    updateViewport: (viewport) => editor.updateViewportScreenBounds(viewport),
    lockCamera: () => editor.setCameraOptions({ isLocked: true, wheelBehavior: "none" }),
    setGridVisible: (isGridMode) => editor.updateInstanceState({ isGridMode }),
    subscribe: (listener, scope = "document") =>
      editor.store.listen(listener, scope === "document" ? { source: "user", scope } : { scope }),
    isPointing: () => editor.inputs.isPointing,
    cancel: () => editor.cancel(),
    getStrokeCount: () => editor.getCurrentPageShapeIds().size,
    getStrokeBottom,
    translateStrokesY: (deltaY, acceptBottom) => {
      const positions = [];
      for (const id of editor.getCurrentPageShapeIds()) {
        const shape = editor.getShape(id);
        if (!shape || !Number.isFinite(shape.y)) {
          return { ok: false, reason: "Cannot adjust ink safely: a stroke is missing a valid page position." };
        }
        positions.push({ id, type: shape.type, y: shape.y });
      }
      if (!positions.length) return { ok: true, count: 0 };

      const isReadonly = editor.getInstanceState().isReadonly;
      const updates = positions.map((position) => ({ ...position, y: position.y + deltaY }));
      try {
        // SN-230: programmatic writes are ignored in read-only mode.
        if (isReadonly) editor.updateInstanceState({ isReadonly: false });
        editor.updateShapes(updates);
        const applied = updates.every(({ id, y }) => {
          const shape = editor.getShape(id);
          return shape && Math.abs(shape.y - y) < 0.5;
        });
        if (!applied) {
          editor.updateShapes(positions);
          return { ok: false, reason: "Cannot adjust ink safely: ink positions could not be updated." };
        }
        if (!acceptBottom(getStrokeBottom())) {
          editor.updateShapes(positions);
          return { ok: false, reason: "Cannot adjust ink safely: drawable extent would become invalid." };
        }
        return { ok: true, count: updates.length };
      } catch {
        return { ok: false, reason: "Cannot adjust ink safely: ink positions could not be updated." };
      } finally {
        if (isReadonly) editor.updateInstanceState({ isReadonly: true });
      }
    },
    toSvg: async (strokeIds) => {
      const filter = strokeIds && new Set(strokeIds);
      const ids = editor.getCurrentPageShapesSorted().map((shape) => shape.id).filter((id) => !filter || filter.has(id));
      if (!ids.length) return null;
      return await editor.getSvgString(ids, {
        background: false,
        padding: 0,
        preserveAspectRatio: "none",
      }) ?? null;
    },
    inspectPaint: (host) => {
      const paths = host?.querySelectorAll<SVGPathElement>('.tl-shape[data-shape-type="draw"] path');
      const path = paths?.item(Math.max(0, (paths?.length ?? 1) - 1)) ?? null;
      const style = path ? window.getComputedStyle(path) : null;
      const box = path?.getBoundingClientRect();
      return {
        pathCount: paths?.length ?? 0,
        pathHasGeometry: Boolean(path?.getAttribute("d")),
        pathWidth: box ? Math.round(box.width) : 0,
        pathHeight: box ? Math.round(box.height) : 0,
        pathFill: style?.fill ?? null,
        pathStroke: style?.stroke ?? null,
      };
    },
  };
}

export function TldrawInkSurface({ variant, scene, grid, onMount }: InkEngineSurfaceProps) {
  const annotation = variant === "annotation";
  const music = variant === "music";
  const mount = React.useCallback((editor: Editor) => {
    if (annotation) {
      // Let workspace zoom own the wheel, including on a touch-capable device.
      editor.user.updateUserPreferences({ inputMode: null });
      editor.setCameraOptions({ isLocked: false, wheelBehavior: "none", zoomSpeed: 0, panSpeed: 0 });
    }
    return onMount(createTldrawInkEngine(editor));
  }, [annotation, onMount]);

  return (
    <Tldraw
      snapshot={scene as TLEditorSnapshot | TLStoreSnapshot | undefined}
      onMount={mount}
      components={annotation ? COMPONENTS_HIDDEN : music ? COMPONENTS_MUSIC : grid ? COMPONENTS_GRID : COMPONENTS_BLANK}
      shapeUtils={annotation ? ANNOTATION_SHAPE_UTILS : undefined}
      hideUi={annotation || undefined}
      colorScheme={music ? "light" : undefined}
    />
  );
}
