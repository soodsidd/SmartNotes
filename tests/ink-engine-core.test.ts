import { INK_COLORS, inkDocumentsMatch } from "@/lib/ink-engine";
import { SmartNotesInkEngine } from "@/lib/ink-engine/engine";
import { strokeGeometry } from "@/lib/ink-engine/geometry";
import { INK_WIDTHS, isSmartNotesInkScene, type InkPoint, type InkStroke } from "@/lib/ink-engine/scene";

const point = (x: number, y: number, pressure = 0.5): InkPoint => [x, y, pressure];

function gesture(engine: SmartNotesInkEngine, points: InkPoint[], lasso = false) {
  engine.begin(points[0], 1, lasso);
  engine.extend(points.slice(1), 1);
  engine.finish();
}

function drawLine(engine: SmartNotesInkEngine, y: number) {
  gesture(engine, [point(20, y), point(40, y), point(60, y)]);
}

describe("Smart Notes ink scene and editing", () => {
  it("uses the palette and SN-154 base weights, producing wider outlines at higher pressures", async () => {
    expect(INK_WIDTHS).toEqual({ s: 1.5, m: 2.625, l: 3.75, xl: 7.5 });
    const engine = new SmartNotesInkEngine();
    for (const [index, { id }] of INK_COLORS.entries()) {
      engine.setColor(id);
      drawLine(engine, 10 + index * 20);
    }
    const exported = await engine.toSvg();
    for (const { hex } of INK_COLORS) expect(exported?.svg).toContain(`fill="${hex}"`);

    const getHeight = (size: InkStroke["size"], pressure: number) => {
      const { bounds } = strokeGeometry({
        id: "pen", color: "black", size, createdAt: 0,
        points: [point(0, 0, pressure), point(30, 0, pressure), point(60, 0, pressure)],
      });
      return bounds.bottom - bounds.top;
    };
    const widths = Object.keys(INK_WIDTHS).map((size) => getHeight(size as InkStroke["size"], 0.5));
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths).size).toBe(4);
    expect(getHeight("xl", 0.9)).toBeGreaterThan(getHeight("xl", 0.1) * 1.5);
  });

  it("erases whole strokes across a swept segment and records one undo step", () => {
    const engine = new SmartNotesInkEngine();
    const changed = jest.fn();
    const off = engine.subscribe(changed);
    drawLine(engine, 20);
    drawLine(engine, 40);
    const before = engine.getDocument();
    engine.setTool("eraser");
    engine.begin(point(40, 10), 1);
    engine.extend([point(40, 60)], 1);
    expect(engine.getPaint().strokes).toHaveLength(0);
    expect(engine.getStrokeCount()).toBe(2);
    engine.finish();
    expect(engine.getStrokeCount()).toBe(0);
    engine.undo();
    expect(inkDocumentsMatch(engine.getDocument(), before)).toBe(true);
    engine.redo();
    expect(engine.getStrokeCount()).toBe(0);
    expect(changed).toHaveBeenCalledTimes(5);
    off();
  });

  it("selects by tap, box and lasso, and can move and delete selections with undo and redo", () => {
    const engine = new SmartNotesInkEngine();
    drawLine(engine, 20);
    drawLine(engine, 40);
    drawLine(engine, 80);
    engine.setTool("select");
    gesture(engine, [point(35, 80)]);
    expect(engine.getPaint().selected.size).toBe(1);
    gesture(engine, [point(5, 10), point(70, 50)]);
    expect(engine.getPaint().selected.size).toBe(2);
    gesture(engine, [point(35, 20), point(44, 25)]);
    expect(engine.getScene().strokes.map((stroke) => stroke.points[0])).toEqual([
      point(29, 25), point(29, 45), point(20, 80),
    ]);
    engine.undo();
    expect(engine.getScene().strokes[0].points[0]).toEqual(point(20, 20));
    engine.redo();
    gesture(engine, [point(15, 55), point(65, 55), point(65, 95), point(15, 95)], true);
    expect(engine.getPaint().selected.size).toBe(1);
    engine.deleteSelected();
    expect(engine.getStrokeCount()).toBe(2);
    engine.undo();
    expect(engine.getStrokeCount()).toBe(3);
    engine.redo();
    expect(engine.getStrokeCount()).toBe(2);
  });

  it("round-trips v2 page coordinates, exports identical geometry and clears history on load", async () => {
    const engine = new SmartNotesInkEngine();
    drawLine(engine, 30);
    drawLine(engine, 70);
    const scene = JSON.parse(JSON.stringify(engine.getScene()));
    expect(isSmartNotesInkScene(scene)).toBe(true);
    expect(isSmartNotesInkScene({ ...scene, strokes: [scene.strokes[0], scene.strokes[0]] })).toBe(false);
    expect(isSmartNotesInkScene({ version: 2, strokes: [{ ...scene.strokes[0], points: [[0, 0, 5]] }] })).toBe(false);
    engine.undo();
    expect(engine.canUndo()).toBe(true);
    expect(engine.canRedo()).toBe(true);
    const edited = jest.fn();
    engine.subscribe(edited);
    engine.loadScene(scene);
    expect(engine.getScene()).toEqual(scene);
    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(false);
    expect(edited).not.toHaveBeenCalled();
    const [first, second] = engine.getScene().strokes;
    const selected = await engine.toSvg([second.id]);
    expect(selected?.svg).toContain(strokeGeometry(second).path);
    expect(selected?.svg).not.toContain(strokeGeometry(first).path);
    expect(await engine.toSvg([])).toBeNull();
    engine.setCamera({ x: -3, y: -40, z: 2 });
    expect(await engine.toSvg([second.id])).toEqual(selected);
    expect(engine.getScene()).toEqual(scene);
  });

  it("applies a page reflow atomically while preserving the edit history in the new coordinates", () => {
    const engine = new SmartNotesInkEngine();
    drawLine(engine, 30);
    drawLine(engine, 70);
    expect(engine.translateStrokesY(50, () => false).ok).toBe(false);
    expect(engine.getScene().strokes[0].points[0]).toEqual(point(20, 30));
    engine.setReadOnly(true);
    expect(engine.translateStrokesY(50, (bottom) => !!bottom && bottom > 120)).toEqual({ ok: true, count: 2 });
    gesture(engine, [point(4, 4)]);
    engine.undo();
    expect(engine.getStrokeCount()).toBe(2);
    engine.setReadOnly(false);
    engine.undo();
    expect(engine.getScene().strokes[0].points[0]).toEqual(point(20, 80));
    engine.undo();
    expect(engine.canUndo()).toBe(false);
    engine.redo();
    expect(engine.getScene().strokes[0].points[0]).toEqual(point(20, 80));
  });
});
