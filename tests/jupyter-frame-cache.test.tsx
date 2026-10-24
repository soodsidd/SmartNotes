/** @jest-environment jsdom */

import * as React from "react";
import { act, render, waitFor } from "@testing-library/react";

jest.mock("@/lib/api/jupyter", () => ({
  launchJupyterSession: jest.fn(async (pagePath: string) => ({
    status: "ready",
    pagePath,
    url: `/api/jupyter/proxy/${encodeURIComponent(pagePath)}/lab?token=test`,
  })),
  launchJupyterWorkspaceSession: jest.fn(),
  stopJupyterWorkspaceSession: jest.fn(async () => ({ stopped: true })),
  warmJupyterFastLaneSession: jest.fn(),
  closeJupyterFastLaneSession: jest.fn(),
}));

import { JupyterNotebookView, type JupyterNotebookBridgeController } from "@/components/jupyter-notebook-view";
import { JUPYTER_FOCUS_MESSAGE_SOURCE, type JupyterFocusState } from "@/lib/jupyter-focus";
import {
  dropDeepWorkPendingJupyterFrames,
  JUPYTER_FRAME_CACHE_LIMIT,
  jupyterFrameIdentity,
  pruneJupyterFrames,
  reloadJupyterFrame,
  touchJupyterFrame,
  type JupyterFrameEntry,
} from "@/lib/jupyter-frame-cache";

type Entry = JupyterFrameEntry<string | undefined>;

function frame(pagePath: string, rootPath?: string) {
  return { identity: jupyterFrameIdentity(pagePath, rootPath), pagePath, title: pagePath, workspace: rootPath };
}

describe("Jupyter frame cache (SN-348)", () => {
  it("keeps the most recent frames under the LRU cap and evicts the oldest", () => {
    expect(JUPYTER_FRAME_CACHE_LIMIT).toBe(3);
    let entries: Entry[] = [];
    for (const page of ["a", "b", "c"]) entries = touchJupyterFrame(entries, frame(page));
    expect(entries.map((entry) => entry.pagePath)).toEqual(["a", "b", "c"]);

    // Returning to "a" makes it most recent without remounting it.
    entries = touchJupyterFrame(entries, frame("a"));
    expect(entries.map((entry) => entry.pagePath)).toEqual(["b", "c", "a"]);

    // A fourth page evicts the least recently used frame ("b").
    entries = touchJupyterFrame(entries, frame("d"));
    expect(entries.map((entry) => entry.pagePath)).toEqual(["c", "a", "d"]);
  });

  it("returns the same array when the active frame is already most recent", () => {
    const entries = touchJupyterFrame(touchJupyterFrame([] as Entry[], frame("a")), frame("b"));
    expect(touchJupyterFrame(entries, frame("b"))).toBe(entries);
    expect(pruneJupyterFrames(entries, new Set(["a", "b"]))).toBe(entries);
  });

  it("replaces a page's frame when its bound root changes (SN-347 identity)", () => {
    let entries = touchJupyterFrame([] as Entry[], frame("page", "C:/repo-a"));
    entries = touchJupyterFrame(entries, frame("page", "C:/repo-b"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ identity: jupyterFrameIdentity("page", "C:/repo-b"), generation: 0 });
    expect(jupyterFrameIdentity("page", "C:/repo-a")).not.toBe(jupyterFrameIdentity("page"));
  });

  it("bumps only the reloaded frame's generation and keeps it across touches", () => {
    let entries = touchJupyterFrame(touchJupyterFrame([] as Entry[], frame("a")), frame("b"));
    entries = reloadJupyterFrame(entries, frame("a").identity);
    expect(entries.map((entry) => entry.generation)).toEqual([1, 0]);
    entries = touchJupyterFrame(entries, frame("a"));
    expect(entries.find((entry) => entry.pagePath === "a")?.generation).toBe(1);
  });

  it("releases frames for deleted/moved pages and a left Deep Work root", () => {
    let entries: Entry[] = [];
    for (const page of ["kept", "deleted", "deep-work-x"]) entries = touchJupyterFrame(entries, frame(page));
    expect(pruneJupyterFrames(entries, new Set(["kept"])).map((entry) => entry.pagePath)).toEqual(["kept"]);
    expect(pruneJupyterFrames(entries, new Set(["kept", "deep-work-x"])).map((entry) => entry.pagePath))
      .toEqual(["kept", "deep-work-x"]);
  });

  it("drops Deep Work pending frames immediately on vault-page handoff (SN-347)", () => {
    let entries: Entry[] = [];
    entries = touchJupyterFrame(entries, frame("deep-work-pending:C%3A%5CProjects%5CLeRobot", "C:/Projects/LeRobot"));
    entries = touchJupyterFrame(entries, frame("AI/Robotic Arm/Master Repo.html", "C:/Projects/LeRobot"));
    expect(dropDeepWorkPendingJupyterFrames(entries).map((entry) => entry.pagePath)).toEqual([
      "AI/Robotic Arm/Master Repo.html",
    ]);
    const vaultOnly = dropDeepWorkPendingJupyterFrames(entries);
    expect(dropDeepWorkPendingJupyterFrames(vaultOnly)).toBe(vaultOnly);
  });
});

function focusMessage(workspacePath: string) {
  return {
    source: JUPYTER_FOCUS_MESSAGE_SOURCE,
    version: 2,
    kind: "focus",
    focus: {
      workspacePath,
      documentKind: "notebook",
      isDirty: false,
      activeCellIndex: 0,
      activeCellId: "cell-0",
      sourceRevision: "1:abc",
      modelRevision: 0,
      caret: null,
      selection: null,
      selectionRects: [],
      content: null,
    },
  };
}

describe("visible-frame routing (SN-348)", () => {
  function Harness({ active }: { active: "a" | "b" }) {
    return (
      <>
        {(["a", "b"] as const).map((page) => (
          <div key={page} data-testid={`host-${page}`} hidden={active !== page}>
            <JupyterNotebookView
              pagePath={page}
              title={page}
              isActive={active === page}
              onBridgeReady={(bridge) => bridges.push([page, bridge])}
              onFocusChange={(focus) => focusChanges.push([page, focus])}
            />
          </div>
        ))}
      </>
    );
  }

  let bridges: Array<[string, JupyterNotebookBridgeController | null]>;
  let focusChanges: Array<[string, JupyterFocusState | null]>;
  beforeEach(() => {
    bridges = [];
    focusChanges = [];
  });

  const lastBridge = () => bridges[bridges.length - 1];

  async function frames(view: ReturnType<typeof render>) {
    return waitFor(() => {
      const found = view.getAllByTestId("jupyter-frame") as HTMLIFrameElement[];
      expect(found).toHaveLength(2);
      return found;
    });
  }

  it("binds Companion/bridge only to the visible frame, in either tree order", async () => {
    const view = render(<Harness active="b" />);
    await frames(view);
    expect(lastBridge()[0]).toBe("b");
    expect(lastBridge()[1]).not.toBeNull();
    expect(bridges.some(([page, bridge]) => page === "a" && bridge)).toBe(false);

    view.rerender(<Harness active="a" />);
    expect(lastBridge()[0]).toBe("a");
    expect(lastBridge()[1]).not.toBeNull();

    view.rerender(<Harness active="b" />);
    expect(lastBridge()[0]).toBe("b");
    expect(lastBridge()[1]).not.toBeNull();
  });

  it("ignores focus from a hidden frame and clears focus when a frame is hidden", async () => {
    const view = render(<Harness active="a" />);
    const [frameA, frameB] = await frames(view);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: frameB.contentWindow,
        data: focusMessage("hidden.ipynb"),
      }));
    });
    expect(focusChanges.some(([, focus]) => focus?.workspacePath === "hidden.ipynb")).toBe(false);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: frameA.contentWindow,
        data: focusMessage("visible.ipynb"),
      }));
    });
    expect(focusChanges[focusChanges.length - 1]).toEqual(["a", expect.objectContaining({ workspacePath: "visible.ipynb" })]);

    view.rerender(<Harness active="b" />);
    expect(focusChanges[focusChanges.length - 1]).toEqual(["a", null]);
  });

  it("keeps the same live iframe mounted while hidden (no remount on return)", async () => {
    const view = render(<Harness active="a" />);
    const [frameA] = await frames(view);
    view.rerender(<Harness active="b" />);
    view.rerender(<Harness active="a" />);
    const [frameAAgain] = view.getAllByTestId("jupyter-frame");
    expect(frameAAgain).toBe(frameA);
  });
});
