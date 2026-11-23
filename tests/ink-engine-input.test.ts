import { SmartNotesInkEngine } from "@/lib/ink-engine/engine";
import {
  attachPinchGesture,
  InkPointerInput,
  pageToScreen,
  pointerSamples,
  screenToPage,
  type PinchTarget,
  type PointerSample,
} from "@/lib/ink-engine/input";

const sample = (id: number, type: string, x: number, y: number, pressure = 0.5, time = 0): PointerSample =>
  ({ id, type, position: [x, y], pressure, time });

describe("Smart Notes pointer input and camera", () => {
  it("reads coalesced pen samples in order through CSS scale and the host camera", () => {
    const engine = new SmartNotesInkEngine();
    const input = new InkPointerInput(engine);
    const camera = { x: 10, y: -20, z: 2 };
    engine.setCamera(camera);
    const event = {
      clientX: 180, clientY: 160, pointerType: "pen", pointerId: 1, pressure: 0.8, timeStamp: 12,
      getCoalescedEvents: () => [
        { clientX: 140, clientY: 120, pressure: 0.3, timeStamp: 4 },
        { clientX: 160, clientY: 140, pressure: 0.6, timeStamp: 8 },
        { clientX: 180, clientY: 160, pressure: 0.8, timeStamp: 12 },
      ],
    } as PointerEvent;
    const points = pointerSamples(event, { left: 100, top: 80, width: 400, height: 400 }, 200, 200);
    input.down(sample(1, "pen", 10, 10, 0.2));
    input.move(points);
    input.up(sample(1, "pen", 40, 40, 0, 13));
    expect(engine.getScene().strokes[0].points).toEqual([[-5, 25, 0.2], [0, 30, 0.3], [5, 35, 0.6], [10, 40, 0.8]]);
    expect(pageToScreen(screenToPage([120, 60], camera), camera)).toEqual([120, 60]);
    expect(input.wheel([100, 100], 0, 20, false)).toBe(false);
    expect(engine.getCamera()).toEqual(camera);
  });

  it("simulates pressure for both mouse and finger and rejects a palm during pen contact", () => {
    const engine = new SmartNotesInkEngine(true);
    const input = new InkPointerInput(engine);
    for (const [index, type] of ["mouse", "touch"].entries()) {
      input.down(sample(index, type, 10, 10));
      input.move([sample(index, type, 13, 10, 0.5, 10), sample(index, type, 80, 10, 0.5, 12)]);
      input.up(sample(index, type, 80, 10, 0, 13));
    }
    for (const stroke of engine.getScene().strokes) {
      expect(stroke.points[1][2]).toBeGreaterThan(stroke.points[2][2]);
    }
    input.down(sample(3, "pen", 30, 30, 0.75));
    expect(input.down(sample(4, "touch", 40, 40))).toBe(false);
    input.move([sample(4, "touch", 50, 50)]);
    input.up(sample(3, "pen", 30, 30, 0));
    expect(engine.getStrokeCount()).toBe(3);
    expect(engine.getCamera()).toEqual({ x: 0, y: 0, z: 1 });

    input.down(sample(5, "touch", 40, 40));
    input.move([sample(5, "touch", 50, 50)]);
    input.up(sample(5, "touch", 50, 50));
    expect(engine.getStrokeCount()).toBe(3);
    expect(engine.getCamera()).toEqual({ x: 10, y: 10, z: 1 });
    input.reset();
    input.down(sample(6, "touch", 40, 40));
    input.up(sample(6, "touch", 40, 40));
    expect(engine.getStrokeCount()).toBe(4);
  });

  it("cancels the first finger's partial stroke once a second finger touches down, and keeps panning with the last finger remaining", () => {
    // SN-tablet-pinch: two-finger pan/zoom math moved to attachPinchGesture
    // (native TouchEvent.touches, tested below) since independent
    // PointerEvent streams proved unreliable for simultaneous multi-touch on
    // tablets. While both fingers are down, InkPointerInput itself must not
    // move the camera (no update on the two moves below) - but once a second
    // finger lifts, the one remaining finger has only a single stream to
    // track and correctly keeps panning via Pointer Events, same as before.
    const engine = new SmartNotesInkEngine(true);
    const input = new InkPointerInput(engine);
    input.down(sample(1, "touch", 0, 0));
    input.down(sample(2, "touch", 100, 0));
    input.move([sample(2, "touch", 200, 0)]);
    input.move([sample(1, "touch", 0, 20)]);
    expect(engine.getCamera()).toEqual({ x: 0, y: 0, z: 1 });
    input.up(sample(2, "touch", 200, 20));
    input.move([sample(1, "touch", 20, 40)]);
    input.up(sample(1, "touch", 20, 40));
    expect(engine.getCamera()).toEqual({ x: 20, y: 20, z: 1 });
    expect(engine.getStrokeCount()).toBe(0);
    expect(engine.canUndo()).toBe(false);
  });

  it("attachPinchGesture pans and zooms the camera from native touch events, independent of pointer tracking", () => {
    // SN-tablet-pinch regression: on tablets, two independent PointerEvent
    // streams (one per finger) can deliver unevenly, starving the distance
    // ratio pinch-zoom needs even though pan (a rough average) still looked
    // fine. This exercises the same math (reanchorCamera) but driven purely
    // by touchstart/touchmove's `touches` snapshot, like tldraw does.
    const engine = new SmartNotesInkEngine(true);
    type Listener = (event: { touches: { clientX: number; clientY: number }[] }) => void;
    const listeners = new Map<string, Listener>();
    const target: PinchTarget = {
      addEventListener: (type, listener) => listeners.set(type, listener as Listener),
      removeEventListener: (type) => listeners.delete(type),
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    };
    const detach = attachPinchGesture(target, engine);
    listeners.get("touchstart")!({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });
    listeners.get("touchmove")!({ touches: [{ clientX: 0, clientY: 0 }, { clientX: 200, clientY: 0 }] });
    expect(engine.getCamera()).toEqual({ x: 0, y: 0, z: 2 });
    listeners.get("touchmove")!({ touches: [{ clientX: 0, clientY: 20 }, { clientX: 200, clientY: 20 }] });
    expect(engine.getCamera().z).toBeCloseTo(2);
    expect(pageToScreen([50, 0], engine.getCamera())[1]).toBeCloseTo(20);
    detach();
    expect(listeners.size).toBe(0);
  });

  it("wheel-pans, zooms at the cursor and respects the host camera lock", () => {
    const engine = new SmartNotesInkEngine(true);
    const input = new InkPointerInput(engine);
    const anchor = [100, 100] as const;
    input.wheel(anchor, 10, 25, false);
    expect(engine.getCamera()).toEqual({ x: -10, y: -25, z: 1 });
    const before = screenToPage(anchor, engine.getCamera());
    input.wheel(anchor, 0, -200, true);
    expect(engine.getCamera().z).toBeGreaterThan(1);
    expect(screenToPage(anchor, engine.getCamera())).toEqual(before);
    engine.lockCamera();
    expect(input.wheel(anchor, 0, -200, true)).toBe(false);
    engine.setCamera({ x: 0, y: 0, z: 0.75 });
    expect(engine.getCamera().z).toBe(0.75);
  });
});
