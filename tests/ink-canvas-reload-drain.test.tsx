/**
 * @jest-environment jsdom
 *
 * SN-416: an installed-PWA worker update reloads the page. Ink strokes still in
 * the autosave debounce must be flushed by the reload guard, not discarded.
 */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { InkCanvas } from "@/components/ink-canvas";
import { __resetReloadGuardForTests, drainBeforeReload } from "@/lib/reload-guard";
import { saveInkScene } from "@/lib/api/ink";

jest.mock("tldraw/tldraw.css", () => ({}), { virtual: true });
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

jest.mock("tldraw", () => {
  const ReactMock = jest.requireActual<typeof import("react")>("react");
  return {
    Tldraw: ({ onMount }: { onMount: (editor: unknown) => void }) => {
      ReactMock.useEffect(() => {
        onMount({
          updateInstanceState: jest.fn(),
          getSnapshot: () => snapshot,
          store: {
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

describe("InkCanvas reload drain (SN-416)", () => {
  beforeEach(() => {
    __resetReloadGuardForTests();
    userChange = null;
    jest.mocked(saveInkScene).mockClear();
  });

  const drain = async () => {
    let result!: Awaited<ReturnType<typeof drainBeforeReload>>;
    await act(async () => { result = await drainBeforeReload(); });
    return result;
  };

  async function mountCanvas(props: Partial<React.ComponentProps<typeof InkCanvas>> = {}) {
    render(<InkCanvas pagePath="Notebook/Section/Sketch.html" {...props} />);
    await waitFor(() => expect(userChange).not.toBeNull());
  }

  it("flushes a stroke still inside the autosave debounce before reload", async () => {
    await mountCanvas();
    act(() => userChange!());
    expect(saveInkScene).not.toHaveBeenCalled();

    const result = await drain();

    expect(result.ok).toBe(true);
    expect(saveInkScene).toHaveBeenCalledWith("Notebook/Section/Sketch.html", snapshot, "blank");
  });

  it("does not write when there are no unsaved strokes", async () => {
    await mountCanvas();
    expect((await drain()).ok).toBe(true);
    expect(saveInkScene).not.toHaveBeenCalled();
  });

  it("fails the drain when the flush cannot reach the server", async () => {
    await mountCanvas();
    jest.mocked(saveInkScene).mockRejectedValueOnce(new Error("offline"));
    act(() => userChange!());

    expect((await drain()).ok).toBe(false);
  });
});
