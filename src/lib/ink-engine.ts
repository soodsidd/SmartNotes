export type InkEngineId = "tldraw" | "smart-notes";
export type InkTool = "draw" | "eraser" | "select";
export type InkSize = "s" | "m" | "l" | "xl";
export type InkColor = "black" | "blue" | "red" | "green" | "orange" | "violet";

export const INK_COLORS: { id: InkColor; hex: string }[] = [
  { id: "black", hex: "#1c1a17" },
  { id: "blue", hex: "#2563eb" },
  { id: "red", hex: "#dc2626" },
  { id: "green", hex: "#16a34a" },
  { id: "orange", hex: "#ea580c" },
  { id: "violet", hex: "#7e22ce" },
];

/** An opaque sidecar payload owned by the engine that created it. */
export type InkScene = unknown;
export type InkDocument = Readonly<Record<string, unknown>>;
export type InkCamera = { x: number; y: number; z: number };

export interface InkEngine {
  loadScene(scene: InkScene): void;
  getScene(): InkScene;
  /** Immutable records for checking live edits before change listeners run. */
  getDocument(): InkDocument;
  setTool(tool: InkTool): void;
  getTool(): string | null;
  setColor(color: InkColor): void;
  setSize(size: InkSize): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  clearHistory(): void;
  setReadOnly(readOnly: boolean): void;
  setCamera(camera: InkCamera, options?: { immediate?: boolean; force?: boolean }): void;
  updateViewport(viewport: HTMLElement): void;
  lockCamera(): void;
  setGridVisible(visible: boolean): void;
  subscribe(listener: () => void, scope?: "document" | "session"): () => void;
  isPointing(): boolean;
  cancel(): void;
  getStrokeCount(): number;
  getStrokeBottom(): number | undefined;
  translateStrokesY(
    deltaY: number,
    acceptBottom: (bottom: number | undefined) => boolean
  ): { ok: true; count: number } | { ok: false; reason: string };
  toSvg(): Promise<{ svg: string; width: number; height: number } | null>;
  inspectPaint(host: HTMLElement | null): {
    pathCount: number;
    pathHasGeometry: boolean;
    pathWidth: number;
    pathHeight: number;
    pathFill: string | null;
    pathStroke: string | null;
  };
}

export function inkDocumentsMatch(a: InkDocument, b: InkDocument): boolean {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => a[id] === b[id]);
}

export function getInkHistoryCommand(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }

  if (!event.metaKey && !event.shiftKey && key === "y") {
    return "redo";
  }

  return null;
}
