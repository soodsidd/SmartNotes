/**
 * @jest-environment node
 *
 * SN-140: native camera-capture detection + image-insert menu source guards.
 * SN-340: multi-capture session — explicit "Take another / Done" bar replaces
 *         the brittle window.focus + timeout approach.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { supportsNativeCameraCapture } from "@/lib/camera-capture";

const EDITOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/rich-text-editor.tsx"),
  "utf8"
);

type Matches = { matches: boolean };

function fakeWindow(coarse: boolean): { matchMedia: (q: string) => Matches } {
  return {
    matchMedia: (query: string): Matches => ({
      matches: query.includes("coarse") ? coarse : false,
    }),
  };
}

function fakeDoc(hasCapture: boolean): { createElement: () => Record<string, unknown> } {
  return {
    createElement: () => (hasCapture ? { capture: "" } : {}),
  };
}

describe("supportsNativeCameraCapture (SN-140)", () => {
  test("returns true on a coarse-pointer device with capture support", () => {
    expect(
      supportsNativeCameraCapture(fakeWindow(true) as never, fakeDoc(true) as never)
    ).toBe(true);
  });

  test("returns false on desktop (fine pointer) even with capture support", () => {
    expect(
      supportsNativeCameraCapture(fakeWindow(false) as never, fakeDoc(true) as never)
    ).toBe(false);
  });

  test("returns false when the capture attribute is unsupported", () => {
    expect(
      supportsNativeCameraCapture(fakeWindow(true) as never, fakeDoc(false) as never)
    ).toBe(false);
  });

  test("returns false when window or document is unavailable (SSR)", () => {
    expect(supportsNativeCameraCapture(undefined, fakeDoc(true) as never)).toBe(false);
    expect(supportsNativeCameraCapture(fakeWindow(true) as never, undefined)).toBe(false);
  });

  test("returns false when matchMedia is missing", () => {
    expect(
      supportsNativeCameraCapture({} as never, fakeDoc(true) as never)
    ).toBe(false);
  });
});

describe("image-insert camera capture wiring (SN-140)", () => {
  test("renders a hidden capture=environment image input", () => {
    expect(EDITOR_SRC).toContain('data-testid="camera-capture-input"');
    expect(EDITOR_SRC).toContain('capture="environment"');
  });

  test("exposes a gated Take photo item in desktop and mobile insert menus", () => {
    expect(EDITOR_SRC).toContain('"toolbar-camera"');
    expect(EDITOR_SRC).toContain('"toolbar-camera-mobile"');
    expect(EDITOR_SRC).toContain('label="Take photo"');
    // The menu item must be conditional on onTakePhoto so desktop hides it.
    expect(EDITOR_SRC).toContain("onTakePhoto ? (");
  });

  test("capture path reuses the shared asset upload pipeline", () => {
    const captureInputStart = EDITOR_SRC.indexOf('data-testid="camera-capture-input"');
    expect(captureInputStart).toBeGreaterThan(-1);
    const captureInputBlock = EDITOR_SRC.slice(captureInputStart, captureInputStart + 400);
    expect(captureInputBlock).toContain("handleAssetFiles(e.target.files)");
  });

  test("Take photo handler is only wired when capture support is detected", () => {
    // SN-340: handleCameraTakePhoto drives the capture; the gate is still
    // cameraCaptureSupported so desktop never sees the Take photo item.
    expect(EDITOR_SRC).toContain("cameraCaptureSupported ? handleCameraTakePhoto : undefined");
    expect(EDITOR_SRC).toContain("setCameraCaptureSupported(supportsNativeCameraCapture())");
  });

  test("camera onChange starts the session on successful capture (SN-340)", () => {
    const captureInputStart = EDITOR_SRC.indexOf('data-testid="camera-capture-input"');
    expect(captureInputStart).toBeGreaterThan(-1);
    const captureInputBlock = EDITOR_SRC.slice(captureInputStart, captureInputStart + 400);
    // Successful capture must activate the session bar (no window.focus timing).
    expect(captureInputBlock).toContain("setCameraSessionActive(true)");
  });
});

describe("multi-capture session bar (SN-340)", () => {
  test("session bar element is defined with correct testids", () => {
    expect(EDITOR_SRC).toContain('data-testid="camera-session-bar"');
    expect(EDITOR_SRC).toContain('data-testid="camera-session-take-another"');
    expect(EDITOR_SRC).toContain('data-testid="camera-session-done"');
  });

  test("session bar uses cameraSessionActive state (not a ref)", () => {
    expect(EDITOR_SRC).toContain("const [cameraSessionActive, setCameraSessionActive]");
    // No brittle window.focus or fixed timeout in the capture path.
    expect(EDITOR_SRC).not.toContain("cameraGotFileRef");
    expect(EDITOR_SRC).not.toContain("cameraSessionActiveRef");
  });

  test("session bar Done button calls setCameraSessionActive(false)", () => {
    const barStart = EDITOR_SRC.indexOf('data-testid="camera-session-done"');
    expect(barStart).toBeGreaterThan(-1);
    const barBlock = EDITOR_SRC.slice(barStart, barStart + 300);
    expect(barBlock).toContain("setCameraSessionActive(false)");
  });

  test("session bar Take-another button re-clicks the camera input", () => {
    const barStart = EDITOR_SRC.indexOf('data-testid="camera-session-take-another"');
    expect(barStart).toBeGreaterThan(-1);
    const barBlock = EDITOR_SRC.slice(barStart, barStart + 300);
    expect(barBlock).toContain("cameraInputRef.current?.click()");
  });

  test("handleCameraTakePhoto is defined and window.focus approach is gone", () => {
    expect(EDITOR_SRC).toContain("function handleCameraTakePhoto()");
    expect(EDITOR_SRC).not.toContain("function openNativeCamera()");
    expect(EDITOR_SRC).not.toContain("function startCameraSession()");
    // Confirm window.focus timing was removed.
    expect(EDITOR_SRC).not.toContain('window.addEventListener("focus"');
  });
});
