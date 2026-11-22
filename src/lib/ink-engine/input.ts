import type { InkCamera } from "@/lib/ink-engine";
import { decidePenAwareTouchGesture } from "@/lib/pen-aware-touch";
import type { SmartNotesInkEngine } from "./engine";
import type { Point } from "./geometry";
import type { InkPoint } from "./scene";

export type PointerSample = {
  id: number;
  type: string;
  position: Point;
  pressure: number;
  time: number;
};

export function screenToPage([x, y]: Point, camera: InkCamera): [number, number] {
  return [x / camera.z - camera.x, y / camera.z - camera.y];
}

export function pageToScreen([x, y]: Point, camera: InkCamera): Point {
  return [(x + camera.x) * camera.z, (y + camera.y) * camera.z];
}

export function reanchorCamera(camera: InkCamera, before: Point, after: Point, scale: number): InkCamera {
  const [x, y] = screenToPage(before, camera);
  const z = Math.min(8, Math.max(0.1, camera.z * scale));
  return { x: after[0] / z - x, y: after[1] / z - y, z };
}

/** Read every delivered sample. Chromium can include the dispatch event as the last sample. */
export function pointerSamples(event: PointerEvent, bounds: { left: number; top: number; width: number; height: number }, width: number, height: number): PointerSample[] {
  const scaleX = bounds.width > 0 && width > 0 ? width / bounds.width : 1;
  const scaleY = bounds.height > 0 && height > 0 ? height / bounds.height : 1;
  const events = event.getCoalescedEvents?.() ?? [];
  const last = events[events.length - 1];
  const samples = last && last.clientX === event.clientX && last.clientY === event.clientY && last.pressure === event.pressure
    ? events : [...events, event];
  return samples.map((sample) => ({
    id: event.pointerId,
    type: event.pointerType,
    position: [(sample.clientX - bounds.left) * scaleX, (sample.clientY - bounds.top) * scaleY],
    pressure: sample.pressure,
    time: sample.timeStamp,
  }));
}

function touchAnchor(touches: ReadonlyMap<number, Point>) {
  const [a, b] = touches.values();
  if (!b) return { center: a, distance: 0 };
  return {
    center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Point,
    distance: Math.hypot(a[0] - b[0], a[1] - b[1]),
  };
}

export class InkPointerInput {
  private active: PointerSample | null = null;
  private pressure = 0.5;
  private penMode = false;
  private panning = false;
  private touches = new Map<number, Point>();

  constructor(private readonly engine: SmartNotesInkEngine) {}

  reset = () => {
    this.active = null;
    this.penMode = false;
    this.panning = false;
    this.touches.clear();
    this.engine.cancel();
  };

  private tolerance() {
    return (this.engine.getTool() === "eraser" ? 8 : 5) / this.engine.getCamera().z;
  }

  private point(sample: PointerSample, finish = false): InkPoint {
    if (sample.type === "pen") {
      if (!finish || sample.pressure > 0) this.pressure = Math.max(0, Math.min(1, sample.pressure));
    } else if (this.active && !finish) {
      // Resolve simulated pressure from speed once, then keep it in the v2 scene.
      const [x, y] = sample.position;
      const [prevX, prevY] = this.active.position;
      const speed = Math.hypot(x - prevX, y - prevY) / Math.max(1, sample.time - this.active.time);
      this.pressure += (Math.max(0.16, 0.72 - speed * 0.28) - this.pressure) * 0.35;
    }
    this.active = sample;
    return [...screenToPage(sample.position, this.engine.getCamera()), this.pressure];
  }

  down(sample: PointerSample, lasso = false): boolean {
    if (this.engine.isReadOnly()) return false;
    if (sample.type === "touch") {
      const action = decidePenAwareTouchGesture({
        touchCount: this.touches.size + 1,
        penMode: this.penMode,
        penDown: this.active?.type === "pen",
      });
      if (action === "ignore") return false;
      this.touches.set(sample.id, sample.position);
      if (action === "pan" || this.panning) {
        if (this.active?.type === "touch") {
          this.engine.cancel();
          this.active = null;
        }
        this.panning = true;
        return true;
      }
    }
    if (sample.type === "pen") {
      this.penMode = true;
      if (this.active?.type === "touch") {
        this.engine.cancel();
        this.active = null;
      }
      if (this.touches.size) this.panning = true;
    }
    if (this.active) return false;
    this.pressure = 0.5;
    this.engine.begin(this.point(sample), this.tolerance(), lasso);
    return true;
  }

  move(samples: readonly PointerSample[]) {
    const last = samples[samples.length - 1];
    if (!last || this.engine.isReadOnly()) return;
    if (last.type === "touch" && this.touches.has(last.id)) {
      const before = touchAnchor(this.touches);
      this.touches.set(last.id, last.position);
      if (this.panning && this.active?.type !== "pen" && this.engine.canNavigate()) {
        const after = touchAnchor(this.touches);
        const scale = before.distance && after.distance ? after.distance / before.distance : 1;
        this.engine.setCamera(reanchorCamera(this.engine.getCamera(), before.center, after.center, scale));
      }
    }
    if (this.active?.id === last.id) {
      this.engine.extend(samples.map((sample) => this.point(sample)), this.tolerance());
    }
  }

  up(sample: PointerSample, cancelled = false) {
    if (sample.type === "touch") {
      this.touches.delete(sample.id);
      if (!this.touches.size) this.panning = false;
    }
    if (this.active?.id !== sample.id) return;
    if (cancelled) {
      this.engine.cancel();
    } else {
      this.engine.extend([this.point(sample, true)], this.tolerance());
      this.engine.finish();
    }
    this.active = null;
  }

  wheel(position: Point, dx: number, dy: number, zoom: boolean): boolean {
    if (!this.engine.canNavigate()) return false;
    if (this.active) return true;
    const after: Point = zoom ? position : [position[0] - dx, position[1] - dy];
    this.engine.setCamera(reanchorCamera(this.engine.getCamera(), position, after, zoom ? Math.exp(-dy * 0.002) : 1));
    return true;
  }
}
