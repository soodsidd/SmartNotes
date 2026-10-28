/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/lib/api/jupyter", () => ({
  launchJupyterSession: jest.fn(async () => ({
    status: "ready",
    pagePath: "Notebook/Section/analysis.html",
    url: "/api/jupyter/proxy/session-1/lab/tree/notebook.ipynb?token=test",
  })),
  launchJupyterWorkspaceSession: jest.fn(async () => ({
    status: "ready",
    pagePath: "deep-work:test",
    url: "/api/jupyter/proxy/session-2/lab?token=test",
    accessMode: "read-only",
    capability: "dwc_test_capability",
  })),
  stopJupyterWorkspaceSession: jest.fn(async () => ({ stopped: true })),
  warmJupyterFastLaneSession: jest.fn(),
  closeJupyterFastLaneSession: jest.fn(),
  sendJupyterFastLanePrompt: jest.fn(),
  streamJupyterFastLanePrompt: jest.fn(),
}));

import { JupyterNotebookView } from "@/components/jupyter-notebook-view";
import { InlineAiPopover } from "@/components/inline-ai-popover";
import { sendJupyterFastLanePrompt, streamJupyterFastLanePrompt } from "@/lib/api/jupyter";
import { parseInlineAiContext, type InlineAiRelayObserver, type InlineAiRelayRequest } from "@/lib/inline-ai";
import { jupyterAskCompanionContext, jupyterAskCompanionEditTarget } from "@/lib/jupyter-ask-companion";
import { JUPYTER_FOCUS_MESSAGE_SOURCE, JUPYTER_FOCUS_MESSAGE_VERSION, type JupyterFocusState } from "@/lib/jupyter-focus";

const PAGE_PATH = "Notebook/Section/analysis.html";
const SOURCE = "x = load()\ny = x.mean()";

function focus(overrides: Partial<JupyterFocusState> = {}): JupyterFocusState {
  return {
    pagePath: PAGE_PATH,
    workspacePath: "notebook.ipynb",
    documentKind: "notebook",
    activeCellIndex: 1,
    activeCellId: "cell-1",
    sourceRevision: "rev-a",
    modelRevision: 4,
    caret: { line: 1, column: 12, offset: 23 },
    // Selects `x.mean()` on line 2.
    selection: { start: { line: 1, column: 4, offset: 15 }, end: { line: 1, column: 12, offset: 23 } },
    selectionRects: [{ x: 20, y: 30, width: 80, height: 18, top: 30, right: 100, bottom: 48, left: 20 }],
    content: {
      activeCellSource: SOURCE,
      activeCellSourceTruncated: false,
      activeCellOutputs: [{ kind: "error", text: "NameError: load", truncated: false }],
      cells: [
        { index: 0, id: "cell-0", kind: "markdown", source: "# Load data", sourceTruncated: false },
        { index: 1, id: "cell-1", kind: "code", source: SOURCE, sourceTruncated: false },
        { index: 2, id: "cell-2", kind: "code", source: "plot(y)", sourceTruncated: false },
      ],
      windowTruncated: false,
    },
    ...overrides,
  };
}

const caretOnly = (f: JupyterFocusState, offset = 10): JupyterFocusState => ({
  ...f,
  caret: { line: 0, column: offset, offset },
  selection: { start: { line: 0, column: offset, offset }, end: { line: 0, column: offset, offset } },
});

describe("SN-363 Lab Ask Companion capture", () => {
  it("captures the live selection as the snippet with the surrounding cell window and outputs", () => {
    const context = jupyterAskCompanionContext(focus());
    expect(parseInlineAiContext(context)).toEqual(context);
    expect(context).toMatchObject({ surface: "jupyter", target: "Selection", text: "x.mean()", tableText: "" });
    expect(context.pageText).toContain("# Cell 1 (markdown)\n# Load data");
    expect(context.pageText).toContain(`# Cell 2 (code) [active]\n${SOURCE}`);
    expect(context.pageText).toContain("# Cell 3 (code)\nplot(y)");
    expect(context.pageText).toContain("[error] NameError: load");
  });

  it("falls back to the whole active cell at a bare caret, and labels file editors as File", () => {
    expect(jupyterAskCompanionContext(caretOnly(focus()))).toMatchObject({ target: "Cell", text: SOURCE });
    const file = jupyterAskCompanionContext(caretOnly(focus({
      documentKind: "file", activeCellIndex: null, activeCellId: null,
      content: { activeCellSource: "def f():\n  pass", activeCellSourceTruncated: false, cells: [], windowTruncated: false },
    })));
    expect(file).toMatchObject({ target: "File", text: "def f():\n  pass", pageText: "def f():\n  pass" });
  });
});

describe("SN-363 Lab Edit target", () => {
  it("replaces the captured selection only while it is still live and unchanged", () => {
    const captured = focus();
    const live = focus({ modelRevision: 5 });
    expect(jupyterAskCompanionEditTarget(captured, live)).toEqual({ focus: live, selection: live.selection, mode: "replace" });
  });

  it("inserts at the live caret when the selection moved or the cell source changed", () => {
    const captured = focus();
    const moved = caretOnly(focus(), 3);
    expect(jupyterAskCompanionEditTarget(captured, moved)).toEqual({
      focus: moved, selection: { start: moved.caret, end: moved.caret }, mode: "insert",
    });
    const edited = focus({ sourceRevision: "rev-b" });
    expect(jupyterAskCompanionEditTarget(captured, edited)?.mode).toBe("insert");
    // A caret capture never replaces, even with an unchanged live focus.
    expect(jupyterAskCompanionEditTarget(caretOnly(focus()), caretOnly(focus()))?.mode).toBe("insert");
  });

  it("refuses another document, a missing live focus, or an unrevisioned model", () => {
    const captured = focus();
    expect(jupyterAskCompanionEditTarget(captured, null)).toBeNull();
    expect(jupyterAskCompanionEditTarget(captured, focus({ workspacePath: "other.ipynb" }))).toBeNull();
    expect(jupyterAskCompanionEditTarget(captured, focus({ sourceRevision: null }))).toBeNull();
    expect(jupyterAskCompanionEditTarget(captured, focus({ caret: null, selection: null }))).toBeNull();
  });
});

function focusEnvelope(value: JupyterFocusState) {
  const { pagePath: _pagePath, isDirty: _isDirty, ...rest } = value;
  return { source: JUPYTER_FOCUS_MESSAGE_SOURCE, version: JUPYTER_FOCUS_MESSAGE_VERSION, kind: "focus", focus: rest };
}

function postFromFrame(frame: HTMLIFrameElement, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: frame.contentWindow, data }));
  });
}

async function renderLab(workspace?: React.ComponentProps<typeof JupyterNotebookView>["workspace"]) {
  const onAsk = jest.fn<void, [InlineAiRelayRequest, InlineAiRelayObserver]>();
  const view = render(<>
    <JupyterNotebookView pagePath={PAGE_PATH} title="Analysis" workspace={workspace} />
    <InlineAiPopover pagePath={PAGE_PATH} onAsk={onAsk} onOpenCompanion={jest.fn()} />
  </>);
  const frame = await waitFor(() => view.getByTestId("jupyter-frame") as HTMLIFrameElement);
  const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
  return { view, frame, onAsk, postMessage };
}

describe("SN-363 Lab Ask Companion relay", () => {
  beforeAll(() => { global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; });
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    // Neither Fast nor Slow opens the parallel fast-lane session.
    expect(streamJupyterFastLanePrompt).not.toHaveBeenCalled();
    expect(sendJupyterFastLanePrompt).not.toHaveBeenCalled();
  });

  it("highlights the Jupyter frame only while a Companion edit is active", async () => {
    const view = render(<JupyterNotebookView pagePath={PAGE_PATH} title="Analysis" companionEditing={false} />);
    await view.findByTestId("jupyter-frame");
    expect(view.queryByTestId("jupyter-companion-editing-frame")).toBeNull();
    view.rerender(<JupyterNotebookView pagePath={PAGE_PATH} title="Analysis" companionEditing />);
    expect(view.getByTestId("jupyter-companion-editing-frame")).toHaveAttribute("aria-label", "Companion editing Jupyter workspace");
    view.rerender(<JupyterNotebookView pagePath={PAGE_PATH} title="Analysis" companionEditing={false} />);
    expect(view.queryByTestId("jupyter-companion-editing-frame")).toBeNull();
  });

  it("opens the shared popover from the Lab chip and relays Fast, then Slow, with cell context", async () => {
    const { view, frame, onAsk } = await renderLab();
    postFromFrame(frame, focusEnvelope(focus()));
    fireEvent.click(await view.findByTestId("jupyter-inline-ask"));

    expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull();
    expect(screen.getByTestId("ask-companion-popover")).toBeVisible();
    expect(screen.getByText("x.mean()")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Why NaN?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
    expect(onAsk.mock.calls[0][0]).toEqual({
      question: "Why NaN?", context: jupyterAskCompanionContext(focus()), speed: "fast", edit: false,
    });
    act(() => onAsk.mock.calls[0][1].onText("Because"));
    act(() => onAsk.mock.calls[0][1].onDone("Because load() failed."));
    expect(screen.getByText("Because load() failed.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Slow" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
    expect(onAsk.mock.calls[1][0]).toMatchObject({ question: "Why NaN?", speed: "slow", edit: false });
  });

  it("Edit replaces the still-live Lab selection through the revision-guarded bridge", async () => {
    const { view, frame, onAsk, postMessage } = await renderLab();
    postFromFrame(frame, focusEnvelope(focus()));
    fireEvent.click(await view.findByTestId("jupyter-inline-ask"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Use nanmean" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
    expect(onAsk.mock.calls[0][0].edit).toBe(true);
    act(() => onAsk.mock.calls[0][1].onText("```python\nnp.nan"));
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "apply-answer" }), expect.anything());

    // The live model moved on (e.g. autosave) but the selection is unchanged.
    postFromFrame(frame, focusEnvelope(focus({ modelRevision: 5 })));
    act(() => onAsk.mock.calls[0][1].onDone("```python\nnp.nanmean(x)\n```"));
    const message = postMessage.mock.calls.map(([data]) => data as { kind: string; requestId: string; answer: string; target: Record<string, unknown> })
      .find((data) => data.kind === "apply-answer")!;
    expect(message).toMatchObject({
      answer: "np.nanmean(x)",
      target: { modelRevision: 5, sourceRevision: "rev-a", selection: focus().selection },
    });
    expect(screen.queryByText("Inserted into the page.")).toBeNull();

    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE, version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "apply-answer-result", result: { requestId: message.requestId, ok: true, reason: null },
    });
    expect(await screen.findByText("Inserted into the page.")).toBeVisible();
  });

  it("Edit inserts at the live caret once the selection is gone, and reports a bridge rejection", async () => {
    const { view, frame, onAsk, postMessage } = await renderLab();
    postFromFrame(frame, focusEnvelope(focus()));
    fireEvent.click(await view.findByTestId("jupyter-inline-ask"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Add a comment" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));

    const moved = caretOnly(focus(), 10);
    postFromFrame(frame, focusEnvelope(moved));
    act(() => onAsk.mock.calls[0][1].onDone("  # loaded"));
    const message = postMessage.mock.calls.map(([data]) => data as { kind: string; requestId: string; target: Record<string, unknown> })
      .find((data) => data.kind === "apply-answer")!;
    expect(message.target.selection).toEqual({ start: moved.caret, end: moved.caret });

    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE, version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "apply-answer-result", result: { requestId: message.requestId, ok: false, reason: "The live Jupyter source changed." },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be inserted");
  });

  it("offers Ask but no Edit in a read-only Deep Work workspace", async () => {
    const { view, frame } = await renderLab({
      projectId: "proj", repoId: "repo", worktreePath: "C:/repo", requestedAccess: "read-only", projectName: "Proj",
    } as React.ComponentProps<typeof JupyterNotebookView>["workspace"]);
    postFromFrame(frame, focusEnvelope(focus()));
    fireEvent.click(await view.findByTestId("jupyter-inline-ask"));
    expect(screen.getByRole("button", { name: "Fast" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
