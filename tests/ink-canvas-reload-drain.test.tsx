/**
 * @jest-environment jsdom
 *
 * SN-416: an installed-PWA worker update reloads the page. Ink strokes still in
 * the autosave debounce must be flushed by the reload guard, not discarded.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InkCanvas, type InkCanvasHandle } from "@/components/ink-canvas";
import { __resetReloadGuardForTests, drainBeforeReload } from "@/lib/reload-guard";
import { saveInkScene } from "@/lib/api/ink";
import { SmartNotesInkEngine } from "@/lib/ink-engine/engine";

jest.mock("tldraw/tldraw.css", () => ({}));
jest.mock("@/lib/draw-mode-debug", () => ({ logDrawEvent: jest.fn() }));
jest.mock("@/lib/api/ink", () => ({
  fetchInkScene: jest.fn().mockResolvedValue({ scene: null, backgroundMode: "blank" }),
  parseInkSidecarJson: jest.fn(),
  saveInkScene: jest.fn().mockResolvedValue(undefined),
}));

let userChange: (() => void) | null = null;
const snapshot = {
  document: { store: { "shape:a": { typeName: "shape", type: "draw" } } },
};
let documentRecords: Record<string, { typeName: string; type: string }> = {};

function drawStroke(notify = true) {
  documentRecords = snapshot.document.store;
  if (notify) userChange?.();
}

jest.mock("tldraw", () => {
  const ReactMock = jest.requireActual<typeof import("react")>("react");
  return {
    DrawShapeUtil: class {},
    Tldraw: ({ onMount }: { onMount: (editor: unknown) => void }) => {
      ReactMock.useEffect(() => {
        onMount({
          updateInstanceState: jest.fn(),
          getSnapshot: () => ({ document: { store: documentRecords } }),
          store: {
            serialize: () => ({ ...documentRecords }),
            listen: (fn: () => void) => {
              userChange = fn;
              return () => { userChange = null; };
            },
          },
        });
      }, [onMount]);
      return null;
    },
  };
});

describe.each(["tldraw", "smart-notes"] as const)("InkCanvas reload drain (SN-416) with %s", (inkEngine) => {
  let smartEditor: SmartNotesInkEngine | undefined;
  let strokeNumber: number;

  beforeEach(() => {
    __resetReloadGuardForTests();
    userChange = null;
    documentRecords = {};
    smartEditor = undefined;
    strokeNumber = 0;
    jest.mocked(saveInkScene).mockClear();
    const loadScene = SmartNotesInkEngine.prototype.loadScene;
    jest.spyOn(SmartNotesInkEngine.prototype, "loadScene").mockImplementation(function (this: SmartNotesInkEngine, scene) {
      smartEditor = this;
      loadScene.call(this, scene);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const drain = async () => {
    let result!: Awaited<ReturnType<typeof drainBeforeReload>>;
    await act(async () => { result = await drainBeforeReload(); });
    return result;
  };

  async function mountCanvas(props: Partial<React.ComponentProps<typeof InkCanvas>> = {}) {
    render(<InkCanvas pagePath="Notebook/Section/Sketch.html" inkEngine={inkEngine} {...props} />);
    await waitFor(() => expect(inkEngine === "smart-notes" ? smartEditor : userChange).toBeTruthy());
  }

  function commitStroke(notify = true) {
    if (!smartEditor) {
      drawStroke(notify);
      return;
    }
    const y = ++strokeNumber * 10;
    smartEditor.begin([10, y, 0.5], 5);
    smartEditor.extend([[30, y, 0.5]], 5);
    smartEditor.finish();
  }

  function savedScene() {
    return smartEditor?.getScene() ?? snapshot;
  }

  function expectLastSave(scene: unknown, mode: "grid" | "blank") {
    const args = ["Notebook/Section/Sketch.html", scene, mode];
    if (inkEngine === "smart-notes") args.push(inkEngine);
    expect(saveInkScene).toHaveBeenLastCalledWith(...args);
  }

  it("flushes a stroke still inside the autosave debounce before reload", async () => {
    await mountCanvas();
    act(() => commitStroke());
    expect(saveInkScene).not.toHaveBeenCalled();

    const result = await drain();

    expect(result.ok).toBe(true);
    expectLastSave(savedScene(), "blank");
  });

  it("does not write when there are no unsaved strokes", async () => {
    await mountCanvas();
    expect((await drain()).ok).toBe(true);
    expect(saveInkScene).not.toHaveBeenCalled();
  });

  it("fails the drain when the flush cannot reach the server", async () => {
    await mountCanvas();
    jest.mocked(saveInkScene).mockRejectedValueOnce(new Error("offline"));
    act(() => commitStroke());

    expect((await drain()).ok).toBe(false);
  });

  it("saves pending ink before navigation and retries a failed write", async () => {
    const ref = React.createRef<InkCanvasHandle>();
    await mountCanvas({ handleRef: ref });
    await act(async () => { await ref.current!.flushPending(); });
    expect(saveInkScene).not.toHaveBeenCalled();

    act(() => commitStroke(false));
    jest.mocked(saveInkScene).mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await expect(ref.current!.flushPending()).rejects.toThrow("Failed to save ink scene.");
      await ref.current!.flushPending();
      await ref.current!.flushPending();
    });
    expect(saveInkScene).toHaveBeenCalledTimes(2);
    expectLastSave(savedScene(), "blank");
  });

  it("serializes grid toggles and saves strokes added during a write before reloading", async () => {
    await mountCanvas();
    let finishWrite!: () => void;
    jest.mocked(saveInkScene).mockReturnValueOnce(new Promise((resolve) => { finishWrite = resolve; }));

    fireEvent.click(screen.getByRole("button", { name: "Show grid" }));
    expect(saveInkScene).toHaveBeenCalledTimes(1);
    act(() => commitStroke());
    fireEvent.click(screen.getByRole("button", { name: "Hide grid" }));
    expect(saveInkScene).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishWrite();
      expect((await drainBeforeReload()).ok).toBe(true);
    });

    expect(saveInkScene).toHaveBeenCalledTimes(2);
    expectLastSave(savedScene(), "blank");
  });
});
