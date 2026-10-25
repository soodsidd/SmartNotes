/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

jest.mock("@/components/annotation-draw-toolbar", () => ({ AnnotationDrawToolbar: () => null }));
jest.mock("@/components/annotation-layer", () => ({ getAnnotationHistoryCommand: jest.fn(() => null) }));

import { RichTextEditor } from "@/components/rich-text-editor";
import { calculateExpression } from "@/lib/scientific-calculator";

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: jest.fn(() => Promise.resolve({})) });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: MockResizeObserver });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
});

describe("editor scientific calculator", () => {
  let editor: Editor | null;
  const writeText = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    editor = null;
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  afterEach(() => { jest.useRealTimers(); });

  async function mount(content = "<p>12.5 plus words</p>") {
    render(<RichTextEditor content={content} onChange={jest.fn()} onEditorReady={(value) => { editor = value; }} />);
    await waitFor(() => expect(editor).not.toBeNull());
    act(() => { editor!.view.dom.focus(); });
    expect(editor!.view.dom).toHaveFocus();
  }

  function shortcut() {
    fireEvent.keyDown(window, { key: "c", code: "KeyC", ctrlKey: true, altKey: true });
  }

  it("opens in the editor surface and closes with X", async () => {
    await mount();
    shortcut();
    expect(screen.getByTestId("editor-surface")).toContainElement(screen.getByTestId("editor-calculator"));
    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close calculator" }));
    expect(screen.queryByTestId("editor-calculator")).not.toBeInTheDocument();
  });

  it("returns focus to the invoking caret when closed from the calculator", async () => {
    await mount();
    act(() => { editor!.commands.setTextSelection(3); });
    shortcut();
    const close = screen.getByRole("button", { name: "Close calculator" });
    act(() => { close.focus(); });
    fireEvent.click(close);
    expect(editor!.view.dom).toHaveFocus();
    expect(editor!.state.selection.from).toBe(3);
  });

  it("remembers the latest editor caret when toggling back into the open calculator", async () => {
    await mount();
    act(() => { editor!.commands.setTextSelection(2); });
    shortcut();
    shortcut();
    act(() => { editor!.commands.setTextSelection(6); });
    shortcut();
    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveFocus();
    shortcut();
    expect(editor!.view.dom).toHaveFocus();
    expect(editor!.state.selection.from).toBe(6);
  });

  it("dismisses after 60 seconds without interaction", async () => {
    await mount();
    jest.useFakeTimers();
    shortcut();
    fireEvent.click(screen.getByRole("button", { name: "7" }));
    act(() => { jest.advanceTimersByTime(59_999); });
    expect(screen.getByTestId("editor-calculator")).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1); });
    expect(screen.queryByTestId("editor-calculator")).not.toBeInTheDocument();
  });

  it("seeds numeric selection and toggles focus back to the invoking editor selection", async () => {
    await mount();
    act(() => { editor!.commands.setTextSelection({ from: 1, to: 5 }); });
    shortcut();
    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveValue("12.5");
    shortcut();
    expect(editor!.view.dom).toHaveFocus();
    expect(editor!.state.selection.from).toBe(1);
    expect(editor!.state.selection.to).toBe(5);
    shortcut();
    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveFocus();
  });

  it("copies a calculated result immediately for editor paste", async () => {
    await mount();
    shortcut();
    const input = screen.getByRole("textbox", { name: "Expression" });
    fireEvent.change(input, { target: { value: "sin(30)+2^3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("8.5"));
    expect(input).toHaveValue("8.5");
    expect(screen.getByRole("status")).toHaveTextContent("Copied result");
  });

  it("does not seed prose and reports invalid expressions without copying", async () => {
    await mount();
    act(() => { editor!.commands.setTextSelection({ from: 1, to: 16 }); });
    shortcut();
    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox", { name: "Expression" }), { target: { value: "1/0" } });
    fireEvent.click(screen.getByRole("button", { name: "Calculate and copy" }));
    expect(screen.getByRole("status")).toHaveTextContent("undefined");
    expect(writeText).not.toHaveBeenCalled();
  });
});

it("evaluates parentheses, precedence, radians, and scientific functions", () => {
  expect(calculateExpression("(2+3)×4")).toBe("20");
  expect(calculateExpression("sqrt(9)+log(100)+ln(e)")).toBe("6");
  expect(calculateExpression("sin(π/2)", false)).toBe("1");
  expect(calculateExpression("-2^2")).toBe("-4");
});
