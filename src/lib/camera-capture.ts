/**
 * Native camera-capture detection for the image-insert flow (SN-140).
 *
 * We surface a "Take photo" option only when the browser both supports the
 * HTML `capture` attribute on file inputs AND reports a coarse primary pointer
 * (i.e. a touch-first phone/tablet). This keeps desktop browsers on the plain
 * file picker and avoids showing a camera-only path where no camera hand-off
 * exists.
 */

type CaptureDocument = Pick<Document, "createElement">;
type CaptureWindow = Pick<Window, "matchMedia">;

/**
 * Returns true when the current environment can hand off to a native camera
 * capture UI. Dependencies are injectable so the pure logic is unit-testable
 * without a real DOM.
 */
export function supportsNativeCameraCapture(
  win: CaptureWindow | undefined = typeof window !== "undefined" ? window : undefined,
  doc: CaptureDocument | undefined = typeof document !== "undefined" ? document : undefined
): boolean {
  if (!win || !doc) return false;

  let hasCaptureAttr = false;
  try {
    hasCaptureAttr = "capture" in doc.createElement("input");
  } catch {
    hasCaptureAttr = false;
  }
  if (!hasCaptureAttr) return false;

  if (typeof win.matchMedia !== "function") return false;
  try {
    return win.matchMedia("(pointer: coarse)").matches === true;
  } catch {
    return false;
  }
}
