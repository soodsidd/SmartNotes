import type { InkCamera, InkColor, InkDocument, InkEngine, InkSize, InkTool } from "@/lib/ink-engine";
import { boxPolygon, strokeBottom, strokeHitsSegment, strokesInRegion, svgForStrokes, type Point } from "./geometry";
import { isSmartNotesInkScene, translateStroke, type InkPoint, type InkStroke, type SmartNotesInkScene } from "./scene";

type DrawGesture = { kind: "draw"; stroke: InkStroke; points: InkPoint[] };
type EraseGesture = { kind: "erase"; last: Point; ids: Set<string> };
type SelectGesture = { kind: "box" | "lasso"; points: Point[] };
type MoveGesture = { kind: "move"; start: Point; offset: readonly [number, number] };
type Gesture = DrawGesture | EraseGesture | SelectGesture | MoveGesture;

const HISTORY_LIMIT = 100;
const DEFAULT_CAMERA: InkCamera = { x: 0, y: 0, z: 1 };
const INVALID_REMAP = { ok: false, reason: "Cannot adjust ink safely: drawable extent would become invalid." } as const;

let nextStrokeId = 0;

function createStrokeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${++nextStrokeId}-${Math.random().toString(36).slice(2)}`;
}

export class SmartNotesInkEngine implements InkEngine {
  private strokes: readonly InkStroke[] = [];
  private document: InkDocument = {};
  private past: (readonly InkStroke[])[] = [];
  private future: (readonly InkStroke[])[] = [];
  private documentListeners = new Set<() => void>();
  private sessionListeners = new Set<() => void>();
  private viewListeners = new Set<() => void>();
  private version = 0;
  private gesture: Gesture | null = null;
  private selected = new Set<string>();
  private tool: InkTool = "draw";
  private color: InkColor = "black";
  private size: InkSize = "m";
  private selectionMode: "box" | "lasso" = "box";
  private readOnly = false;
  private grid = false;
  private camera = DEFAULT_CAMERA;
  private cameraLocked = false;

  constructor(private readonly internalNavigation = false) {}

  subscribe(listener: () => void, scope = "document") {
    const listeners = scope === "document" ? this.documentListeners : this.sessionListeners;
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  subscribeView = (listener: () => void) => {
    this.viewListeners.add(listener);
    return () => { this.viewListeners.delete(listener); };
  };
  getViewVersion = () => this.version;

  private notify(session = true) {
    this.version++;
    for (const listener of this.viewListeners) listener();
    if (session) for (const listener of this.sessionListeners) listener();
  }

  private replace(strokes: readonly InkStroke[], userEdit: boolean) {
    this.strokes = strokes;
    this.document = Object.fromEntries(strokes.map((stroke) => [stroke.id, stroke]));
    this.selected = new Set([...this.selected].filter((id) => Object.hasOwn(this.document, id)));
    this.notify();
    if (userEdit) for (const listener of this.documentListeners) listener();
  }

  private commit(strokes: readonly InkStroke[]) {
    this.past.push(this.strokes);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.replace(strokes, true);
  }

  loadScene(scene: unknown) {
    if (scene != null && !isSmartNotesInkScene(scene)) throw new Error("Invalid Smart Notes ink scene.");
    const strokes = (scene?.strokes ?? []).map((stroke) => ({
      id: stroke.id,
      points: stroke.points.map(([x, y, pressure]): InkPoint => [x, y, pressure]),
      color: stroke.color,
      size: stroke.size,
      createdAt: stroke.createdAt,
    }));
    this.past = [];
    this.future = [];
    this.selected.clear();
    this.gesture = null;
    this.replace(strokes, false);
  }

  getScene(): SmartNotesInkScene { return { version: 2, strokes: this.strokes }; }
  getDocument(): InkDocument { return this.document; }
  getStrokeCount() { return this.strokes.length; }
  getStrokeBottom() { return strokeBottom(this.strokes); }
  async toSvg(strokeIds?: readonly string[]) {
    const ids = strokeIds && new Set(strokeIds);
    return svgForStrokes(ids ? this.strokes.filter(({ id }) => ids.has(id)) : this.strokes);
  }

  translateStrokesY(deltaY: number, acceptBottom: (bottom: number | undefined) => boolean) {
    if (!Number.isFinite(deltaY)) return INVALID_REMAP;
    if (!this.strokes.length || !deltaY) return { ok: true, count: 0 } as const;
    const shift = (strokes: readonly InkStroke[]) => strokes.map((stroke) => translateStroke(stroke, 0, deltaY));
    const next = shift(this.strokes);
    if (!isSmartNotesInkScene({ version: 2, strokes: next }) || !acceptBottom(strokeBottom(next))) return INVALID_REMAP;
    // Reflow changes the page coordinate system for every undo/redo state.
    this.past = this.past.map(shift);
    this.future = this.future.map(shift);
    this.replace(next, false);
    return { ok: true, count: next.length } as const;
  }

  setTool(tool: InkTool) {
    if (this.tool === tool) return;
    this.gesture = null;
    this.selected.clear();
    this.tool = tool;
    this.notify();
  }

  getTool() { return this.tool; }
  setColor(color: InkColor) {
    if (this.color === color) return;
    this.color = color;
    this.notify();
  }
  getColor() { return this.color; }
  setSize(size: InkSize) {
    if (this.size === size) return;
    this.size = size;
    this.notify();
  }
  getSize() { return this.size; }
  setSelectionMode(mode: "box" | "lasso") {
    this.selectionMode = mode;
    this.notify();
  }
  getSelectionMode() { return this.selectionMode; }
  hasSelection() { return this.selected.size > 0; }

  setReadOnly(readOnly: boolean) {
    if (this.readOnly === readOnly) return;
    this.readOnly = readOnly;
    this.gesture = null;
    this.selected.clear();
    this.notify();
  }
  isReadOnly() { return this.readOnly; }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }
  undo() {
    if (this.readOnly || !this.canUndo()) return;
    this.gesture = null;
    this.future.push(this.strokes);
    this.replace(this.past.pop()!, true);
  }
  redo() {
    if (this.readOnly || !this.canRedo()) return;
    this.gesture = null;
    this.past.push(this.strokes);
    this.replace(this.future.pop()!, true);
  }
  clearHistory() {
    this.past = [];
    this.future = [];
    this.notify();
  }

  setCamera(camera: InkCamera) {
    if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y) || !Number.isFinite(camera.z) || camera.z <= 0) return;
    if (this.camera.x === camera.x && this.camera.y === camera.y && this.camera.z === camera.z) return;
    this.camera = { ...camera };
    this.notify();
  }
  getCamera() { return this.camera; }
  updateViewport() {
    // The surface reads its current SVG bounds during every pointer event.
  }
  lockCamera() { this.cameraLocked = true; }
  canNavigate() { return this.internalNavigation && !this.cameraLocked && !this.readOnly; }

  setGridVisible(visible: boolean) {
    if (this.grid === visible) return;
    this.grid = visible;
    this.notify();
  }
  isGridVisible() { return this.grid; }

  isPointing() { return this.gesture !== null; }
  cancel() {
    if (!this.gesture) return;
    this.gesture = null;
    this.notify(false);
  }

  private hit(point: Point, tolerance: number) {
    return this.strokes.findLast((stroke) => strokeHitsSegment(stroke, point, point, tolerance));
  }

  begin(point: InkPoint, tolerance: number, lasso = false) {
    if (this.readOnly) return;
    if (this.tool === "draw") {
      const points = [point];
      const stroke = { id: createStrokeId(), points, color: this.color, size: this.size, createdAt: Date.now() };
      this.gesture = { kind: "draw", stroke, points };
    } else if (this.tool === "eraser") {
      this.gesture = { kind: "erase", last: point, ids: new Set() };
      this.extendErase(this.gesture, point, tolerance);
    } else {
      const hit = this.hit(point, tolerance);
      if (hit) {
        if (!this.selected.has(hit.id)) this.selected = new Set([hit.id]);
        this.gesture = { kind: "move", start: point, offset: [0, 0] };
      } else {
        this.selected.clear();
        this.gesture = { kind: lasso ? "lasso" : this.selectionMode, points: [point] };
      }
    }
    this.notify(false);
  }

  private extendErase(gesture: EraseGesture, point: Point, tolerance: number) {
    for (const stroke of this.strokes) {
      if (!gesture.ids.has(stroke.id) && strokeHitsSegment(stroke, gesture.last, point, tolerance)) {
        gesture.ids.add(stroke.id);
      }
    }
    gesture.last = point;
  }

  extend(points: readonly InkPoint[], tolerance: number) {
    const gesture = this.gesture;
    if (!gesture || !points.length) return;
    const end = points[points.length - 1];
    switch (gesture.kind) {
      case "draw":
        for (const point of points) {
          const previous = gesture.points[gesture.points.length - 1];
          if (previous.some((value, index) => value !== point[index])) gesture.points.push(point);
        }
        break;
      case "erase":
        for (const point of points) this.extendErase(gesture, point, tolerance);
        break;
      case "box":
        gesture.points[1] = end;
        break;
      case "lasso":
        gesture.points.push(...points);
        break;
      case "move":
        gesture.offset = [end[0] - gesture.start[0], end[1] - gesture.start[1]];
        break;
    }
    this.notify(false);
  }

  private region(gesture: SelectGesture) {
    if (gesture.kind === "lasso") return gesture.points;
    return gesture.points.length > 1 ? boxPolygon(gesture.points[0], gesture.points[1]) : [];
  }

  finish() {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    switch (gesture.kind) {
      case "draw":
        this.commit([...this.strokes, gesture.stroke]);
        return;
      case "erase":
        if (gesture.ids.size) {
          this.commit(this.strokes.filter(({ id }) => !gesture.ids.has(id)));
          return;
        }
        break;
      case "move":
        if (gesture.offset[0] || gesture.offset[1]) {
          this.commit(this.strokes.map((stroke) => this.selected.has(stroke.id) ? translateStroke(stroke, ...gesture.offset) : stroke));
          return;
        }
        break;
      default: {
        const region = this.region(gesture);
        if (region.length >= 3) this.selected = new Set(strokesInRegion(this.strokes, region).map(({ id }) => id));
      }
    }
    this.notify(false);
  }

  deleteSelected() {
    if (this.readOnly || !this.selected.size) return;
    this.gesture = null;
    this.commit(this.strokes.filter(({ id }) => !this.selected.has(id)));
  }

  getPaint() {
    const gesture = this.gesture;
    return {
      strokes: gesture?.kind === "erase" ? this.strokes.filter(({ id }) => !gesture.ids.has(id)) : this.strokes,
      draft: gesture?.kind === "draw" ? gesture.stroke : undefined,
      selected: this.selected as ReadonlySet<string>,
      offset: gesture?.kind === "move" ? gesture.offset : undefined,
      region: gesture?.kind === "box" || gesture?.kind === "lasso" ? this.region(gesture) : undefined,
    };
  }

  inspectPaint(host: HTMLElement | null) {
    const paths = host?.querySelectorAll<SVGPathElement>("[data-sn-ink-stroke]");
    const path = paths?.item(Math.max(0, (paths?.length ?? 1) - 1));
    const box = path?.getBoundingClientRect();
    return {
      pathCount: paths?.length ?? 0,
      pathHasGeometry: Boolean(path?.getAttribute("d")),
      pathWidth: box ? Math.round(box.width) : 0,
      pathHeight: box ? Math.round(box.height) : 0,
      pathFill: path?.getAttribute("fill") ?? null,
      pathStroke: path?.getAttribute("stroke") ?? null,
    };
  }
}
