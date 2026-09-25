/** @jest-environment jsdom */

import * as React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

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
    accessMode: "editable",
    capability: "dwc_test_capability",
  })),
  stopJupyterWorkspaceSession: jest.fn(async () => ({ stopped: true })),
  warmJupyterFastLaneSession: jest.fn(),
  closeJupyterFastLaneSession: jest.fn(),
  sendJupyterFastLanePrompt: jest.fn(async () => ({
    text: "A concise answer",
    sessionId: "session-1",
    ttftMs: 100,
    durationMs: 150,
  })),
  streamJupyterFastLanePrompt: jest.fn(async (
    _path: string,
    _message: string,
    _context: unknown,
    options?: { onDelta?: (chunk: string, accumulated: string) => void }
  ) => {
    options?.onDelta?.("A concise answer", "A concise answer");
    return {
      text: "A concise answer",
      sessionId: "session-1",
      ttftMs: null,
      durationMs: 150,
    };
  }),
}));

import { JupyterNotebookView } from "@/components/jupyter-notebook-view";
import { sendJupyterFastLanePrompt, streamJupyterFastLanePrompt } from "@/lib/api/jupyter";
import {
  buildJupyterCommentAnswerCompanionHandoff,
  buildJupyterInlineAiActions,
  buildJupyterInlineAiPrompt,
  findJupyterNaturalLanguageComment,
  formatJupyterInlineAiNotebookAnswer,
  isJupyterInlineAiConversationalProse,
  jupyterInlineAiAnswerRoute,
  jupyterInlineAiExpectsCode,
  jupyterInlineAiStreamsToOverlay,
  resolveJupyterCommentAnswerOutcome,
} from "@/lib/jupyter-inline-ai";
import { JUPYTER_FOCUS_MESSAGE_SOURCE, JUPYTER_FOCUS_MESSAGE_VERSION, type JupyterFocusState } from "@/lib/jupyter-focus";

const PAGE_PATH = "Notebook/Section/analysis.html";

function focus(overrides: Partial<JupyterFocusState> = {}): JupyterFocusState {
  return {
    pagePath: PAGE_PATH,
    workspacePath: "notebook.ipynb",
    documentKind: "notebook",
    activeCellIndex: 1,
    activeCellId: "cell-1",
    sourceRevision: "8:abcdef0101234567",
    modelRevision: 0,
    caret: { line: 0, column: 8, offset: 8 },
    selection: {
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: 8, offset: 8 },
    },
    selectionRects: [{ x: 20, y: 30, width: 80, height: 18, top: 30, right: 100, bottom: 48, left: 20 }],
    content: {
      activeCellSource: "print(1)",
      activeCellSourceTruncated: false,
      cells: [{ index: 1, id: "cell-1", kind: "code", source: "print(1)", sourceTruncated: false }],
      windowTruncated: false,
    },
    ...overrides,
  };
}

function focusEnvelope(value: JupyterFocusState, kind = "focus") {
  return {
    source: JUPYTER_FOCUS_MESSAGE_SOURCE,
    version: 2,
    kind,
    focus: {
      workspacePath: value.workspacePath,
      documentKind: value.documentKind,
      activeCellIndex: value.activeCellIndex,
      activeCellId: value.activeCellId,
      sourceRevision: value.sourceRevision,
      modelRevision: value.modelRevision,
      caret: value.caret,
      selection: value.selection,
      selectionRects: value.selectionRects,
      content: value.content,
    },
  };
}

async function renderFrame() {
  const view = render(<JupyterNotebookView pagePath={PAGE_PATH} title="Analysis" />);
  const frame = await waitFor(() => view.getByTestId("jupyter-frame") as HTMLIFrameElement);
  return { view, frame };
}

/** SN-252: caret rests on `  # calculate the mean` with no active selection. */
function commentCaretFocus(overrides: Partial<JupyterFocusState> = {}): JupyterFocusState {
  return focus({
    caret: { line: 0, column: 22, offset: 22 },
    selection: { start: { line: 0, column: 22, offset: 22 }, end: { line: 0, column: 22, offset: 22 } },
    selectionRects: [{ x: 20, y: 30, width: 0, height: 18, top: 30, right: 20, bottom: 48, left: 20 }],
    content: {
      activeCellSource: "  # calculate the mean",
      activeCellSourceTruncated: false,
      cells: [{ index: 1, id: "cell-1", kind: "code", source: "  # calculate the mean", sourceTruncated: false }],
      windowTruncated: false,
    },
    ...overrides,
  });
}

/**
 * SN-269: the owner has selected the whole `  # calculate the mean` comment
 * line (offsets 0–22) rather than resting a bare caret on it.
 */
function commentSelectionFocus(
  selection: JupyterFocusState["selection"] = {
    start: { line: 0, column: 0, offset: 0 },
    end: { line: 0, column: 22, offset: 22 },
  },
  overrides: Partial<JupyterFocusState> = {}
): JupyterFocusState {
  return commentCaretFocus({
    caret: { line: 0, column: 22, offset: 22 },
    selection,
    selectionRects: [{ x: 20, y: 30, width: 140, height: 18, top: 30, right: 160, bottom: 48, left: 20 }],
    ...overrides,
  });
}

function postFromFrame(frame: HTMLIFrameElement, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: frame.contentWindow,
      data,
    }));
  });
}

describe("Jupyter inline AI action routing (SN-249)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("builds the four shared selection/context actions in order", () => {
    expect(buildJupyterInlineAiActions(focus()).map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "explain", label: "Explain" },
      { id: "ask", label: "Ask" },
      { id: "fix", label: "Fix" },
      { id: "rewrite", label: "Rewrite" },
    ]);
    expect(jupyterInlineAiAnswerRoute("explain")).toBe("overlay");
    expect(jupyterInlineAiAnswerRoute("ask")).toBe("overlay");
    expect(jupyterInlineAiAnswerRoute("fix")).toBe("notebook");
    expect(jupyterInlineAiAnswerRoute("rewrite")).toBe("notebook");
  });

  it("finds a caret-line natural-language comment and prepares comment replacements", () => {
    const commentFocus = focus({
      caret: { line: 0, column: 22, offset: 22 },
      selection: null,
      selectionRects: [],
      content: {
        activeCellSource: "  # calculate the mean",
        activeCellSourceTruncated: false,
        cells: [{ index: 1, id: "cell-1", kind: "code", source: "  # calculate the mean", sourceTruncated: false }],
        windowTruncated: false,
      },
    });
    expect(findJupyterNaturalLanguageComment(commentFocus)).toMatchObject({
      text: "calculate the mean",
      prefix: "#",
      indentation: "  ",
    });
    expect(buildJupyterInlineAiActions(commentFocus).map((action) => action.id)).toEqual([
      "explain", "ask", "fix", "rewrite", "comment-to-code", "comment-answer",
    ]);
    expect(formatJupyterInlineAiNotebookAnswer("comment-to-code", "```python\nmean = sum(xs) / len(xs)\n```", commentFocus)).toMatchObject({
      text: "mean = sum(xs) / len(xs)",
      selection: { start: { offset: 0 }, end: { offset: 22 } },
    });
    // SN-253: a prose answer is never written into the cell at all (it used to
    // be re-commented over the original comment line).
    expect(formatJupyterInlineAiNotebookAnswer("comment-answer", "Use sum divided by length.", commentFocus))
      .toBeNull();
    // SN-253: a code answer appends below the comment, which stays intact.
    expect(formatJupyterInlineAiNotebookAnswer("comment-answer", "x = 1", commentFocus)?.text)
      .toBe("\n  x = 1");
  });

  it("SN-252: comment-to-code-append inserts indented code below the comment line, leaving it intact", () => {
    const commentFocus = commentCaretFocus();
    const result = formatJupyterInlineAiNotebookAnswer(
      "comment-to-code-append",
      "```python\nmean = sum(xs) / len(xs)\n```",
      commentFocus
    );
    expect(result.text).toBe("\n  mean = sum(xs) / len(xs)");
    // Collapsed insertion at the comment line's end offset (22) — a pure
    // insertion, never a replacement of the comment's own selection range.
    expect(result.selection).toEqual({
      start: { line: 0, column: 22, offset: 22 },
      end: { line: 0, column: 22, offset: 22 },
    });
    expect(jupyterInlineAiExpectsCode("comment-to-code-append")).toBe(true);
    expect(jupyterInlineAiAnswerRoute("comment-to-code-append")).toBe("notebook");
  });

  it("SN-269: a selected natural-language comment offers Write code and appends beneath the preserved comment", () => {
    const selected = commentSelectionFocus();
    expect(findJupyterNaturalLanguageComment(selected)).toMatchObject({
      text: "calculate the mean",
      prefix: "#",
      indentation: "  ",
      origin: "selection",
    });
    // Write code joins the ordinary selection actions; Answer comment stays on
    // the caret / Alt+Right-click target.
    expect(buildJupyterInlineAiActions(selected).map((action) => action.id)).toEqual([
      "explain", "ask", "fix", "rewrite", "comment-to-code",
    ]);
    expect(buildJupyterInlineAiPrompt("comment-to-code", selected)).toContain("calculate the mean");

    const written = formatJupyterInlineAiNotebookAnswer(
      "comment-to-code",
      "```python\nmean = sum(xs) / len(xs)\n```",
      selected
    );
    // The comment is preserved: a collapsed insert at its end offset, not a
    // replacement of the comment line's range.
    expect(written?.text).toBe("\n  mean = sum(xs) / len(xs)");
    expect(written?.selection).toEqual({
      start: { line: 0, column: 22, offset: 22 },
      end: { line: 0, column: 22, offset: 22 },
    });
  });

  it("SN-269: a selection of just the comment body (without prefix/indent) still counts as the comment", () => {
    const bodyOnly = commentSelectionFocus({
      start: { line: 0, column: 4, offset: 4 },
      end: { line: 0, column: 22, offset: 22 },
    });
    expect(findJupyterNaturalLanguageComment(bodyOnly)).toMatchObject({
      text: "calculate the mean",
      origin: "selection",
    });
    expect(formatJupyterInlineAiNotebookAnswer("comment-to-code", "x = 1", bodyOnly)).toEqual({
      text: "\n  x = 1",
      selection: {
        start: { line: 0, column: 22, offset: 22 },
        end: { line: 0, column: 22, offset: 22 },
      },
    });
  });

  it("SN-269: partial, multi-line, and ordinary code selections keep Write code hidden", () => {
    // A few words inside the comment is not a request to write code.
    const partial = commentSelectionFocus({
      start: { line: 0, column: 4, offset: 4 },
      end: { line: 0, column: 13, offset: 13 },
    });
    expect(findJupyterNaturalLanguageComment(partial)).toBeNull();
    expect(buildJupyterInlineAiActions(partial).map((action) => action.id)).toEqual([
      "explain", "ask", "fix", "rewrite",
    ]);

    // A selection running past the comment line covers real code too.
    const multiLine = commentSelectionFocus(
      { start: { line: 0, column: 0, offset: 0 }, end: { line: 1, column: 8, offset: 31 } },
      {
        content: {
          activeCellSource: "  # calculate the mean\nprint(1)",
          activeCellSourceTruncated: false,
          cells: [{
            index: 1,
            id: "cell-1",
            kind: "code",
            source: "  # calculate the mean\nprint(1)",
            sourceTruncated: false,
          }],
          windowTruncated: false,
        },
      }
    );
    expect(findJupyterNaturalLanguageComment(multiLine)).toBeNull();

    // Ordinary code selection (`print(1)`) is unaffected.
    expect(findJupyterNaturalLanguageComment(focus())).toBeNull();
    expect(buildJupyterInlineAiActions(focus()).map((action) => action.id)).toEqual([
      "explain", "ask", "fix", "rewrite",
    ]);
  });

  it("SN-269: the caret / Alt+Right-click comment target still replaces the comment line", () => {
    const caretComment = commentCaretFocus();
    expect(findJupyterNaturalLanguageComment(caretComment)).toMatchObject({ origin: "caret" });
    expect(formatJupyterInlineAiNotebookAnswer("comment-to-code", "x = 1", caretComment)).toEqual({
      text: "x = 1",
      selection: {
        start: { line: 0, column: 0, offset: 0 },
        end: { line: 0, column: 22, offset: 22 },
      },
    });
  });

  it("SN-269: selecting a comment in the live frame shows Write code and applies it below the comment", async () => {
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    postFromFrame(frame, focusEnvelope(commentSelectionFocus()));

    const overlay = await view.findByTestId("jupyter-inline-ai-overlay");
    expect(overlay.getAttribute("data-trigger")).toBe("selection");
    expect(view.queryByTestId("jupyter-inline-comment-answer")).toBeNull();
    fireEvent.click(view.getByTestId("jupyter-inline-comment-to-code"));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        answer: "\n  A concise answer",
        target: expect.objectContaining({
          selection: {
            start: { line: 0, column: 22, offset: 22 },
            end: { line: 0, column: 22, offset: 22 },
          },
        }),
      }),
      window.location.origin
    ));
  });

  it("SN-269: an ordinary code selection in the live frame never shows Write code", async () => {
    const { view, frame } = await renderFrame();
    postFromFrame(frame, focusEnvelope(focus()));

    await view.findByTestId("jupyter-inline-ai-overlay");
    expect(view.queryByTestId("jupyter-inline-comment-to-code")).toBeNull();
    expect(view.queryByTestId("jupyter-inline-comment-answer")).toBeNull();
    expect(
      view.getAllByRole("button").map((button) => button.textContent).filter(Boolean)
    ).toEqual(["Explain", "Ask", "Fix", "Rewrite"]);
  });

  it("shows the selection actions, a visible working state, and keeps Explain in the overlay", async () => {
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    postFromFrame(frame, focusEnvelope(focus()));

    expect((await view.findByTestId("jupyter-inline-ai-overlay")).getAttribute("data-trigger")).toBe("selection");
    expect(view.getByTestId("jupyter-inline-explain")).toBeTruthy();
    expect(view.getByTestId("jupyter-inline-ask")).toBeTruthy();
    expect(view.getByTestId("jupyter-inline-fix")).toBeTruthy();
    expect(view.getByTestId("jupyter-inline-rewrite")).toBeTruthy();

    fireEvent.click(view.getByTestId("jupyter-inline-explain"));
    expect(view.getByTestId("jupyter-inline-working").textContent).toContain("Working…");
    expect((await view.findByTestId("jupyter-inline-answer")).textContent).toContain("A concise answer");
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "apply-answer" }), expect.anything());
  });

  it("leaves Explain answers passively dismissible", async () => {
    const { view, frame } = await renderFrame();
    postFromFrame(frame, focusEnvelope(focus()));
    fireEvent.click(await view.findByTestId("jupyter-inline-explain"));
    await view.findByTestId("jupyter-inline-answer");

    fireEvent.scroll(window);
    expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull();
  });

  it("routes Fix into the captured live selection, protects apply from passive dismiss, then dismisses on success", async () => {
    (streamJupyterFastLanePrompt as jest.Mock).mockResolvedValueOnce({
      text: "print(2)",
      sessionId: "session-1",
      ttftMs: 100,
      durationMs: 150,
    });
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    const selectedFocus = focus();
    postFromFrame(frame, focusEnvelope(selectedFocus));
    fireEvent.click(await view.findByTestId("jupyter-inline-fix"));

    // Fix always shows the optional hint box first (Ask-like flow, SN-251) —
    // it never sends immediately on click.
    const hintInput = await view.findByTestId("jupyter-inline-fix-hint-input");
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "apply-answer" }), expect.anything());

    // Empty hint is allowed: clicking Send with nothing typed still sends.
    fireEvent.click(view.getByTestId("jupyter-inline-fix-hint-send"));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        answer: "print(2)",
        target: expect.objectContaining({ selection: selectedFocus.selection }),
      }),
      window.location.origin
    ));
    // SN-255: Fix streams into the overlay; applying keeps the transcript up.
    expect(view.getByTestId("jupyter-inline-stream-status").textContent).toContain("Applying to cell…");
    expect(hintInput).toBeTruthy();

    postFromFrame(frame, focusEnvelope(focus({
      selection: { start: selectedFocus.selection!.end, end: selectedFocus.selection!.end },
      selectionRects: [],
    })));
    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "dismiss-overlay",
      reason: "scroll",
    });
    fireEvent.scroll(window);
    expect(view.getByTestId("jupyter-inline-ai-overlay")).toBeTruthy();

    const applyCall = postMessage.mock.calls.find(
      ([message]) => (message as { kind?: string }).kind === "apply-answer"
    );
    const requestId = (applyCall![0] as { requestId: string }).requestId;
    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "apply-answer-result",
      result: { requestId, ok: true, reason: null },
    });
    await waitFor(() => expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull());
  });

  it("keeps Rewrite alive through selection clear and Lab scroll while streaming, then applies in place", async () => {
    let settle!: (value: unknown) => void;
    (streamJupyterFastLanePrompt as jest.Mock).mockImplementationOnce((
      _path: string,
      _message: string,
      _context: unknown,
      options?: { onDelta?: (chunk: string, accumulated: string) => void }
    ) => {
      options?.onDelta?.("print(", "print(");
      return new Promise((resolve) => { settle = resolve; });
    });
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    const selectedFocus = focus();
    postFromFrame(frame, focusEnvelope(selectedFocus));
    fireEvent.click(await view.findByTestId("jupyter-inline-rewrite"));
    await view.findByTestId("jupyter-inline-stream");

    postFromFrame(frame, focusEnvelope(focus({
      selection: { start: selectedFocus.selection!.end, end: selectedFocus.selection!.end },
      selectionRects: [],
    })));
    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "dismiss-overlay",
      reason: "scroll",
    });
    fireEvent.scroll(window);
    expect(view.getByTestId("jupyter-inline-ai-overlay")).toBeTruthy();

    await act(async () => {
      settle({ text: "print(2)", sessionId: "session-1", ttftMs: 100, durationMs: 150 });
    });
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        answer: "print(2)",
        target: expect.objectContaining({ selection: selectedFocus.selection }),
      }),
      window.location.origin
    ));
  });

  it("sends a typed Fix hint through to the prompt", async () => {
    const { view, frame } = await renderFrame();
    jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    postFromFrame(frame, focusEnvelope(focus()));
    fireEvent.click(await view.findByTestId("jupyter-inline-fix"));

    const hintInput = await view.findByTestId("jupyter-inline-fix-hint-input");
    fireEvent.change(hintInput, { target: { value: "the loop never terminates" } });
    fireEvent.click(view.getByTestId("jupyter-inline-fix-hint-send"));

    await waitFor(() => expect(streamJupyterFastLanePrompt).toHaveBeenCalledWith(
      PAGE_PATH,
      expect.stringContaining("the loop never terminates"),
      expect.anything(),
      expect.anything()
    ));
  });

  it("never applies a conversational reply from Fix into the cell; it surfaces as an error instead", async () => {
    (streamJupyterFastLanePrompt as jest.Mock).mockResolvedValueOnce({
      text: "Could you tell me what symptoms you're seeing with this code?",
      sessionId: "session-1",
      ttftMs: 100,
      durationMs: 150,
    });
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    postFromFrame(frame, focusEnvelope(focus()));
    fireEvent.click(await view.findByTestId("jupyter-inline-fix"));
    fireEvent.click(await view.findByTestId("jupyter-inline-fix-hint-send"));

    expect((await view.findByTestId("jupyter-inline-error")).textContent).toContain("symptoms you're seeing");
    expect(view.getByTestId("jupyter-inline-error-retry")).toBeTruthy();
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "apply-answer" }), expect.anything());

    postFromFrame(frame, focusEnvelope(focus({ selection: null, selectionRects: [] })));
    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "dismiss-overlay",
      reason: "scroll",
    });
    fireEvent.scroll(window);
    expect(view.getByTestId("jupyter-inline-error")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull();
  });

  it("keeps an apply failure sticky with Retry until explicit Close", async () => {
    (streamJupyterFastLanePrompt as jest.Mock).mockResolvedValueOnce({
      text: "print(2)",
      sessionId: "session-1",
      ttftMs: 100,
      durationMs: 150,
    });
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    postFromFrame(frame, focusEnvelope(focus()));
    fireEvent.click(await view.findByTestId("jupyter-inline-rewrite"));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "apply-answer", answer: "print(2)" }),
      window.location.origin
    ));
    const applyCall = postMessage.mock.calls.find(
      ([message]) => (message as { kind?: string }).kind === "apply-answer"
    );
    const requestId = (applyCall![0] as { requestId: string }).requestId;
    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "apply-answer-result",
      result: { requestId, ok: false, reason: "The selected cell changed before apply." },
    });

    expect((await view.findByTestId("jupyter-inline-error")).textContent).toContain("selected cell changed");
    expect(view.getByTestId("jupyter-inline-error-retry")).toBeTruthy();
    postFromFrame(frame, focusEnvelope(focus({ selection: null, selectionRects: [] })));
    fireEvent.scroll(window);
    expect(view.getByTestId("jupyter-inline-error")).toBeTruthy();

    fireEvent.click(view.getByLabelText("Close inline AI error"));
    expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull();
  });

  it("SN-264: does not auto-show the overlay when the caret rests on a natural-language comment", async () => {
    const { view, frame } = await renderFrame();
    postFromFrame(frame, focusEnvelope(commentCaretFocus()));

    expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull();
  });

  it("SN-264: does not auto-show the overlay for a markdown heading with no selection rectangles", async () => {
    const { view, frame } = await renderFrame();
    postFromFrame(frame, focusEnvelope(commentCaretFocus({
      caret: { line: 0, column: 14, offset: 14 },
      selection: { start: { line: 0, column: 14, offset: 14 }, end: { line: 0, column: 14, offset: 14 } },
      selectionRects: [],
      content: {
        activeCellSource: "# Analysis plan",
        activeCellSourceTruncated: false,
        cells: [{ index: 1, id: "cell-1", kind: "markdown", source: "# Analysis plan", sourceTruncated: false }],
        windowTruncated: false,
      },
    })));

    expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull();
  });

  it("SN-264: Alt+Right-click on a comment includes Write code / Answer comment and can replace the comment line", async () => {
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn(() => ({ matches: false })),
    });
    postFromFrame(frame, {
      ...focusEnvelope(commentCaretFocus(), "contextmenu"),
      contextmenu: { x: 44, y: 66 },
    });

    expect((await view.findByTestId("jupyter-inline-ai-overlay")).getAttribute("data-trigger")).toBe("contextmenu");
    expect(view.getByTestId("jupyter-inline-comment-answer")).toBeTruthy();
    fireEvent.click(await view.findByTestId("jupyter-inline-comment-to-code"));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        answer: "A concise answer",
        target: expect.objectContaining({
          selection: {
            start: { line: 0, column: 0, offset: 0 },
            end: { line: 0, column: 22, offset: 22 },
          },
        }),
      }),
      window.location.origin
    ));
  });

  it("SN-264: clearing a text selection dismisses its overlay without opening a caret overlay", async () => {
    const { view, frame } = await renderFrame();
    postFromFrame(frame, focusEnvelope(focus()));
    await view.findByTestId("jupyter-inline-ai-overlay");

    postFromFrame(frame, focusEnvelope(commentCaretFocus()));
    expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull();
  });

  it("SN-252: the append keybinding sends the comment to the fast lane and inserts code below it, preserving the comment", async () => {
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    const commentFocus = commentCaretFocus();

    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "keybinding",
      keybinding: { binding: "comment-append" },
      focus: focusEnvelope(commentFocus).focus,
    });

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        answer: "\n  A concise answer",
        target: expect.objectContaining({
          selection: {
            start: { line: 0, column: 22, offset: 22 },
            end: { line: 0, column: 22, offset: 22 },
          },
        }),
      }),
      window.location.origin
    ));
    expect(streamJupyterFastLanePrompt).toHaveBeenCalledWith(
      PAGE_PATH,
      expect.stringContaining("calculate the mean"),
      expect.anything(),
      expect.anything()
    );
  });

  it("SN-252: the append keybinding still applies when the focus snapshot has no selection rectangles", async () => {
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    const commentFocus = commentCaretFocus({ selectionRects: [] });

    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "keybinding",
      keybinding: { binding: "comment-append" },
      focus: focusEnvelope(commentFocus).focus,
    });

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        answer: "\n  A concise answer",
        target: expect.objectContaining({
          selection: {
            start: { line: 0, column: 22, offset: 22 },
            end: { line: 0, column: 22, offset: 22 },
          },
        }),
      }),
      window.location.origin
    ));
    expect(view.getByTestId("jupyter-inline-ai-overlay").getAttribute("data-trigger")).toBe("keybinding");
  });

  it("SN-252: the append keybinding no-ops when the caret is not on a natural-language comment", async () => {
    const { frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    postFromFrame(frame, focusEnvelope(focus()));

    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "keybinding",
      keybinding: { binding: "comment-append" },
      focus: focusEnvelope(focus({
        selection: { start: { line: 0, column: 3, offset: 3 }, end: { line: 0, column: 3, offset: 3 } },
        content: {
          activeCellSource: "print(1)",
          activeCellSourceTruncated: false,
          cells: [{ index: 1, id: "cell-1", kind: "code", source: "print(1)", sourceTruncated: false }],
          windowTruncated: false,
        },
      })).focus,
    });

    expect(sendJupyterFastLanePrompt).not.toHaveBeenCalled();
    expect(streamJupyterFastLanePrompt).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "apply-answer" }), expect.anything());
  });

  it("opens the same action list for a desktop right-click", async () => {
    const { view, frame } = await renderFrame();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn(() => ({ matches: false })),
    });
    postFromFrame(frame, {
      ...focusEnvelope(focus(), "contextmenu"),
      contextmenu: { x: 44, y: 66 },
    });
    expect((await view.findByTestId("jupyter-inline-ai-overlay")).getAttribute("data-trigger")).toBe("contextmenu");
    expect(view.getAllByRole("button").map((button) => button.textContent)).toEqual(expect.arrayContaining([
      "Explain", "Ask", "Fix", "Rewrite",
    ]));
  });

  it("enables ordinary project-file inline AI and applies only its revision-captured live target", async () => {
    const view = render(
      <JupyterNotebookView
        pagePath={PAGE_PATH}
        title="Deep Work"
        workspace={{
          rootPath: "C:/Projects/worktree",
          projectName: "Smart Notes",
          branch: "av/sn-258",
          requestedAccess: "editable",
        }}
      />
    );
    const frame = await waitFor(() => view.getByTestId("jupyter-frame") as HTMLIFrameElement);
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    postFromFrame(frame, focusEnvelope(focus({
      workspacePath: "src/index.ts",
      documentKind: "file",
      activeCellIndex: null,
      activeCellId: null,
    })));
    expect(await view.findByTestId("jupyter-inline-rewrite")).toBeTruthy();
    fireEvent.click(view.getByTestId("jupyter-inline-rewrite"));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        target: expect.objectContaining({
          workspacePath: "src/index.ts",
          sourceRevision: "8:abcdef0101234567",
          modelRevision: 0,
        }),
      }),
      window.location.origin
    ));
  });

  it("keeps the working state synchronous even when the provider promise is pending", async () => {
    let resolve!: (value: unknown) => void;
    (sendJupyterFastLanePrompt as jest.Mock).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { view, frame } = await renderFrame();
    postFromFrame(frame, focusEnvelope(focus()));
    fireEvent.click(await view.findByTestId("jupyter-inline-explain"));
    expect(view.getByTestId("jupyter-inline-working")).toBeTruthy();
    act(() => resolve({ text: "done", sessionId: "s", ttftMs: 1, durationMs: 2 }));
    expect(await view.findByText("done")).toBeTruthy();
  });
});

describe("Jupyter inline AI Fix prompt hardening and prose rejection (SN-251)", () => {
  it("never lets the Fix prompt fall back to a bare 'return replacement code' instruction", () => {
    const prompt = buildJupyterInlineAiPrompt("fix", focus());
    expect(prompt).toMatch(/not chatting/i);
    expect(prompt).toMatch(/no clarifying questions/i);
    expect(prompt).toMatch(/fix whatever is obviously broken/i);
    expect(prompt).toMatch(/return the selection exactly as-is, unchanged/i);
  });

  it("threads an owner-provided Fix hint into the prompt instead of the no-hint default", () => {
    const prompt = buildJupyterInlineAiPrompt("fix", focus(), "the retry loop never backs off");
    expect(prompt).toContain("The owner says what to fix: the retry loop never backs off");
    expect(prompt).not.toMatch(/fix whatever is obviously broken/i);
  });

  it("hardens Rewrite with the same never-chat instruction", () => {
    expect(buildJupyterInlineAiPrompt("rewrite", focus())).toMatch(/not chatting/i);
  });

  it("flags fix/rewrite/comment-to-code as code-expecting routes, but not comment-answer, explain, or ask", () => {
    expect(jupyterInlineAiExpectsCode("fix")).toBe(true);
    expect(jupyterInlineAiExpectsCode("rewrite")).toBe(true);
    expect(jupyterInlineAiExpectsCode("comment-to-code")).toBe(true);
    expect(jupyterInlineAiExpectsCode("comment-to-code-append")).toBe(true);
    expect(jupyterInlineAiExpectsCode("comment-answer")).toBe(false);
    expect(jupyterInlineAiExpectsCode("explain")).toBe(false);
    expect(jupyterInlineAiExpectsCode("ask")).toBe(false);
  });

  it("detects common conversational refusals and clarifying questions", () => {
    expect(isJupyterInlineAiConversationalProse("Could you tell me what's broken here?")).toBe(true);
    expect(isJupyterInlineAiConversationalProse("What symptoms are you seeing?")).toBe(true);
    expect(isJupyterInlineAiConversationalProse("I'm sorry, but I don't see an issue.")).toBe(true);
    expect(isJupyterInlineAiConversationalProse("Sure! Here's what I'd change.")).toBe(true);
  });

  it("does not flag ordinary code as conversational prose", () => {
    expect(isJupyterInlineAiConversationalProse("def add(a, b):\n    return a + b")).toBe(false);
    expect(isJupyterInlineAiConversationalProse("optimizer.set_hypers(lr=0.01)")).toBe(false);
    expect(isJupyterInlineAiConversationalProse("x = [i for i in range(10) if i % 2 == 0]")).toBe(false);
    expect(isJupyterInlineAiConversationalProse("")).toBe(false);
  });
});

/**
 * SN-253 — "Answer comment" was a production bug: it replaced the owner's
 * natural-language comment with the model's reply, so a clarifying question
 * came back as `# Could you clarify…` where the request used to be.
 */
describe("Jupyter inline AI Answer comment: preserve the comment, stream the turn (SN-253)", () => {
  beforeEach(() => jest.clearAllMocks());

  const CODE_ANSWER = "```python\nmean = sum(xs) / len(xs)\n```";
  const PROSE_ANSWER = "Could you say which column holds the values?";

  function streamOnce(text: string, chunks?: string[]) {
    (streamJupyterFastLanePrompt as jest.Mock).mockImplementationOnce(async (
      _path: string,
      _message: string,
      _context: unknown,
      options?: { onDelta?: (chunk: string, accumulated: string) => void }
    ) => {
      let accumulated = "";
      for (const chunk of chunks ?? [text]) {
        accumulated += chunk;
        options?.onDelta?.(chunk, accumulated);
      }
      return { text, sessionId: "session-1", ttftMs: null, durationMs: 10 };
    });
  }

  async function openAnswerComment() {
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn(() => ({ matches: false })),
    });
    postFromFrame(frame, {
      ...focusEnvelope(commentCaretFocus(), "contextmenu"),
      contextmenu: { x: 44, y: 66 },
    });
    await view.findByTestId("jupyter-inline-ai-overlay");
    return { view, frame, postMessage };
  }

  it("classifies a fenced code reply as code and any conversational reply as prose", () => {
    expect(resolveJupyterCommentAnswerOutcome(CODE_ANSWER)).toEqual({
      kind: "code",
      code: "mean = sum(xs) / len(xs)",
    });
    expect(resolveJupyterCommentAnswerOutcome(PROSE_ANSWER)).toEqual({
      kind: "prose",
      text: PROSE_ANSWER,
    });
    // Plain prose with no conversational lead-in is still prose, not code.
    expect(resolveJupyterCommentAnswerOutcome("The mean is the sum over the count.").kind).toBe("prose");
    // Bare code with no fence is still recognised as executable.
    expect(resolveJupyterCommentAnswerOutcome("mean = sum(xs) / len(xs)").kind).toBe("code");
    expect(jupyterInlineAiStreamsToOverlay("comment-answer")).toBe(true);
    expect(jupyterInlineAiStreamsToOverlay("comment-to-code")).toBe(true);
    expect(jupyterInlineAiStreamsToOverlay("comment-to-code-append")).toBe(true);
    expect(jupyterInlineAiStreamsToOverlay("fix")).toBe(true);
    expect(jupyterInlineAiStreamsToOverlay("rewrite")).toBe(true);
    expect(jupyterInlineAiStreamsToOverlay("explain")).toBe(false);
    expect(jupyterInlineAiStreamsToOverlay("ask")).toBe(false);
  });

  it("biases Answer comment toward runnable code with assumptions instead of clarifying interviews", () => {
    const prompt = buildJupyterInlineAiPrompt("comment-answer", commentCaretFocus());
    expect(prompt).toContain("calculate the mean");
    expect(prompt).toMatch(/never repeat it/i);
    expect(prompt).toMatch(/Always attempt runnable code first/i);
    expect(prompt).toMatch(/assumptions, stubs, TODOs/i);
    expect(prompt).toMatch(/do not open with clarifying questions/i);
    expect(prompt).toMatch(/ONLY as a last resort/i);
    expect(prompt).toMatch(/never written into the notebook/i);
  });

  it("builds an Ask-in-Companion handoff draft from the comment, reply, and notebook focus", () => {
    const draft = buildJupyterCommentAnswerCompanionHandoff({
      comment: "calculate the mean",
      modelReply: PROSE_ANSWER,
      pagePath: "Notebook/Section/analysis.html",
      pageTitle: "analysis",
    });
    expect(draft).toMatch(/Continue this Jupyter inline AI task/i);
    expect(draft).toContain("Notebook focus: analysis (Notebook/Section/analysis.html)");
    expect(draft).toContain("Original cell comment:");
    expect(draft).toContain("calculate the mean");
    expect(draft).toContain("Inline AI reply (prose / incomplete):");
    expect(draft).toContain(PROSE_ANSWER);
  });

  it("appends a code answer below the original comment instead of replacing it", async () => {
    streamOnce(CODE_ANSWER);
    const { view, postMessage } = await openAnswerComment();

    fireEvent.click(view.getByTestId("jupyter-inline-comment-answer"));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        // Leading newline + comment indentation: the comment line itself is
        // untouched and the code becomes the next line.
        answer: "\n  mean = sum(xs) / len(xs)",
        target: expect.objectContaining({
          // Collapsed at the comment line's end offset => a pure insert in one
          // shared-model transaction, i.e. one Jupyter undo step.
          selection: {
            start: { line: 0, column: 22, offset: 22 },
            end: { line: 0, column: 22, offset: 22 },
          },
        }),
      }),
      window.location.origin
    ));
    // Answer comment goes through the streaming lane, not the plain send path.
    expect(streamJupyterFastLanePrompt).toHaveBeenCalledTimes(1);
    expect(sendJupyterFastLanePrompt).not.toHaveBeenCalled();
  });

  it("never writes a conversational reply into the cell; it stays in the overlay", async () => {
    streamOnce(PROSE_ANSWER);
    const { view, postMessage } = await openAnswerComment();

    fireEvent.click(view.getByTestId("jupyter-inline-comment-answer"));

    expect(await view.findByTestId("jupyter-inline-answer")).toBeTruthy();
    expect(view.getByText(PROSE_ANSWER)).toBeTruthy();
    // The whole point of the bug fix: no bridge write at all, so the original
    // comment cannot be replaced by `# Could you say which column…`.
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "apply-answer" }),
      expect.anything()
    );
  });

  it("SN-254: prose reply offers Ask in Companion with the handoff payload and keeps Retry local", async () => {
    streamOnce(PROSE_ANSWER);
    const onAskInCompanion = jest.fn();
    const view = render(
      <JupyterNotebookView
        pagePath={PAGE_PATH}
        title="analysis"
        onAskInCompanion={onAskInCompanion}
      />
    );
    const frame = await waitFor(() => view.getByTestId("jupyter-frame") as HTMLIFrameElement);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn(() => ({ matches: false })),
    });
    postFromFrame(frame, {
      ...focusEnvelope(commentCaretFocus(), "contextmenu"),
      contextmenu: { x: 44, y: 66 },
    });
    await view.findByTestId("jupyter-inline-ai-overlay");

    fireEvent.click(view.getByTestId("jupyter-inline-comment-answer"));
    expect(await view.findByTestId("jupyter-inline-answer")).toBeTruthy();
    expect(view.getByTestId("jupyter-inline-ask-in-companion")).toBeTruthy();
    expect(view.getByTestId("jupyter-inline-answer-retry")).toBeTruthy();

    fireEvent.click(view.getByTestId("jupyter-inline-ask-in-companion"));
    expect(onAskInCompanion).toHaveBeenCalledTimes(1);
    const payload = onAskInCompanion.mock.calls[0][0] as {
      draft: string;
      comment: string;
      modelReply: string;
      pagePath: string;
      pageTitle?: string;
    };
    expect(payload.comment).toBe("calculate the mean");
    expect(payload.modelReply).toBe(PROSE_ANSWER);
    expect(payload.pagePath).toBe(PAGE_PATH);
    expect(payload.pageTitle).toBe("analysis");
    expect(payload.draft).toContain("calculate the mean");
    expect(payload.draft).toContain(PROSE_ANSWER);
    // Bubble dismisses after handoff — it does not become a multi-turn thread.
    expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull();
  });

  it("turns the chip into a live conversation stream for the turn, showing tokens as they arrive", async () => {
    let emit!: (chunk: string, accumulated: string) => void;
    let settle!: (value: unknown) => void;
    (streamJupyterFastLanePrompt as jest.Mock).mockImplementationOnce((
      _path: string,
      _message: string,
      _context: unknown,
      options?: { onDelta?: (chunk: string, accumulated: string) => void }
    ) => {
      emit = (chunk, accumulated) => options?.onDelta?.(chunk, accumulated);
      return new Promise((resolve) => { settle = resolve; });
    });

    const { view, frame, postMessage } = await openAnswerComment();
    fireEvent.click(view.getByTestId("jupyter-inline-comment-answer"));

    // The stream surface replaces the chip immediately — not after the answer.
    const stream = await view.findByTestId("jupyter-inline-stream");
    expect(stream.textContent).toContain("calculate the mean");
    expect(view.getByTestId("jupyter-inline-stream-status").textContent).toBe("Thinking…");

    act(() => emit("mean = ", "mean = "));
    expect(view.getByTestId("jupyter-inline-stream-text").textContent).toBe("mean = ");
    act(() => emit("sum(xs)", "mean = sum(xs)"));
    expect(view.getByTestId("jupyter-inline-stream-text").textContent).toBe("mean = sum(xs)");
    expect(view.getByTestId("jupyter-inline-stream-status").textContent).toBe("Answering…");

    await act(async () => {
      settle({ text: "mean = sum(xs)", sessionId: "session-1", ttftMs: null, durationMs: 10 });
    });

    // The transcript stays up while the code is applied, then the bridge's ok
    // result dismisses the overlay.
    await waitFor(() => expect(view.getByTestId("jupyter-inline-stream-status").textContent)
      .toBe("Adding code below your comment…"));

    const applyCall = postMessage.mock.calls.find(
      ([message]) => (message as { kind?: string }).kind === "apply-answer"
    );
    const requestId = (applyCall![0] as { requestId: string }).requestId;
    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "apply-answer-result",
      result: { requestId, ok: true, reason: null },
    });
    await waitFor(() => expect(view.queryByTestId("jupyter-inline-ai-overlay")).toBeNull());
  });

  it("surfaces a failed turn in the overlay instead of writing anything to the cell", async () => {
    (streamJupyterFastLanePrompt as jest.Mock).mockRejectedValueOnce(new Error("The fast lane is busy."));
    const { view, postMessage } = await openAnswerComment();

    fireEvent.click(view.getByTestId("jupyter-inline-comment-answer"));

    expect((await view.findByTestId("jupyter-inline-error")).textContent).toContain("The fast lane is busy.");
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "apply-answer" }),
      expect.anything()
    );
  });

  it("SN-255: streams Write code into the overlay instead of an opaque spinner-only wait", async () => {
    (streamJupyterFastLanePrompt as jest.Mock).mockImplementationOnce(async (
      _path: string,
      _message: string,
      _context: unknown,
      options?: { onDelta?: (chunk: string, accumulated: string) => void }
    ) => {
      options?.onDelta?.("mean = ", "mean = ");
      options?.onDelta?.("1", "mean = 1");
      return {
        text: "mean = 1",
        sessionId: "session-1",
        ttftMs: null,
        durationMs: 10,
      };
    });
    const { view, postMessage } = await openAnswerComment();

    fireEvent.click(view.getByTestId("jupyter-inline-comment-to-code"));
    expect(await view.findByTestId("jupyter-inline-stream")).toBeTruthy();
    expect(view.getByTestId("jupyter-inline-stream-text").textContent).toContain("mean =");

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        target: expect.objectContaining({
          selection: {
            start: { line: 0, column: 0, offset: 0 },
            end: { line: 0, column: 22, offset: 22 },
          },
        }),
      }),
      window.location.origin
    ));
    expect(streamJupyterFastLanePrompt).toHaveBeenCalled();
    expect(sendJupyterFastLanePrompt).not.toHaveBeenCalled();
  });

  it("SN-255: surfaces Retry on a Write code timeout/error", async () => {
    (streamJupyterFastLanePrompt as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error("Fast-lane turn timed out"), { code: "FAST_LANE_TIMEOUT" })
    );
    const { view, postMessage } = await openAnswerComment();

    fireEvent.click(view.getByTestId("jupyter-inline-comment-to-code"));
    expect(await view.findByTestId("jupyter-inline-error")).toBeTruthy();
    expect(view.getByTestId("jupyter-inline-error-retry")).toBeTruthy();
    expect(view.getByText(/timed out/i)).toBeTruthy();
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "apply-answer" }),
      expect.anything()
    );
  });

  it("streams the Ctrl/Cmd+Alt+Enter append chord through the same overlay path", async () => {
    streamOnce("mean = 1");
    const { view, frame } = await renderFrame();
    const postMessage = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);

    postFromFrame(frame, {
      source: JUPYTER_FOCUS_MESSAGE_SOURCE,
      version: JUPYTER_FOCUS_MESSAGE_VERSION,
      kind: "keybinding",
      keybinding: { binding: "comment-append" },
      focus: focusEnvelope(commentCaretFocus()).focus,
    });
    expect((await view.findByTestId("jupyter-inline-ai-overlay")).getAttribute("data-trigger")).toBe("keybinding");
    await waitFor(() => expect(streamJupyterFastLanePrompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "apply-answer",
        answer: "\n  mean = 1",
      }),
      window.location.origin
    ));
    expect(sendJupyterFastLanePrompt).not.toHaveBeenCalled();
  });
});
