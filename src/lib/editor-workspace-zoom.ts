import type { CSSProperties } from "react";

export const EDITOR_ZOOM_MIN = 0.5;
export const EDITOR_ZOOM_MAX = 2;
export const EDITOR_ZOOM_DEFAULT = 1;
export const EDITOR_ZOOM_WHEEL_STEP = 0.05;

export type EditorWorkspacePan = {
  x: number;
  y: number;
};

export const EDITOR_PAN_DEFAULT: EditorWorkspacePan = { x: 0, y: 0 };

export function clampEditorZoom(value: number): number {
  return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, Number(value.toFixed(2))));
}

/** Positive deltaY (scroll down) zooms out; negative zooms in. */
export function adjustEditorZoomFromWheel(current: number, deltaY: number): number {
  const direction = deltaY < 0 ? 1 : -1;
  return clampEditorZoom(current + direction * EDITOR_ZOOM_WHEEL_STEP);
}

export function applyWorkspacePan(
  start: EditorWorkspacePan,
  deltaX: number,
  deltaY: number
): EditorWorkspacePan {
  return { x: start.x + deltaX, y: start.y + deltaY };
}

export function editorZoomSpacerStyle(
  zoom: number,
  contentHeight: number
): CSSProperties | undefined {
  if (zoom === EDITOR_ZOOM_DEFAULT) return undefined;
  return {
    width: `${zoom * 100}%`,
    ...(contentHeight > 0 ? { minHeight: contentHeight * zoom } : undefined),
  };
}

export function editorZoomSurfaceStyle(
  zoom: number,
  pan: EditorWorkspacePan = EDITOR_PAN_DEFAULT
): CSSProperties | undefined {
  const hasPan = pan.x !== 0 || pan.y !== 0;
  if (zoom === EDITOR_ZOOM_DEFAULT && !hasPan) return undefined;

  const transforms: string[] = [];
  if (hasPan) {
    transforms.push(`translate(${pan.x}px, ${pan.y}px)`);
  }
  if (zoom !== EDITOR_ZOOM_DEFAULT) {
    transforms.push(`scale(${zoom})`);
  }

  return {
    transform: transforms.join(" "),
    transformOrigin: "top left",
    width: zoom !== EDITOR_ZOOM_DEFAULT ? `${100 / zoom}%` : undefined,
  };
}

export function shouldEnableWorkspacePan(zoom: number): boolean {
  return zoom !== EDITOR_ZOOM_DEFAULT;
}

/** Ctrl/Cmd+wheel (incl. trackpad pinch) triggers workspace zoom, not ink-camera zoom. */
export function isWorkspaceZoomWheel(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}

export type EditorScrollOffset = {
  left: number;
  top: number;
};

/** Middle-mouse drag pans by inverting pointer delta into scroll offsets. */
export function applyScrollPan(
  start: EditorScrollOffset,
  deltaX: number,
  deltaY: number
): EditorScrollOffset {
  return {
    left: Math.max(0, start.left - deltaX),
    top: Math.max(0, start.top - deltaY),
  };
}
