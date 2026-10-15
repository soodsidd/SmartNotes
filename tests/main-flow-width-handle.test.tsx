/**
 * @jest-environment jsdom
 */

/**
 * SN-318: right-edge width-only handle on the main editor flow frame.
 * Drag and arrow keys update the column width live (every step) and commit
 * once per drag / keyboard burst.
 */
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MAIN_FLOW_KEY_COMMIT_DELAY_MS, MainFlowWidthHandle } from "@/components/main-flow-width-handle";

function Harness({ initial = 672, onCommit }: { initial?: number; onCommit: (width: number) => void }) {
  const [width, setWidth] = React.useState(initial);
  return (
    <div data-testid="frame" style={{ ["--editor-main-flow-width" as string]: `${width}px` }}>
      <MainFlowWidthHandle width={width} height={480} onLiveChange={setWidth} onCommit={onCommit} />
    </div>
  );
}

const frameWidth = () => screen.getByTestId("frame").style.getPropertyValue("--editor-main-flow-width");

function pointer(target: Element, type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
  act(() => {
    target.dispatchEvent(event);
  });
}

describe("MainFlowWidthHandle", () => {
  afterEach(() => jest.useRealTimers());

  it("sits on the column's right edge as an accessible full-height separator", () => {
    render(<Harness onCommit={jest.fn()} />);
    const handle = screen.getByRole("separator", { name: "Resize page column width" });
    expect(handle.getAttribute("aria-valuenow")).toBe("672");
    expect(handle.getAttribute("aria-valuemin")).toBe("360");
    expect(handle.getAttribute("aria-valuemax")).toBe("1200");
    expect(handle.style.left).toBe("672px");
    expect(handle.style.height).toBe("480px");
  });

  it("reflows live on every drag step and commits once on release", () => {
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);
    const handle = screen.getByTestId("editor-main-flow-resize");

    pointer(handle, "pointerdown", 700);
    expect(handle.dataset.dragging).toBe("true");
    pointer(handle, "pointermove", 600);
    expect(frameWidth()).toBe("572px");
    expect(handle.style.left).toBe("572px");
    pointer(handle, "pointermove", 400);
    expect(frameWidth()).toBe("372px");
    pointer(handle, "pointermove", 100);
    expect(frameWidth()).toBe("360px");
    expect(onCommit).not.toHaveBeenCalled();

    pointer(handle, "pointerup", 100);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(360);
    expect(handle.dataset.dragging).toBeUndefined();

    // Released: further moves no longer resize.
    pointer(handle, "pointermove", 900);
    expect(frameWidth()).toBe("360px");
  });

  it("does not commit a click without movement", () => {
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);
    const handle = screen.getByTestId("editor-main-flow-resize");
    pointer(handle, "pointerdown", 700);
    pointer(handle, "pointerup", 700);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("adjusts width with arrow keys and commits one write per burst", () => {
    jest.useFakeTimers();
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);
    const handle = screen.getByTestId("editor-main-flow-resize");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(frameWidth()).toBe("680px");
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(frameWidth()).toBe("728px");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(frameWidth()).toBe("720px");
    expect(handle.getAttribute("aria-valuenow")).toBe("720");
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(MAIN_FLOW_KEY_COMMIT_DELAY_MS);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(720);

    fireEvent.keyDown(handle, { key: "Home" });
    expect(frameWidth()).toBe("672px");
    fireEvent.blur(handle);
    expect(onCommit).toHaveBeenLastCalledWith(672);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("ignores other keys so typing is not swallowed", () => {
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);
    const handle = screen.getByTestId("editor-main-flow-resize");
    expect(fireEvent.keyDown(handle, { key: "ArrowUp" })).toBe(true);
    expect(frameWidth()).toBe("672px");
  });
});
