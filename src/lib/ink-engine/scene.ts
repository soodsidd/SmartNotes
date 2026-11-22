import { INK_COLORS, type InkColor, type InkSize } from "@/lib/ink-engine";

export type InkPoint = readonly [x: number, y: number, pressure: number];
export type InkStroke = Readonly<{
  id: string;
  points: readonly InkPoint[];
  color: InkColor;
  size: InkSize;
  createdAt: number;
}>;

export type SmartNotesInkScene = Readonly<{ version: 2; strokes: readonly InkStroke[] }>;

// SN-154: the original draw theme uses 2px × 1/1.75/2.5/5, scaled by 0.75.
export const INK_WIDTHS: Readonly<Record<InkSize, number>> = { s: 1.5, m: 2.625, l: 3.75, xl: 7.5 };

const colors = new Set<string>(INK_COLORS.map(({ id }) => id));

function isPoint(value: unknown): value is InkPoint {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    && value[2] >= 0 && value[2] <= 1;
}

export function isSmartNotesInkScene(value: unknown): value is SmartNotesInkScene {
  if (!value || typeof value !== "object") return false;
  const scene = value as Partial<SmartNotesInkScene>;
  if (scene.version !== 2 || !Array.isArray(scene.strokes)) return false;
  const ids = new Set<string>();
  for (const stroke of scene.strokes as readonly Partial<InkStroke>[]) {
    if (!stroke || typeof stroke.id !== "string" || !stroke.id || ids.has(stroke.id)
      || !Number.isFinite(stroke.createdAt) || !stroke.color || !colors.has(stroke.color)
      || !stroke.size || !Object.hasOwn(INK_WIDTHS, stroke.size)
      || !Array.isArray(stroke.points) || !stroke.points.length
      || !stroke.points.every(isPoint)) return false;
    ids.add(stroke.id);
  }
  return true;
}

export function translateStroke(stroke: InkStroke, x: number, y: number): InkStroke {
  return { ...stroke, points: stroke.points.map(([px, py, pressure]) => [px + x, py + y, pressure]) };
}
