export const FLOATING_BOX_DEFAULT_WIDTH = 360;
export const FLOATING_BOX_DEFAULT_HEIGHT = 48;
export const FLOATING_BOX_MIN_WIDTH = 160;
export const FLOATING_BOX_MIN_HEIGHT = 48;

export type FloatingBoxGeometry = { x: number; y: number; width: number; height: number };

export function normalizeFloatingBoxGeometry(value: Partial<FloatingBoxGeometry>): FloatingBoxGeometry {
  const finite = (number: number | undefined, fallback: number) =>
    typeof number === "number" && Number.isFinite(number) ? Math.round(number) : fallback;
  return {
    x: Math.max(0, finite(value.x, 0)),
    y: Math.max(0, finite(value.y, 0)),
    width: Math.max(FLOATING_BOX_MIN_WIDTH, finite(value.width, FLOATING_BOX_DEFAULT_WIDTH)),
    height: Math.max(FLOATING_BOX_MIN_HEIGHT, finite(value.height, FLOATING_BOX_DEFAULT_HEIGHT)),
  };
}

export function moveFloatingBox(geometry: FloatingBoxGeometry, dx: number, dy: number): FloatingBoxGeometry {
  return normalizeFloatingBoxGeometry({ ...geometry, x: geometry.x + dx, y: geometry.y + dy });
}

export function resizeFloatingBox(geometry: FloatingBoxGeometry, dx: number, dy: number): FloatingBoxGeometry {
  return normalizeFloatingBoxGeometry({ ...geometry, width: geometry.width + dx, height: geometry.height + dy });
}
