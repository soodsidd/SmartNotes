/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { InlineAiPopover } from "@/components/inline-ai-popover";
import { invokeInlineAi, type InlineAiRelayObserver, type InlineAiRelayRequest } from "@/lib/inline-ai";
import { streamJupyterFastLanePrompt } from "@/lib/api/jupyter";
// SN-362: Ask must never open the parallel fast-lane session.
jest.mock("@/lib/api/jupyter", () => ({ streamJupyterFastLanePrompt: jest.fn() }));
const fetchSpy = jest.fn();
beforeEach(() => { fetchSpy.mockReset(); global.fetch = fetchSpy as unknown as typeof fetch; jest.mocked(streamJupyterFastLanePrompt).mockReset(); });
afterEach(() => {
  expect(streamJupyterFastLanePrompt).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});

beforeAll(() => { global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; });
const context = { surface: "text" as const, target: "Selection", text: "Selected words", pageText: "Words before. Selected words. Words after.", tableText: "" };
const renderPopover = (onAsk = jest.fn<void, [InlineAiRelayRequest, InlineAiRelayObserver]>(), onOpenCompanion = jest.fn()) => {
  render(<InlineAiPopover pagePath="Notes/page.html" onAsk={onAsk} onOpenCompanion={onOpenCompanion} />);
  return { onAsk, onOpenCompanion };
};

it("defaults to Fast, relays the selection with surrounding page text, and mirrors the shared stream", () => {
  const { onAsk, onOpenCompanion } = renderPopover();
  act(() => invokeInlineAi({ context, x: 10, y: 10 }));
  expect(screen.getByRole("button", { name: "Fast" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(onAsk).toHaveBeenCalledWith({ question: "Explain this text.", context, speed: "fast", edit: false }, expect.any(Object));
  act(() => onAsk.mock.calls[0][1].onText("First"));
  expect(screen.getByText("First")).toBeVisible();
  act(() => onAsk.mock.calls[0][1].onText("First answer"));
  act(() => onAsk.mock.calls[0][1].onDone("First answer"));
  expect(screen.getByText("First answer")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open in Companion →" }));
  expect(onOpenCompanion).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("uses Slow for one request and keeps Summarize on the same relay path", () => {
  const { onAsk } = renderPopover();
  act(() => invokeInlineAi({ context, x: 10, y: 10 }));
  fireEvent.click(screen.getByRole("button", { name: "Slow" }));
  fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  expect(onAsk.mock.calls[0][0]).toEqual({ question: "Summarize this text.", context, speed: "slow", edit: false });
  act(() => onAsk.mock.calls[0][1].onError("Provider unavailable"));
  expect(screen.getByRole("alert")).toHaveTextContent("Provider unavailable");
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

it("applies a finished Edit answer once and does not edit during streaming", async () => {
  const applyEdit = jest.fn(() => true);
  const { onAsk } = renderPopover();
  act(() => invokeInlineAi({ context, x: 10, y: 10, applyEdit }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Rewrite this" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  act(() => onAsk.mock.calls[0][1].onText("Draft"));
  expect(applyEdit).not.toHaveBeenCalled();
  expect(onAsk.mock.calls[0][0].edit).toBe(true);
  act(() => onAsk.mock.calls[0][1].onDone("Final edit"));
  expect(applyEdit).toHaveBeenCalledTimes(1);
  expect(applyEdit).toHaveBeenCalledWith("Final edit");
  expect(await screen.findByText("Inserted into the page.")).toBeVisible();
  expect(screen.getByText("Final edit")).toBeVisible();
});

it("shows the answer without editing when Edit is off, and reports a refused insertion", async () => {
  const applyEdit = jest.fn(() => false);
  const { onAsk } = renderPopover();
  act(() => invokeInlineAi({ context, x: 10, y: 10, applyEdit }));
  expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  act(() => onAsk.mock.calls[0][1].onDone("Shown only"));
  expect(applyEdit).not.toHaveBeenCalled();
  expect(screen.getByText("Shown only")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  act(() => onAsk.mock.calls[1][1].onDone("Not insertable"));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be inserted");
});

// SN-363: Jupyter Lab confirms the cell write asynchronously through its bridge.
it("waits for an async Edit confirmation before reporting the insert", async () => {
  let settle: (applied: boolean) => void = () => {};
  const applyEdit = jest.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
  const { onAsk } = renderPopover();
  act(() => invokeInlineAi({ context: { ...context, surface: "jupyter", target: "Cell" }, x: 10, y: 10, applyEdit }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Vectorize" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  act(() => onAsk.mock.calls[0][1].onDone("y = x * 2"));
  expect(applyEdit).toHaveBeenCalledWith("y = x * 2");
  expect(screen.queryByText("Inserted into the page.")).not.toBeInTheDocument();
  await act(async () => settle(false));
  expect(screen.getByRole("alert")).toHaveTextContent("could not be inserted");
});

it("shows empty targets and disables empty prompts", () => {
  renderPopover();
  act(() => invokeInlineAi({ context: { ...context, text: "" }, x: 10, y: 10 }));
  expect(screen.getByText("This target has no text yet.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
});

it("closes on Escape and ignores the detached turn's late tokens", () => {
  const { onAsk } = renderPopover();
  act(() => invokeInlineAi({ context, x: 10, y: 10 }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Why?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  expect(screen.getByRole("status")).toHaveTextContent("Thinking");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => { onAsk.mock.calls[0][1].onText("late"); onAsk.mock.calls[0][1].onDone("late"); });
  act(() => invokeInlineAi({ context, x: 10, y: 10 }));
  expect(screen.queryByText("late")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("");
});

it("opens the frame menu row first, dismisses it on outside pointerdown, and rejects malformed invocations", () => {
  renderPopover();
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

it("offers PDF Record answer with the original quote after a relayed answer", () => {
  const recorded: unknown[] = [];
  const listener = (event: Event) => recorded.push((event as CustomEvent).detail);
  window.addEventListener("smart-notes-pdf-record", listener);
  const { onAsk } = renderPopover();
  const quote = " Original\nquote ";
  const pdfRecord = { source: { pdfPath: "Notes/paper.pdf", pdfTitle: "Paper", page: 3, quote }, defaultDestinationPath: "Notes/pdf.html" };
  act(() => invokeInlineAi({ context: { surface: "pdf", target: "Selection", text: quote, pageText: "Other page", tableText: "" }, x: 10, y: 10, menu: true, pdfRecord }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Ask Companion/ }));
  fireEvent.click(screen.getByRole("button", { name: "Explain" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  act(() => onAsk.mock.calls[0][1].onDone("An AI explanation"));
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  expect(recorded).toEqual([expect.objectContaining({ source: pdfRecord.source, question: "Explain this text.", answer: "An AI explanation", quick: true })]);
  window.removeEventListener("smart-notes-pdf-record", listener);
});

it("omits Highlight from page-context menus that have no live PDF range", () => {
  renderPopover();
  act(() => invokeInlineAi({ context: { surface: "pdf", target: "PDF page", text: "Page", pageText: "Page", tableText: "" }, x: 10, y: 10, menu: true }));
  expect(screen.queryByRole("menuitem", { name: "Highlight" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: /Ask Companion/ })).toBeVisible();
});

it("detaches popup mirroring on close and page navigation without cancelling the shared turn", () => {
  const onAsk = jest.fn<void, [InlineAiRelayRequest, InlineAiRelayObserver]>();
  const { rerender } = render(<InlineAiPopover pagePath="Notes/one.html" onAsk={onAsk} onOpenCompanion={jest.fn()} />);
  act(() => invokeInlineAi({ context, x: 10, y: 10 }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Why?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  fireEvent.click(screen.getByLabelText("Close Companion popover"));
  act(() => onAsk.mock.calls[0][1].onText("Late"));
  expect(screen.queryByText("Late")).not.toBeInTheDocument();
  act(() => invokeInlineAi({ context, x: 10, y: 10 }));
  rerender(<InlineAiPopover pagePath="Notes/two.html" onAsk={onAsk} onOpenCompanion={jest.fn()} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps PDF selection context through the menu and relay, without exposing Edit", () => {
  const { onAsk } = renderPopover();
  const pdfContext = { surface: "pdf" as const, target: "Selection", text: "Exact passage", pageText: "Surrounding PDF page", tableText: "" };
  const onClose = jest.fn();
  act(() => invokeInlineAi({ context: pdfContext, x: 10, y: 10, menu: true, sourceId: "pdf:one", onClose }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Ask Companion/ }));
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
  expect(onAsk.mock.calls[0][0]).toEqual({ question: "Summarize this text.", context: pdfContext, speed: "fast", edit: false });
  act(() => onAsk.mock.calls[0][1].onDone("Summary"));
  expect(screen.getByText("Summary")).toBeVisible();
  act(() => window.dispatchEvent(new CustomEvent("smart-notes-ask-companion-dismiss", { detail: "pdf:one" })));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("preserves PDF Highlight and Record menu actions", () => {
  renderPopover();
  const pdfContext = { surface: "pdf" as const, target: "Selection", text: "Passage", pageText: "Page", tableText: "" };
  const pdfHighlight = jest.fn();
  const pdfRecord = { source: { pdfPath: "Notes/paper.pdf", pdfTitle: "Paper", page: 1, quote: "Passage" }, defaultDestinationPath: "Notes/page.html" };
  act(() => invokeInlineAi({ context: pdfContext, x: 10, y: 10, menu: true, pdfHighlight, pdfRecord }));
  expect(screen.getAllByRole("menuitem").map(item => item.textContent?.trim())).toEqual(["Highlight", "Record", "Record options…", "Ask Companion..."]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Highlight" }));
  expect(pdfHighlight).toHaveBeenCalledTimes(1);
});
