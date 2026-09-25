/**
 * @jest-environment jsdom
 */

jest.mock("tldraw/tldraw.css", () => ({}));

import "@testing-library/jest-dom";
import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  AnnotationLayer,
  ANNOTATION_HISTORY_THROTTLE_MS,
  ANNOTATION_INK_STROKE_SCALE,
  ANNOTATION_INK_STROKE_SCALE_META_KEY,
  AnnotationDrawShapeUtil,
  createThrottledHistoryEmitter,
  decidePenAwareTouchGesture,
  getAnnotationHistoryCommand,
  readAnnotationScrollMetrics,
  syncAnnotationCamera,
  twoFingerCentroidY,
} from "@/components/annotation-layer";
import { pageContentCache } from "@/lib/page-content-cache";

const mockStoreListeners: Array<{
  callback: () => void;
  options?: { source?: string; scope?: string };
}> = [];
const mockListen = jest.fn((callback: () => void, options?: { source?: string; scope?: string }) => {
  mockStoreListeners.push({ callback, options });
  return jest.fn();
});
const mockIsPointing = { current: false };
const mockEditors: Array<{
  getSnapshot: jest.Mock;
  loadSnapshot: jest.Mock;
}> = [];

jest.mock("tldraw", () => ({
  Tldraw: function MockTldraw({ onMount }: { onMount?: (editor: unknown) => void }) {
    React.useEffect(() => {
      const editor = {
        updateInstanceState: jest.fn(),
        setCurrentTool: jest.fn(),
        setStyleForNextShapes: jest.fn(),
        undo: jest.fn(),
        redo: jest.fn(),
        clearHistory: jest.fn(),
        cancel: jest.fn(),
        setCameraOptions: jest.fn(),
        setCamera: jest.fn(),
        updateViewportScreenBounds: jest.fn(),
        user: { updateUserPreferences: jest.fn() },
        getCanUndo: jest.fn(() => false),
        getCanRedo: jest.fn(() => false),
        getCurrentPageShapeIds: jest.fn(() => ["shape:draw-1"]),
        getShapePageBounds: jest.fn(() => ({ maxY: 1000 })),
        getSnapshot: jest.fn(() => ({
          document: {
            store: {
              "shape:draw-1": { typeName: "shape", id: "shape:draw-1", type: "draw" },
            },
          },
        })),
        loadSnapshot: jest.fn(() => {
          for (const listener of mockStoreListeners) {
            if (listener.options?.source === "user" && listener.options?.scope === "document") {
              listener.callback();
            }
          }
        }),
        inputs: {
          get isPointing() {
            return mockIsPointing.current;
          },
        },
        store: {
          listen: mockListen,
        },
      };
      mockEditors.push(editor);
      onMount?.(editor);
    }, [onMount]);
    return React.createElement("div", { "data-testid": "mock-tldraw" }, "canvas");
  },
  // AnnotationDrawShapeUtil (SN-154) extends DrawShapeUtil at module load; provide a
  // stub with an options bag so the subclass constructor can spread/override it.
  DrawShapeUtil: class {
    editor: unknown;
    options = {
      maxPointsPerShape: 600,
      getDefaultDisplayValues: () => ({ strokeWidth: 4 }),
      getCustomDisplayValues: () => ({}),
    };
    constructor(editor: unknown) {
      this.editor = editor;
    }
  },
}));

describe("AnnotationDrawShapeUtil (SN-154)", () => {
  const editor = {} as import("tldraw").Editor;
  const theme = {} as Parameters<
    InstanceType<typeof AnnotationDrawShapeUtil>["options"]["getCustomDisplayValues"]
  >[2];

  it("keeps historical draw shapes at the default rendered weight", () => {
    const util = new AnnotationDrawShapeUtil(editor);
    const historicalShape = { meta: {} } as import("tldraw").TLDrawShape;

    expect(util.options.getCustomDisplayValues(editor, historicalShape, theme, "light")).toEqual({});
  });

  it("stamps and scales only newly created draw shapes", () => {
    const util = new AnnotationDrawShapeUtil(editor);
    const nextShape = {
      meta: { source: "annotation-test" },
    } as unknown as import("tldraw").TLDrawShape;

    const createdShape = util.onBeforeCreate(nextShape);

    expect(createdShape.meta).toEqual({
      source: "annotation-test",
      [ANNOTATION_INK_STROKE_SCALE_META_KEY]: ANNOTATION_INK_STROKE_SCALE,
    });
    expect(util.options.getCustomDisplayValues(editor, createdShape, theme, "light")).toEqual({
      strokeWidth: 3,
    });
  });
});

const mockSaveAnnotationsScene = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/api/annotations", () => ({
  fetchAnnotationsScene: jest.fn().mockResolvedValue({ scene: null }),
  parseAnnotationsSidecarJson: jest.fn(() => ({ scene: null })),
  saveAnnotationsScene: (...args: unknown[]) => mockSaveAnnotationsScene(...args),
}));

const INK_SCENE = {
  document: {
    store: {
      "shape:draw-1": { typeName: "shape", id: "shape:draw-1", type: "draw" },
    },
    schema: { schemaVersion: 2, sequences: {} },
  },
};

const CACHED_RETURN_SCENE = {
  document: {
    store: {
      "shape:return-1": { typeName: "shape", id: "shape:return-1", type: "draw" },
    },
    schema: { schemaVersion: 2, sequences: {} },
  },
};

describe("syncAnnotationCamera", () => {
  it("maps scroll offset to negated camera y with force while locked", () => {
    const setCamera = jest.fn();
    const editor = { setCamera } as unknown as import("tldraw").Editor;

    syncAnnotationCamera(editor, 480);

    expect(setCamera).toHaveBeenCalledWith(
      { x: 0, y: -480, z: 1 },
      { immediate: true, force: true }
    );
  });

  it("divides scroll offset by workspace zoom when the frame is scaled", () => {
    const setCamera = jest.fn();
    const editor = { setCamera } as unknown as import("tldraw").Editor;

    syncAnnotationCamera(editor, 300, undefined, 1.5);

    expect(setCamera).toHaveBeenCalledWith(
      { x: 0, y: -200, z: 1 },
      { immediate: true, force: true }
    );
  });
});

describe("twoFingerCentroidY (SN-156)", () => {
  it("returns null for zero or one active touch (single finger keeps drawing)", () => {
    expect(twoFingerCentroidY([])).toBeNull();
    expect(twoFingerCentroidY([{ clientY: 100 }])).toBeNull();
  });

  it("averages the first two touches so a two-finger drag drives scroll", () => {
    expect(twoFingerCentroidY([{ clientY: 100 }, { clientY: 300 }])).toBe(200);
    // Extra fingers past the first two are ignored.
    expect(
      twoFingerCentroidY([{ clientY: 100 }, { clientY: 300 }, { clientY: 999 }])
    ).toBe(200);
  });

  it("delta between successive centroids maps swipe distance to scrollTop", () => {
    const start = twoFingerCentroidY([{ clientY: 400 }, { clientY: 500 }])!; // 450
    const moved = twoFingerCentroidY([{ clientY: 300 }, { clientY: 400 }])!; // 350
    // Fingers moved up 100px -> content scrolls down 100px.
    expect(start - moved).toBe(100);
  });
});

describe("decidePenAwareTouchGesture (SN-156)", () => {
  it("draws with a lone finger while pen mode is off (finger-draw preserved)", () => {
    expect(
      decidePenAwareTouchGesture({ touchCount: 1, penMode: false, penDown: false })
    ).toBe("draw");
  });

  it("pans with a lone finger once pen mode has latched on", () => {
    expect(
      decidePenAwareTouchGesture({ touchCount: 1, penMode: true, penDown: false })
    ).toBe("pan");
  });

  it("always navigates on two fingers regardless of pen mode", () => {
    expect(
      decidePenAwareTouchGesture({ touchCount: 2, penMode: false, penDown: false })
    ).toBe("pan");
    expect(
      decidePenAwareTouchGesture({ touchCount: 2, penMode: true, penDown: false })
    ).toBe("pan");
  });

  it("rejects every touch while the stylus is in contact (palm rejection)", () => {
    // A resting palm during a pen stroke must neither ink nor scroll.
    expect(
      decidePenAwareTouchGesture({ touchCount: 1, penMode: true, penDown: true })
    ).toBe("ignore");
    expect(
      decidePenAwareTouchGesture({ touchCount: 2, penMode: true, penDown: true })
    ).toBe("ignore");
  });

  it("ignores an empty touch set", () => {
    expect(
      decidePenAwareTouchGesture({ touchCount: 0, penMode: true, penDown: false })
    ).toBe("ignore");
  });
});

describe("readAnnotationScrollMetrics", () => {
  it("reads live scroll metrics from the container when available", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollTop", { value: 640, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 720, configurable: true });

    expect(readAnnotationScrollMetrics(container)).toEqual({
      scrollTop: 640,
      viewportHeight: 720,
    });
  });

  it("falls back to props when the container ref is missing", () => {
    expect(
      readAnnotationScrollMetrics(null, { scrollTop: 120, viewportHeight: 480 })
    ).toEqual({
      scrollTop: 120,
      viewportHeight: 480,
    });
  });
});

describe("createThrottledHistoryEmitter", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("throttles history updates during an active stroke", () => {
    const onHistoryChange = jest.fn();
    const editor = {
      getCanUndo: jest.fn(() => true),
      getCanRedo: jest.fn(() => false),
      inputs: { isPointing: true },
    } as unknown as import("tldraw").Editor;

    const emitter = createThrottledHistoryEmitter(editor, onHistoryChange);

    emitter.onDocumentChange();
    emitter.onDocumentChange();
    emitter.onDocumentChange();

    expect(onHistoryChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(ANNOTATION_HISTORY_THROTTLE_MS);

    expect(onHistoryChange).toHaveBeenCalledTimes(1);
    expect(onHistoryChange).toHaveBeenCalledWith({ canUndo: true, canRedo: false });
  });

  it("flushes history immediately when the stroke ends", () => {
    const onHistoryChange = jest.fn();
    const editor = {
      getCanUndo: jest.fn(() => false),
      getCanRedo: jest.fn(() => true),
      inputs: { isPointing: false },
    } as unknown as import("tldraw").Editor;

    const emitter = createThrottledHistoryEmitter(editor, onHistoryChange);

    emitter.onDocumentChange();

    expect(onHistoryChange).toHaveBeenCalledTimes(1);
    expect(onHistoryChange).toHaveBeenCalledWith({ canUndo: false, canRedo: true });
  });
});

describe("getAnnotationHistoryCommand", () => {
  it("maps mod+z to undo", () => {
    expect(
      getAnnotationHistoryCommand({
        key: "z",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      })
    ).toBe("undo");
  });

  it("maps mod+shift+z to redo", () => {
    expect(
      getAnnotationHistoryCommand({
        key: "Z",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
      })
    ).toBe("redo");
  });

  it("maps ctrl+y to redo on non-mac shortcuts", () => {
    expect(
      getAnnotationHistoryCommand({
        key: "y",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      })
    ).toBe("redo");
  });

  it("ignores unrelated shortcuts", () => {
    expect(
      getAnnotationHistoryCommand({
        key: "z",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      })
    ).toBeNull();
  });
});

describe("AnnotationLayer mode toggle", () => {
  beforeEach(() => {
    mockListen.mockClear();
    mockStoreListeners.length = 0;
    mockIsPointing.current = false;
    mockEditors.length = 0;
    mockSaveAnnotationsScene.mockClear();
    pageContentCache.clear();
  });

  it("swaps annotation mode without tearing down the preloaded layer", async () => {
    function Harness() {
      const [mode, setMode] = React.useState<"edit" | "draw">("edit");
      return React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          { type: "button", onClick: () => setMode("draw") },
          "Enter draw"
        ),
        React.createElement(
          "button",
          { type: "button", onClick: () => setMode("edit") },
          "Exit draw"
        ),
        React.createElement(AnnotationLayer, {
          pagePath: "Notebook/Section/page.html",
          mode,
        })
      );
    }

    render(React.createElement(Harness));

    const layer = await screen.findByTestId("annotation-layer");
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-ready", "true");
    });
    expect(screen.getByTestId("mock-tldraw")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Enter draw" }).click();
    });
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-mode", "draw");
    });
    expect(screen.getByTestId("mock-tldraw")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Exit draw" }).click();
    });
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-mode", "edit");
    });
    expect(screen.getByTestId("mock-tldraw")).toBeInTheDocument();
  });

  it("keeps the edit overlay visible when saved ink exists", async () => {
    const { fetchAnnotationsScene } = jest.requireMock("@/lib/api/annotations") as {
      fetchAnnotationsScene: jest.Mock;
    };
    fetchAnnotationsScene.mockResolvedValueOnce({ scene: INK_SCENE });

    render(
      React.createElement(AnnotationLayer, {
        pagePath: "Notebook/Section/inked-page.html",
        mode: "edit",
      })
    );

    const layer = await screen.findByTestId("annotation-layer");
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-ready", "true");
      expect(layer).toHaveAttribute("data-annotation-visible", "true");
    });
  });

  it("publishes the hydrated scene to onSceneChange", async () => {
    const { fetchAnnotationsScene } = jest.requireMock("@/lib/api/annotations") as {
      fetchAnnotationsScene: jest.Mock;
    };
    fetchAnnotationsScene.mockResolvedValueOnce({ scene: INK_SCENE });
    const onSceneChange = jest.fn();

    render(
      React.createElement(AnnotationLayer, {
        pagePath: "Notebook/Section/inked-page.html",
        mode: "edit",
        onSceneChange,
      })
    );

    await screen.findByTestId("annotation-layer");
    await waitFor(() => {
      expect(onSceneChange).toHaveBeenCalledWith(INK_SCENE);
    });
  });

  it("saves to the loaded store path after the pagePath prop changes", async () => {
    jest.useFakeTimers();
    const { fetchAnnotationsScene } = jest.requireMock("@/lib/api/annotations") as {
      fetchAnnotationsScene: jest.Mock;
    };
    let resolveSecondFetch: (value: { scene: unknown }) => void = () => undefined;
    fetchAnnotationsScene
      .mockResolvedValueOnce({ scene: INK_SCENE })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondFetch = resolve;
          })
      );

    const ref = React.createRef<import("@/components/annotation-layer").AnnotationLayerHandle>();

    function Harness() {
      const [path, setPath] = React.useState("Notebook/Section/a.html");
      return React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          { type: "button", onClick: () => setPath("Notebook/Section/b.html") },
          "Switch"
        ),
        React.createElement(AnnotationLayer, { ref, pagePath: path, mode: "draw" })
      );
    }

    render(React.createElement(Harness));
    const layer = await screen.findByTestId("annotation-layer");
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-ready", "true");
      expect(layer).toHaveAttribute("data-annotation-loaded-path", "Notebook/Section/a.html");
    });

    await act(async () => {
      screen.getByRole("button", { name: "Switch" }).click();
    });

    await act(async () => {
      await ref.current?.flush();
    });

    expect(mockSaveAnnotationsScene).toHaveBeenCalledWith(
      "Notebook/Section/a.html",
      expect.objectContaining({ document: expect.any(Object) }),
      expect.any(Number)
    );

    await act(async () => {
      resolveSecondFetch({ scene: null });
      await Promise.resolve();
    });
    jest.useRealTimers();
  });

  it("does not autosave user listeners fired by programmatic page loads", async () => {
    const { fetchAnnotationsScene } = jest.requireMock("@/lib/api/annotations") as {
      fetchAnnotationsScene: jest.Mock;
    };
    fetchAnnotationsScene
      .mockResolvedValueOnce({ scene: null })
      .mockResolvedValueOnce({ scene: INK_SCENE });

    function Harness() {
      const [path, setPath] = React.useState("Notebook/Section/first.html");
      return React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          { type: "button", onClick: () => setPath("Notebook/Section/programmatic.html") },
          "Switch"
        ),
        React.createElement(AnnotationLayer, { pagePath: path, mode: "draw" })
      );
    }

    render(React.createElement(Harness));

    const layer = await screen.findByTestId("annotation-layer");
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-ready", "true");
      expect(layer).toHaveAttribute("data-annotation-loaded-path", "Notebook/Section/first.html");
    });

    await act(async () => {
      screen.getByRole("button", { name: "Switch" }).click();
    });

    await waitFor(() => {
      expect(layer).toHaveAttribute(
        "data-annotation-loaded-path",
        "Notebook/Section/programmatic.html"
      );
    });

    expect(mockEditors[0].loadSnapshot).toHaveBeenCalled();
    expect(mockSaveAnnotationsScene).not.toHaveBeenCalled();
  });

  it("keeps drawing passive until the selected page owns the loaded store", async () => {
    const { fetchAnnotationsScene } = jest.requireMock("@/lib/api/annotations") as {
      fetchAnnotationsScene: jest.Mock;
    };
    let resolveSecondFetch: (value: { scene: unknown }) => void = () => undefined;
    fetchAnnotationsScene
      .mockResolvedValueOnce({ scene: INK_SCENE })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondFetch = resolve;
          })
      );

    function Harness() {
      const [path, setPath] = React.useState("Notebook/Section/a.html");
      return React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          { type: "button", onClick: () => setPath("Notebook/Section/b.html") },
          "Switch"
        ),
        React.createElement(AnnotationLayer, { pagePath: path, mode: "draw" })
      );
    }

    render(React.createElement(Harness));
    const layer = await screen.findByTestId("annotation-layer");
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-loaded-path", "Notebook/Section/a.html");
      expect(layer).not.toHaveClass("annotation-layer-passive");
    });

    await act(async () => {
      screen.getByRole("button", { name: "Switch" }).click();
    });

    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-ready", "false");
      expect(layer).toHaveClass("annotation-layer-passive");
      expect(layer).toHaveAttribute("data-annotation-loaded-path", "Notebook/Section/a.html");
    });

    await act(async () => {
      resolveSecondFetch({ scene: null });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-loaded-path", "Notebook/Section/b.html");
      expect(layer).not.toHaveClass("annotation-layer-passive");
    });
  });

  it("loads the cached return-page scene instead of stale snapshot state", async () => {
    const { fetchAnnotationsScene } = jest.requireMock("@/lib/api/annotations") as {
      fetchAnnotationsScene: jest.Mock;
    };
    fetchAnnotationsScene.mockResolvedValue({ scene: null });

    function Harness() {
      const [path, setPath] = React.useState("Notebook/Section/b.html");
      return React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          { type: "button", onClick: () => setPath("Notebook/Section/a.html") },
          "A"
        ),
        React.createElement(
          "button",
          { type: "button", onClick: () => setPath("Notebook/Section/b.html") },
          "B"
        ),
        React.createElement(AnnotationLayer, { pagePath: path, mode: "draw" })
      );
    }

    render(React.createElement(Harness));
    const layer = await screen.findByTestId("annotation-layer");
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-loaded-path", "Notebook/Section/b.html");
    });

    pageContentCache.set("Notebook/Section/a.html", {
      html: "",
      annotationsReady: true,
      annotationsScene: CACHED_RETURN_SCENE,
    });

    await act(async () => {
      screen.getByRole("button", { name: "A" }).click();
    });
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-loaded-path", "Notebook/Section/a.html");
    });

    await waitFor(() => {
      expect(mockEditors[mockEditors.length - 1].loadSnapshot).toHaveBeenLastCalledWith(
        CACHED_RETURN_SCENE
      );
    });
  });

  it("extends the drawable canvas on live autosave, not only on mode exit", async () => {
    const { fetchAnnotationsScene } = jest.requireMock("@/lib/api/annotations") as {
      fetchAnnotationsScene: jest.Mock;
    };
    fetchAnnotationsScene.mockResolvedValue({ scene: null });
    const onDrawableBottomChange = jest.fn();

    render(
      React.createElement(AnnotationLayer, {
        pagePath: "Notebook/Section/draw.html",
        mode: "draw",
        onDrawableBottomChange,
      })
    );

    const layer = await screen.findByTestId("annotation-layer");
    await waitFor(() => {
      expect(layer).toHaveAttribute("data-annotation-ready", "true");
      expect(layer).toHaveAttribute("data-annotation-loaded-path", "Notebook/Section/draw.html");
    });

    // Simulate a completed user stroke by firing the document-change listener.
    await act(async () => {
      for (const listener of mockStoreListeners) {
        if (listener.options?.source === "user" && listener.options?.scope === "document") {
          listener.callback();
        }
      }
    });

    // The debounced autosave (not a mode switch) should persist the extent =
    // lowest stroke (maxY 1000) + one-page margin (600 floor) and notify the host.
    await waitFor(
      () => {
        expect(mockSaveAnnotationsScene).toHaveBeenCalledWith(
          "Notebook/Section/draw.html",
          expect.objectContaining({ document: expect.any(Object) }),
          1600
        );
      },
      { timeout: 2500 }
    );
    await waitFor(() => expect(onDrawableBottomChange).toHaveBeenCalledWith(1600), {
      timeout: 2500,
    });
  });

});
