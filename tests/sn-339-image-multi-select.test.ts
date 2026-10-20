/**
 * @jest-environment node
 *
 * SN-339 rework: Insert Image file picker must allow selecting multiple images
 * in one action on desktop and mobile; all selected images are added to the note.
 *
 * Rework 1 (cycle 2): SN-340 removed the native capture input in favour of the
 * CameraSessionOverlay. Tests updated accordingly; batch pre-read and rAF settle
 * added to the pipeline.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const EDITOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/rich-text-editor.tsx"),
  "utf8"
);

const CONFIG_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/lib/rich-text-editor-config.ts"),
  "utf8"
);

describe("image file input allows multi-select (SN-339)", () => {
  test("the image file input has the multiple attribute", () => {
    const fileInputIdx = EDITOR_SRC.indexOf("ref={fileInputRef}");
    expect(fileInputIdx).toBeGreaterThan(-1);
    const block = EDITOR_SRC.slice(fileInputIdx, fileInputIdx + 300);
    expect(block).toContain('accept="image/*"');
    expect(block).toContain("multiple");
  });

  test("SN-340 removed the native capture input; camera uses CameraSessionOverlay", () => {
    // The old <input capture="environment"> was replaced by the in-app getUserMedia
    // overlay in SN-340 rework 2. Verify the native capture input is gone so a
    // future refactor cannot accidentally re-introduce a single-shot capture input
    // that would block multi-select on mobile.
    expect(EDITOR_SRC).not.toContain('capture="environment"');
    expect(EDITOR_SRC).toContain("CameraSessionOverlay");
    expect(EDITOR_SRC).toContain("cameraSessionOpen");
  });

  test("processAssetFiles pre-reads all files then uploads+inserts serially", () => {
    // Parallel pre-read (Promise.allSettled) followed by a serial loop.
    expect(EDITOR_SRC).toContain("Promise.allSettled");
    expect(EDITOR_SRC).toContain("readFileForUpload");
    // Serial insert loop driven by index so progress labels work.
    expect(EDITOR_SRC).toContain("for (let i = 0; i < supported.length; i++)");
  });

  test("processAssetFiles waits one rAF between inserts for render reliability", () => {
    // A requestAnimationFrame settle between successive image inserts prevents
    // ProseMirror transactions from firing before the previous image is committed
    // to the DOM (SN-339 render-reliability fix).
    expect(EDITOR_SRC).toContain("requestAnimationFrame(() => resolve())");
    expect(EDITOR_SRC).toContain("i < supported.length - 1");
  });

  test("processAssetFiles shows batch progress label for multi-file uploads", () => {
    // "image 2/3" style label gives the user feedback on multi-image progress.
    expect(EDITOR_SRC).toContain("image ${i + 1}/${total}");
    expect(EDITOR_SRC).toContain("Inserted ${progressLabel}");
  });

  test("uploadEditorAssetFromBlob exists for the pre-read upload path", () => {
    expect(CONFIG_SRC).toContain("uploadEditorAssetFromBlob");
  });
});
