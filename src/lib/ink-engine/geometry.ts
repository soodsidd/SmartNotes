import { getStroke } from "perfect-freehand";
import { INK_COLORS } from "@/lib/ink-engine";
import { INK_WIDTHS, type InkStroke } from "./scene";

export type Point = readonly [x: number, y: number, pressure?: number];
export type Bounds = { left: number; top: number; right: number; bottom: number };

export function boundsOf(points: readonly Point[]): Bounds {
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const [x, y] of points) {
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x);
    bounds.bottom = Math.max(bounds.bottom, y);
  }
  return bounds;
}

export function boxPolygon(a: Point, b: Point): Point[] {
  return [a, [b[0], a[1]], b, [a[0], b[1]]];
}

export function polygonPath(points: readonly Point[]): string {
  return points.length ? `M${points.map(([x, y]) => `${x} ${y}`).join("L")}Z` : "";
}

const palette = new Map(INK_COLORS.map(({ id, hex }) => [id, hex]));
const completedGeometry = new WeakMap<InkStroke, ReturnType<typeof createGeometry>>();

function createGeometry(stroke: InkStroke, complete: boolean) {
  const outline = getStroke(stroke.points.map(([x, y, pressure]) => [x, y, pressure]), {
    size: INK_WIDTHS[stroke.size],
    thinning: 0.62,
    smoothing: 0.62,
    streamline: 0.55,
    // Non-pen pressure is resolved at input time, so reload and export use identical samples.
    simulatePressure: false,
    last: complete,
  });
  return { outline, bounds: boundsOf(outline), path: polygonPath(outline), fill: palette.get(stroke.color)! };
}

export function strokeGeometry(stroke: InkStroke, complete = true) {
  if (!complete) return createGeometry(stroke, false);
  const cached = completedGeometry.get(stroke);
  if (cached) return cached;
  const geometry = createGeometry(stroke, true);
  completedGeometry.set(stroke, geometry);
  return geometry;
}

export function strokeBottom(strokes: readonly InkStroke[]): number | undefined {
  let bottom: number | undefined;
  for (const stroke of strokes) {
    bottom = Math.max(bottom ?? 0, strokeGeometry(stroke).bounds.bottom);
  }
  return bottom;
}

function overlaps(a: Bounds, b: Bounds, margin = 0) {
  return a.left - margin <= b.right && a.right + margin >= b.left
    && a.top - margin <= b.bottom && a.bottom + margin >= b.top;
}

function contains(polygon: readonly Point[], [x, y]: Point) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function crosses(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function segmentHitsPolygon(a: Point, b: Point, polygon: readonly Point[], tolerance: number) {
  if (contains(polygon, a) || contains(polygon, b)) return true;
  return polygon.some((c, index) => {
    const d = polygon[(index + 1) % polygon.length];
    return crosses(a, b, c, d) || distanceToSegment(c, a, b) <= tolerance
      || distanceToSegment(a, c, d) <= tolerance || distanceToSegment(b, c, d) <= tolerance;
  });
}

export function strokeHitsSegment(stroke: InkStroke, a: Point, b: Point, tolerance: number) {
  const { bounds, outline } = strokeGeometry(stroke);
  return overlaps(bounds, boundsOf([a, b]), tolerance) && segmentHitsPolygon(a, b, outline, tolerance);
}

export function strokesInRegion(strokes: readonly InkStroke[], region: readonly Point[]) {
  const regionBounds = boundsOf(region);
  return strokes.filter((stroke) => {
    const { outline, bounds } = strokeGeometry(stroke);
    if (!overlaps(bounds, regionBounds)) return false;
    return contains(region, outline[0]) || region.some((a, index) =>
      segmentHitsPolygon(a, region[(index + 1) % region.length], outline, 0));
  });
}

export function svgForStrokes(strokes: readonly InkStroke[]) {
  if (!strokes.length) return null;
  const geometry = strokes.map((stroke) => strokeGeometry(stroke));
  const bounds = boundsOf(geometry.flatMap(({ bounds }) => [[bounds.left, bounds.top], [bounds.right, bounds.bottom]]));
  const { left, top } = bounds;
  const width = Math.max(1, bounds.right - left);
  const height = Math.max(1, bounds.bottom - top);
  const paths = geometry.map(({ path, fill }) => `<path d="${path}" fill="${fill}"/>`).join("");
  // Print and HTML export place the SVG over the original page coordinate origin.
  const style = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" style="${style}">${paths}</svg>`, width, height };
}
