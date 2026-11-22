export type PenAwareTouchAction = "draw" | "pan" | "ignore";

/** SN-156: reject palms during pen contact and route fingers to navigation after the pen latch. */
export function decidePenAwareTouchGesture({ touchCount, penMode, penDown }: {
  touchCount: number;
  penMode: boolean;
  penDown: boolean;
}): PenAwareTouchAction {
  if (penDown) return "ignore";
  if (touchCount >= 2) return "pan";
  if (touchCount === 1) return penMode ? "pan" : "draw";
  return "ignore";
}
