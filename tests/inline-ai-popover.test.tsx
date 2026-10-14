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
