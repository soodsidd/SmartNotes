import {
  adjustEditorZoomFromWheel,
  applyScrollPan,
  applyWorkspacePan,
  clampEditorZoom,
  EDITOR_PAN_DEFAULT,
  EDITOR_ZOOM_DEFAULT,
  EDITOR_ZOOM_MAX,
  EDITOR_ZOOM_MIN,
  editorZoomSpacerStyle,
  editorZoomSurfaceStyle,
  isWorkspaceZoomWheel,
  shouldEnableWorkspacePan,
} from "@/lib/editor-workspace-zoom";

describe("editor workspace zoom (SN-113)", () => {
  test("clamps zoom within min and max bounds", () => {
    expect(clampEditorZoom(0.1)).toBe(EDITOR_ZOOM_MIN);
    expect(clampEditorZoom(5)).toBe(EDITOR_ZOOM_MAX);
    expect(clampEditorZoom(1)).toBe(1);
  });

  test("wheel delta adjusts zoom in the expected direction", () => {
    expect(adjustEditorZoomFromWheel(1, -100)).toBeGreaterThan(1);
    expect(adjustEditorZoomFromWheel(1, 100)).toBeLessThan(1);
  });

  test("default zoom does not emit surface style", () => {
    expect(editorZoomSurfaceStyle(EDITOR_ZOOM_DEFAULT)).toBeUndefined();
  });

  test("non-default zoom scales content frame width inversely from top-left", () => {
    const style = editorZoomSurfaceStyle(1.25);
    expect(style?.transform).toBe("scale(1.25)");
    expect(style?.width).toBe("80%");
    expect(style?.transformOrigin).toBe("top left");
  });

  test("zoom spacer grows scrollable area with zoom", () => {
    expect(editorZoomSpacerStyle(1.5, 800)).toEqual({
      width: "150%",
      minHeight: 1200,
    });
  });

  test("workspace pan applies pointer deltas", () => {
    expect(applyWorkspacePan(EDITOR_PAN_DEFAULT, 12, -8)).toEqual({ x: 12, y: -8 });
  });

  test("pan translate is included in surface style", () => {
    const style = editorZoomSurfaceStyle(1.25, { x: 10, y: 20 });
    expect(style?.transform).toBe("translate(10px, 20px) scale(1.25)");
  });

  test("pan is only enabled when zoomed", () => {
    expect(shouldEnableWorkspacePan(EDITOR_ZOOM_DEFAULT)).toBe(false);
    expect(shouldEnableWorkspacePan(1.5)).toBe(true);
  });

  test("middle-mouse scroll pan inverts pointer delta", () => {
    expect(applyScrollPan({ left: 100, top: 50 }, 20, 10)).toEqual({
      left: 80,
      top: 40,
    });
  });

  test("workspace zoom wheel is ctrl or meta", () => {
    expect(isWorkspaceZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isWorkspaceZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(isWorkspaceZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});
