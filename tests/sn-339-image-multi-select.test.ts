/**
 * @jest-environment node
 *
 * SN-339: Insert Image file picker must allow selecting multiple images in one
 * action on both desktop and mobile.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const EDITOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/rich-text-editor.tsx"),
  "utf8"
);

describe("image file input allows multi-select (SN-339)", () => {
  test("the image file input has the multiple attribute", () => {
    // Find the image file input block (not the camera capture or attachment inputs)
    const fileInputIdx = EDITOR_SRC.indexOf('ref={fileInputRef}');
    expect(fileInputIdx).toBeGreaterThan(-1);
    // Grab enough context to cover the full input element
    const block = EDITOR_SRC.slice(fileInputIdx, fileInputIdx + 300);
    expect(block).toContain('accept="image/*"');
    expect(block).toContain('multiple');
  });

  test("camera capture input does NOT have multiple (single-shot by design)", () => {
    const captureIdx = EDITOR_SRC.indexOf('data-testid="camera-capture-input"');
    expect(captureIdx).toBeGreaterThan(-1);
    const block = EDITOR_SRC.slice(captureIdx, captureIdx + 300);
    expect(block).toContain('capture="environment"');
    // multiple would break the camera-capture UX; ensure it is absent in this block
    expect(block).not.toContain('multiple');
  });

  test("handleAssetFiles iterates all files in the batch", () => {
    // processAssetFiles uses a for-of loop over the batch array — this verifies
    // the pipeline already processes every file in a multi-file selection.
    expect(EDITOR_SRC).toContain("for (const file of files)");
    expect(EDITOR_SRC).toContain("Array.from(files)");
  });
});
