import type { Editor } from "tldraw";
import { AUTO_GROW_BOTTOM_MARGIN_PX } from "@/lib/page-frame";

/** Sidecar / editor snapshots may be raw TLStoreSnapshot or TLEditorSnapshot wrapper. */
function storeRecordsFromSnapshot(snapshot: unknown): Record<string, unknown> | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const snap = snapshot as { document?: { store?: unknown }; store?: unknown };
  const nested = snap.document?.store;
  if (nested && typeof nested === "object") {
    return nested as Record<string, unknown>;
  }
  const direct = snap.store;
  if (direct && typeof direct === "object") {
    return direct as Record<string, unknown>;
  }
  return undefined;
}

function shapeRecordBottom(record: unknown): number | null {
  if (!record || typeof record !== "object") return null;
  const shape = record as {
    typeName?: string;
    type?: string;
    y?: number;
    props?: { h?: number; segments?: Array<{ points?: Array<{ x: number; y: number }> }> };
  };
  if (shape.typeName !== "shape") return null;

  if (shape.type === "draw" && Array.isArray(shape.props?.segments)) {
    let maxY = Number.NEGATIVE_INFINITY;
    for (const segment of shape.props.segments) {
      for (const point of segment.points ?? []) {
        maxY = Math.max(maxY, point.y);
      }
    }
    if (Number.isFinite(maxY)) {
      return shape.y! + maxY;
    }
  }

  const height = shape.props?.h;
  if (typeof shape.y === "number" && typeof height === "number") {
    return shape.y + height;
  }

  return null;
}

export function computeStrokeBottomFromSnapshot(snapshot: unknown): number | undefined {
  const store = storeRecordsFromSnapshot(snapshot);
  if (!store) return undefined;

  let maxBottom = 0;
  let found = false;
  for (const record of Object.values(store)) {
    const bottom = shapeRecordBottom(record);
    if (bottom == null) continue;
    found = true;
    maxBottom = Math.max(maxBottom, bottom);
  }

  return found ? maxBottom : undefined;
}

export function computeDrawableBottomFromEditor(
  editor: Editor,
  margin: number = AUTO_GROW_BOTTOM_MARGIN_PX
): number | undefined {
  const shapeIds = [...editor.getCurrentPageShapeIds()];
  if (shapeIds.length === 0) return undefined;

  let maxBottom = 0;
  let found = false;
  for (const id of shapeIds) {
    const bounds = editor.getShapePageBounds(id);
    if (!bounds) continue;
    found = true;
    maxBottom = Math.max(maxBottom, bounds.maxY);
  }

  if (!found) return undefined;
  return Math.ceil(maxBottom + margin);
}

export function computeDrawableBottomFromSnapshot(
  snapshot: unknown,
  margin: number = AUTO_GROW_BOTTOM_MARGIN_PX
): number | undefined {
  const strokeBottom = computeStrokeBottomFromSnapshot(snapshot);
  if (strokeBottom == null) return undefined;
  return Math.ceil(strokeBottom + margin);
}
