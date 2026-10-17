/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { InlineAiPopover } from "@/components/inline-ai-popover";
import { invokeInlineAi } from "@/lib/inline-ai";
import { streamJupyterFastLanePrompt } from "@/lib/api/jupyter";
jest.mock("@/lib/api/jupyter", () => ({ streamJupyterFastLanePrompt: jest.fn() }));
beforeAll(() => { global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; });
const context = { surface: "text" as const, target: "Clicked paragraph", text: "Captured paragraph", pageText: "Whole page", tableText: "" };
it("opens, streams and hands the captured target, question and answer to Companion", async () => {
  const onContinue = jest.fn();
  jest.mocked(streamJupyterFastLanePrompt).mockImplementation(async (_, __, ___, options) => {
    options?.onDelta?.("Answer", "Answer");
    return { text: "Answer", sessionId: null, ttftMs: 1, durationMs: 1 };
  });
  render(<InlineAiPopover pagePath="Notes/page.html" onContinue={onContinue} />);
  act(() => invokeInlineAi({ context, x: 10, y: 10 }));
  expect(screen.getByLabelText("Ask about this text")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  await screen.findByText("Answer");
  await waitFor(() => expect(screen.getByRole("button", { name: "Ask", exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue in Companion →" }));
  expect(onContinue.mock.calls[0][0].draft).toContain("Captured paragraph");
  expect(onContinue.mock.calls[0][0].draft).toContain("Explain this text.");
  expect(onContinue.mock.calls[0][0].draft).toContain("Answer");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("shows empty text, disables empty prompts and cancels a stream on page navigation", () => {
  let signal: AbortSignal | undefined;
  jest.mocked(streamJupyterFastLanePrompt).mockImplementation((_, __, ___, options) => {
    signal = options?.signal;
    return new Promise(() => {});
  });
  const { rerender } = render(<InlineAiPopover pagePath="Notes/one.html" onContinue={jest.fn()} />);
  act(() => invokeInlineAi({ context: { ...context, text: "" }, x: 10, y: 10 }));
  expect(screen.getByText("This target has no text yet.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Why?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  rerender(<InlineAiPopover pagePath="Notes/two.html" onContinue={jest.fn()} />);
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps a failed question for retry", async () => {
  jest.mocked(streamJupyterFastLanePrompt).mockRejectedValue(new Error("Provider unavailable"));
  render(<InlineAiPopover pagePath="Notes/page.html" onContinue={jest.fn()} />);
  act(() => invokeInlineAi({ context, x: 10, y: 10 }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Why?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Provider unavailable");
  expect(screen.getByRole("textbox")).toHaveValue("Why?");
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});
it("aborts an in-flight answer when closed by X or Escape and ignores late deltas", () => {
  const signals: AbortSignal[] = [];
  let late: ((chunk: string, text: string) => void) | undefined;
  jest.mocked(streamJupyterFastLanePrompt).mockImplementation((_, __, ___, options) => {
    signals.push(options!.signal!); late = options?.onDelta;
    return new Promise(() => {});
  });
  render(<InlineAiPopover pagePath="Notes/page.html" onContinue={jest.fn()} />);
  for (const dismiss of [() => fireEvent.click(screen.getByLabelText("Close Companion popover")), () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })]) {
    act(() => invokeInlineAi({ context, x: 10, y: 10 }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Thinking");
    dismiss();
    expect(signals[signals.length - 1].aborted).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  }
  act(() => late?.("late", "late"));
  act(() => invokeInlineAi({ context, x: 10, y: 10 }));
  expect(screen.queryByText("late")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("");
});
it("opens the frame menu row first, dismisses it on outside pointerdown, and rejects malformed invocations", () => {
  render(<InlineAiPopover pagePath="Notes/page.html" onContinue={jest.fn()} />);
  act(() => invokeInlineAi({ context: { ...context, tools: true } as never, x: 1, y: 1 }));
  expect(screen.queryByTestId("ask-companion-popover")).not.toBeInTheDocument();
  act(() => invokeInlineAi({ context, x: 10, y: 10, menu: true }));
  fireEvent.pointerDown(screen.getByRole("menuitem"));
  fireEvent.click(screen.getByRole("menuitem", { name: /Ask Companion/ }));
  expect(screen.getByRole("dialog", { name: "Companion" })).toBeVisible();
  fireEvent.pointerDown(document.body);
  expect(screen.getByRole("dialog")).toBeVisible();
  act(() => invokeInlineAi({ context, x: 10, y: 10, menu: true }));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByTestId("ask-companion-popover")).not.toBeInTheDocument();
});

it("keeps the captured PDF passage through menu, prompt chip, stream, and Companion handoff", async () => {
  const onContinue = jest.fn();
  const onClose = jest.fn();
  const passage = " First line\nSecond line ";
  jest.mocked(streamJupyterFastLanePrompt).mockImplementation(async (_, __, ___, options) => {
    options?.onDelta?.("Partial", "Partial");
    return { text: "Full answer", sessionId: null, ttftMs: 1, durationMs: 1 };
  });
  render(<InlineAiPopover pagePath="Notes/pdf.html" onContinue={onContinue} />);
  const pdfContext = { surface: "pdf" as const, target: "Selection", text: passage, pageText: "Other page text", tableText: "" };
  act(() => invokeInlineAi({ context: pdfContext, x: 10, y: 10, menu: true, sourceId: "pdf:one", onClose }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Ask Companion/ }));
  expect(screen.getByRole("dialog").querySelector("blockquote")?.textContent).toBe(passage);
  fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  await screen.findByText("Full answer");
  expect(streamJupyterFastLanePrompt).toHaveBeenCalledWith("Notes/pdf.html", "Summarize this text.", pdfContext, expect.any(Object));
  fireEvent.click(screen.getByRole("button", { name: "Continue in Companion →" }));
  expect(onContinue.mock.calls[0][0].draft).toContain(JSON.stringify(pdfContext));
  expect(onContinue.mock.calls[0][0].draft).toContain("Full answer");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("uses the same PDF passage for a free-text Ask and dismisses a stale target", async () => {
  const onClose = jest.fn();
  const pdfContext = { surface: "pdf" as const, target: "Selection", text: "Exact passage", pageText: "Page", tableText: "" };
  jest.mocked(streamJupyterFastLanePrompt).mockResolvedValue({ text: "Answer", sessionId: null, ttftMs: 1, durationMs: 1 });
  render(<InlineAiPopover pagePath="Notes/pdf.html" onContinue={jest.fn()} />);
  act(() => invokeInlineAi({ context: pdfContext, x: 10, y: 10, sourceId: "pdf:one", onClose }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Why this phrase?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  await screen.findByText("Answer");
  expect(streamJupyterFastLanePrompt).toHaveBeenCalledWith("Notes/pdf.html", "Why this phrase?", pdfContext, expect.any(Object));
  act(() => window.dispatchEvent(new CustomEvent("smart-notes-ask-companion-dismiss", { detail: "pdf:another" })));
  expect(screen.getByRole("dialog")).toBeVisible();
  act(() => window.dispatchEvent(new CustomEvent("smart-notes-ask-companion-dismiss", { detail: "pdf:one" })));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onClose).toHaveBeenCalledTimes(1);
});
