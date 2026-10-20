/**
 * @jest-environment node
 *
 * SN-140: native camera-capture detection + image-insert menu source guards.
 * SN-340: multi-capture batch-submit session using in-app getUserMedia.
 *         Pending photos accumulate as thumbnails; Submit batch-inserts all;
 *         Cancel discards all and closes the session.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { supportsNativeCameraCapture } from "@/lib/camera-capture";

const EDITOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/rich-text-editor.tsx"),
  "utf8"
);

const OVERLAY_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/camera-session-overlay.tsx"),
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
  test("exposes a gated Take photo item in desktop and mobile insert menus", () => {
    expect(EDITOR_SRC).toContain('"toolbar-camera"');
    expect(EDITOR_SRC).toContain('"toolbar-camera-mobile"');
    expect(EDITOR_SRC).toContain('label="Take photo"');
    expect(EDITOR_SRC).toContain("onTakePhoto ? (");
  });

  test("Take photo handler is only wired when capture support is detected", () => {
    expect(EDITOR_SRC).toContain("cameraCaptureSupported ? handleCameraTakePhoto : undefined");
    expect(EDITOR_SRC).toContain("setCameraCaptureSupported(supportsNativeCameraCapture())");
  });
});

describe("camera session model (SN-340)", () => {
  test("editor opens the camera session overlay via cameraSessionOpen state", () => {
    expect(EDITOR_SRC).toContain("const [cameraSessionOpen, setCameraSessionOpen]");
    expect(EDITOR_SRC).toContain("function handleCameraTakePhoto()");
    expect(EDITOR_SRC).toContain("setCameraSessionOpen(true)");
  });

  test("overlay is rendered conditionally on cameraCaptureSupported && cameraSessionOpen", () => {
    expect(EDITOR_SRC).toContain("cameraCaptureSupported && cameraSessionOpen");
    expect(EDITOR_SRC).toContain("<CameraSessionOverlay");
    expect(EDITOR_SRC).toContain("onSubmit={handleCameraSessionSubmit}");
    expect(EDITOR_SRC).toContain("onCancel={handleCameraSessionCancel}");
  });

  test("submit handler closes session then batch-uploads via handleAssetFilesRef", () => {
    const fn = EDITOR_SRC.indexOf("function handleCameraSessionSubmit");
    expect(fn).toBeGreaterThan(-1);
    const block = EDITOR_SRC.slice(fn, fn + 400);
    expect(block).toContain("setCameraSessionOpen(false)");
    expect(block).toContain("handleAssetFilesRef.current(files)");
    // rAF delay ensures editor regains focus before insert queue starts.
    expect(block).toContain("requestAnimationFrame");
    expect(block).toContain("editor?.commands.focus()");
  });

  test("cancel handler closes session without uploading", () => {
    const fn = EDITOR_SRC.indexOf("function handleCameraSessionCancel");
    expect(fn).toBeGreaterThan(-1);
    const block = EDITOR_SRC.slice(fn, fn + 100);
    expect(block).toContain("setCameraSessionOpen(false)");
    // Must not call handleAssetFiles on cancel.
    expect(block).not.toContain("handleAssetFiles");
  });

  test("no window.focus race or input-capture multi-shot hacks remain", () => {
    expect(EDITOR_SRC).not.toContain('window.addEventListener("focus"');
    expect(EDITOR_SRC).not.toContain("cameraGotFileRef");
    expect(EDITOR_SRC).not.toContain("cameraSessionActiveRef");
    expect(EDITOR_SRC).not.toContain("cameraSessionActive,");
  });
});

describe("CameraSessionOverlay component (SN-340)", () => {
  test("overlay has required testids for shutter, submit, cancel, video", () => {
    expect(OVERLAY_SRC).toContain('data-testid="camera-session-overlay"');
    expect(OVERLAY_SRC).toContain('data-testid="camera-session-video"');
    expect(OVERLAY_SRC).toContain('data-testid="camera-session-shutter"');
    expect(OVERLAY_SRC).toContain('data-testid="camera-session-submit"');
    expect(OVERLAY_SRC).toContain('data-testid="camera-session-cancel"');
    expect(OVERLAY_SRC).toContain('data-testid="camera-session-thumbnails"');
  });

  test("overlay uses getUserMedia with environment camera", () => {
    expect(OVERLAY_SRC).toContain("getUserMedia");
    expect(OVERLAY_SRC).toContain('facingMode: "environment"');
  });

  test("shutter capture writes to canvas and creates a File", () => {
    expect(OVERLAY_SRC).toContain("canvas.getContext");
    expect(OVERLAY_SRC).toContain("ctx.drawImage(video");
    expect(OVERLAY_SRC).toContain("new File([blob]");
    expect(OVERLAY_SRC).toContain("setPendingPhotos");
  });

  test("Submit passes all pending files to onSubmit", () => {
    const fn = OVERLAY_SRC.indexOf("function handleSubmit");
    expect(fn).toBeGreaterThan(-1);
    const block = OVERLAY_SRC.slice(fn, fn + 200);
    expect(block).toContain("onSubmit(pendingPhotos.map");
    expect(block).toContain(".file)");
    expect(block).toContain("getTracks().forEach");
  });

  test("Cancel passes empty array and stops the stream", () => {
    const fn = OVERLAY_SRC.indexOf("function handleCancel");
    expect(fn).toBeGreaterThan(-1);
    const block = OVERLAY_SRC.slice(fn, fn + 150);
    expect(block).toContain("getTracks().forEach");
    expect(block).toContain("onCancel()");
  });

  test("stream is stopped on unmount via useEffect cleanup", () => {
    expect(OVERLAY_SRC).toContain("cancelled = true");
    expect(OVERLAY_SRC).toContain("getTracks().forEach");
  });
});
