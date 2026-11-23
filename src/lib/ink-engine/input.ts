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

/** SN-tablet-pinch: a target shape narrow enough for both SVGSVGElement and
 * unit-test doubles, read with native TouchEvent.touches instead of
 * reconstructed per-pointer state (see attachPinchGesture). */
type PinchTouchPoint = { clientX: number; clientY: number };
type PinchTouchEvent = { touches: ArrayLike<PinchTouchPoint> };
export type PinchTarget = {
  addEventListener(type: string, listener: (event: PinchTouchEvent) => void, options?: { passive?: boolean }): void;
  removeEventListener(type: string, listener: (event: PinchTouchEvent) => void): void;
  getBoundingClientRect(): { left: number; top: number };
};

/**
 * SN-tablet-pinch: tldraw drives two-finger pan/zoom off native
 * touchstart/touchmove's `event.touches` — an atomic snapshot of every
 * active finger delivered on a single event (see
 * @tldraw/editor's useGestureEvents). InkPointerInput previously
 * reconstructed the second finger's position from a Map updated across two
 * independent PointerEvent streams; on tablets where multi-touch pointer
 * delivery is uneven between fingers, that starved the distance-ratio math
 * pinch-zoom needs (pan still looked fine since it only needs a rough
 * average). This mirrors tldraw's approach instead of Pointer Events for
 * the two-finger camera gesture specifically; single-finger draw/erase/
 * select stays on InkPointerInput/Pointer Events.
 */
export function attachPinchGesture(target: PinchTarget, engine: SmartNotesInkEngine): () => void {
  let anchor: Point | null = null;
  let distance = 1;
  const read = (t0: PinchTouchPoint, t1: PinchTouchPoint) => {
    const rect = target.getBoundingClientRect();
    const origin: Point = [(t0.clientX + t1.clientX) / 2 - rect.left, (t0.clientY + t1.clientY) / 2 - rect.top];
    return { origin, dist: Math.max(Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY), 1) };
  };
  const start = (event: PinchTouchEvent) => {
    if (event.touches.length !== 2) return;
    const { origin, dist } = read(event.touches[0], event.touches[1]);
    anchor = origin;
    distance = dist;
  };
  const move = (event: PinchTouchEvent) => {
    if (event.touches.length < 2 || !anchor || !engine.canNavigate()) return;
    const { origin, dist } = read(event.touches[0], event.touches[1]);
    engine.setCamera(reanchorCamera(engine.getCamera(), anchor, origin, dist / distance));
    anchor = origin;
    distance = dist;
  };
  const end = (event: PinchTouchEvent) => {
    if (event.touches.length < 2) anchor = null;
  };
  target.addEventListener("touchstart", start, { passive: false });
  target.addEventListener("touchmove", move, { passive: false });
  target.addEventListener("touchend", end);
  target.addEventListener("touchcancel", end);
  return () => {
    target.removeEventListener("touchstart", start);
    target.removeEventListener("touchmove", move);
    target.removeEventListener("touchend", end);
    target.removeEventListener("touchcancel", end);
  };
}

export class InkPointerInput {
  private active: PointerSample | null = null;
  private pressure = 0.5;
  private penMode = false;
  private panning = false;
  private touches = new Map<number, Point>();

  constructor(
    private readonly engine: SmartNotesInkEngine,
    private readonly hostRoutesTouch = false
  ) {}

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
    // AnnotationLayer can cancel a draft and consume the rest of its pointer
    // stream when it takes over a scroll gesture.
    if (this.hostRoutesTouch && !this.engine.isPointing()) this.active = null;
    if (!this.hostRoutesTouch && sample.type === "touch") {
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
      const before = this.touches.get(last.id)!;
      this.touches.set(last.id, last.position);
      // SN-tablet-pinch: two-finger pan/zoom now reads native
      // TouchEvent.touches (attachPinchGesture) rather than this per-pointer
      // Map, since independent PointerEvent streams proved unreliable for
      // simultaneous multi-touch on tablets. A single already-panning finger
      // (e.g. navigating after a pen latch, SN-156) only has one stream to
      // track and stays correct here.
      if (this.panning && this.touches.size === 1 && this.active?.type !== "pen" && this.engine.canNavigate()) {
        this.engine.setCamera(reanchorCamera(this.engine.getCamera(), before, last.position, 1));
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
