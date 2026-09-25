/**
 * @jest-environment node
 *
 * SN-140: native camera-capture detection + image-insert menu source guards.
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
    expect(EDITOR_SRC).toContain(
      "cameraCaptureSupported ? () => cameraInputRef.current?.click() : undefined"
    );
    expect(EDITOR_SRC).toContain("setCameraCaptureSupported(supportsNativeCameraCapture())");
  });
});
