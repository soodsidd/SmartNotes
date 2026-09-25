/** @jest-environment jsdom */

import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  resolvePdfReaderEscapeAction,
  usePdfPerformanceMode,
  controlsVisibleAfterPerformanceChange,
} from "../src/lib/use-pdf-performance-mode";

function Harness({ active = true }: { active?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const mode = usePdfPerformanceMode(ref, active);
  return <div ref={ref}><button onClick={() => mode.setEnabled((value) => !value)}>{mode.enabled ? "on" : "off"}</button></div>;
}

describe("PDF performance mode", () => {
  it("gives performance mode first Escape precedence", () => {
    expect(resolvePdfReaderEscapeAction(true, true, true)).toBe("performance");
    expect(resolvePdfReaderEscapeAction(false, true, true)).toBe("annotate");
    expect(resolvePdfReaderEscapeAction(false, false, true)).toBe("outline");
    expect(resolvePdfReaderEscapeAction(false, false, false)).toBe("close");
  });

  it("hides reader chrome when performance mode turns on and restores on exit", () => {
    expect(controlsVisibleAfterPerformanceChange(true)).toBe(false);
    expect(controlsVisibleAfterPerformanceChange(false)).toBe(true);
  });

  afterEach(() => {
    delete document.documentElement.dataset.pdfPerformanceMode;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  });

  it("acquires and releases fullscreen plus wake lock together", async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const request = jest.fn().mockResolvedValue({ release, released: false });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    const exitFullscreen = jest.fn().mockImplementation(async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    HTMLElement.prototype.requestFullscreen = jest.fn().mockImplementation(async function (this: HTMLElement) {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: this });
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.pdfPerformanceMode).toBe("true");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("keeps the chrome-hide fallback without either optional API", async () => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: undefined });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(document.documentElement.dataset.pdfPerformanceMode).toBe("true"));
  });

  it("releases the wake lock when the tab is backgrounded", async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: jest.fn().mockResolvedValue({ release, released: false }) } });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: undefined });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("on"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("off"));
    expect(release).toHaveBeenCalledTimes(1);
  });
});
