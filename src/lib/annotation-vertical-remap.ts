/**
 * Vertical ink remap for prose reflow (SN-220).
 * Text-page annotations are page-space Tldraw shapes — they do not auto-reflow
 * with HTML. Inserting/updating/removing a top-of-page TOC must shift every
 * shape (and drawableBottom) by the same Y delta as the prose height change.
 */

import { computeDrawableBottomFromSnapshot } from "@/lib/annotation-extent";
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function annotationSceneHasInk(snapshot: unknown): boolean {
  const store = storeRecordsFromSnapshot(snapshot);
  if (!store) return false;
  return Object.values(store).some((record) => {
    if (!record || typeof record !== "object") return false;
    return (record as { typeName?: string }).typeName === "shape";
  });
}

export type RemapAnnotationResult =
  | { ok: true; scene: unknown; drawableBottom?: number }
  | { ok: false; reason: string };

/**
 * Shift every annotation shape by `deltaY` page-space pixels and advance
 * `drawableBottom` by the same amount when provided (or recompute from strokes).
 */
export function remapAnnotationSceneVertical(
  snapshot: unknown,
  deltaY: number,
  drawableBottom?: number,
  margin: number = AUTO_GROW_BOTTOM_MARGIN_PX
): RemapAnnotationResult {
  if (!Number.isFinite(deltaY)) {
    return {
      ok: false,
      reason: "Cannot adjust ink safely: vertical shift is invalid.",
    };
  }

  if (deltaY === 0 || snapshot == null) {
    return {
      ok: true,
      scene: snapshot,
      drawableBottom:
        drawableBottom != null && Number.isFinite(drawableBottom)
          ? Math.ceil(drawableBottom)
          : drawableBottom,
    };
  }

  const hasInk = annotationSceneHasInk(snapshot);
  if (!hasInk) {
    const nextBottom =
      drawableBottom != null && Number.isFinite(drawableBottom)
        ? Math.ceil(drawableBottom + deltaY)
        : drawableBottom;
    return { ok: true, scene: snapshot, drawableBottom: nextBottom };
  }

  const store = storeRecordsFromSnapshot(snapshot);
  if (!store) {
    return {
      ok: false,
      reason: "Cannot adjust ink safely: annotation scene is unreadable.",
    };
  }

  let scene: unknown;
  try {
    scene = cloneJson(snapshot);
  } catch {
    return {
      ok: false,
      reason: "Cannot adjust ink safely: annotation scene could not be copied.",
    };
  }

  const nextStore = storeRecordsFromSnapshot(scene);
  if (!nextStore) {
    return {
      ok: false,
      reason: "Cannot adjust ink safely: annotation scene is unreadable.",
    };
  }

  for (const record of Object.values(nextStore)) {
    if (!record || typeof record !== "object") continue;
    const shape = record as { typeName?: string; y?: unknown };
    if (shape.typeName !== "shape") continue;
    if (typeof shape.y !== "number" || !Number.isFinite(shape.y)) {
      return {
        ok: false,
        reason: "Cannot adjust ink safely: a stroke is missing a valid page position.",
      };
    }
    shape.y = shape.y + deltaY;
  }

  let nextDrawableBottom: number | undefined;
  if (drawableBottom != null && Number.isFinite(drawableBottom)) {
    nextDrawableBottom = Math.ceil(drawableBottom + deltaY);
  } else {
    nextDrawableBottom = computeDrawableBottomFromSnapshot(scene, margin);
  }

  if (nextDrawableBottom != null && nextDrawableBottom < 0) {
    return {
      ok: false,
      reason: "Cannot adjust ink safely: drawable extent would become invalid.",
    };
  }

  return { ok: true, scene, drawableBottom: nextDrawableBottom };
}

export const TOC_INK_REFUSE_PREFIX = "Cannot adjust ink safely";
