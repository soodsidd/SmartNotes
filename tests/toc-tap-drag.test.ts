/**
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import * as React from "react";
import { act, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

jest.mock("@/components/annotation-draw-toolbar", () => ({
  AnnotationDrawToolbar: function MockAnnotationDrawToolbar() {
    return null;
  },
}));

jest.mock("@/components/annotation-layer", () => ({
  getAnnotationHistoryCommand: jest.fn(() => null),
}));

jest.mock("@/lib/page-toc", () => {
  const actual = jest.requireActual("@/lib/page-toc");
  return {
    ...actual,
    // Stubbed: jsdom's scroll containers don't implement scrollTo/scrollIntoView.
    // These tests only assert whether/with-what the jump was requested.
    scrollEditorToAnchor: jest.fn(),
  };
});

import { RichTextEditor } from "@/components/rich-text-editor";
import { isWithinTocTapSlop, scrollEditorToAnchor, upsertPageToc } from "@/lib/page-toc";

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, "fetch", {
    writable: true,
    configurable: true,
    value: jest.fn(() => Promise.resolve({})),
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: MockResizeObserver,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
});

/**
 * jsdom has no PointerEvent constructor, and @testing-library/dom's fireEvent
 * falls back to plain `Event` (which drops clientX/pointerId/pointerType), so
 * pointer sequences are dispatched by hand here on top of MouseEvent, which
 * does honor clientX/clientY.
 */
function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { pointerId: number; pointerType: string; clientX: number; clientY: number }
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId, configurable: true });
  Object.defineProperty(event, "pointerType", { value: init.pointerType, configurable: true });
  target.dispatchEvent(event);
  return event;
}

/**
 * The browser fires a compatibility `click` after a pointer/touch sequence
 * regardless of preventDefault() on pointerdown (SN-233 review: click is not
 * a compatibility *mouse* event, so it is not suppressed by that alone).
 */
function fireClick(target: Element) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("page TOC tap-vs-drag guard (SN-233)", () => {
  const content = ["<h1>Alpha</h1>", "<p>A</p>", "<h2>Beta</h2>", "<p>B</p>"].join("");

  async function renderWithToc() {
    let editorInstance: Editor | null = null;
    const view = render(
      React.createElement(RichTextEditor, {
        content,
        onChange: jest.fn(),
        onEditorReady: (editor) => {
          editorInstance = editor;
        },
      })
    );

    await waitFor(() => expect(editorInstance).not.toBeNull());
    act(() => {
      upsertPageToc(editorInstance!);
    });

    const link = await waitFor(() => {
      const el = view.container.querySelector<HTMLElement>('[data-toc-target="beta"]');
      if (!el) throw new Error("TOC link not rendered yet");
      return el;
    });

    return { view, link };
  }

  beforeEach(() => {
    (scrollEditorToAnchor as jest.Mock).mockClear();
  });

  it("does not jump while a touch pointer is only pressed down", async () => {
    const { link } = await renderWithToc();

    firePointer(link, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 20 });

    expect(scrollEditorToAnchor).not.toHaveBeenCalled();
  });

  it("jumps on a stationary touch tap (press and release without movement)", async () => {
    const { link } = await renderWithToc();

    firePointer(link, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 20 });
    firePointer(link, "pointerup", { pointerId: 1, pointerType: "touch", clientX: 21, clientY: 22 });

    expect(scrollEditorToAnchor).toHaveBeenCalledTimes(1);
    expect(scrollEditorToAnchor).toHaveBeenCalledWith(expect.anything(), expect.anything(), "beta");
  });

  it("cancels the jump once a touch drag passes the tap slop threshold", async () => {
    const { link } = await renderWithToc();

    firePointer(link, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 20, clientY: 20 });
    firePointer(link, "pointermove", { pointerId: 2, pointerType: "touch", clientX: 20, clientY: 60 });
    firePointer(link, "pointerup", { pointerId: 2, pointerType: "touch", clientX: 20, clientY: 60 });

    expect(scrollEditorToAnchor).not.toHaveBeenCalled();
  });

  it("cancels the jump when the touch is cancelled by a scroll gesture", async () => {
    const { link } = await renderWithToc();

    firePointer(link, "pointerdown", { pointerId: 3, pointerType: "touch", clientX: 20, clientY: 20 });
    firePointer(link, "pointercancel", { pointerId: 3, pointerType: "touch", clientX: 20, clientY: 20 });
    firePointer(link, "pointerup", { pointerId: 3, pointerType: "touch", clientX: 20, clientY: 20 });

    expect(scrollEditorToAnchor).not.toHaveBeenCalled();
  });

  it("keeps jumping immediately on pointerdown for mouse input (desktop behavior unchanged)", async () => {
    const { link } = await renderWithToc();

    firePointer(link, "pointerdown", { pointerId: 4, pointerType: "mouse", clientX: 20, clientY: 20 });

    expect(scrollEditorToAnchor).toHaveBeenCalledTimes(1);
    expect(scrollEditorToAnchor).toHaveBeenCalledWith(expect.anything(), expect.anything(), "beta");
  });

  it("does not jump again from the compatibility click that follows a clean touch tap", async () => {
    const { link } = await renderWithToc();

    firePointer(link, "pointerdown", { pointerId: 7, pointerType: "touch", clientX: 20, clientY: 20 });
    firePointer(link, "pointerup", { pointerId: 7, pointerType: "touch", clientX: 20, clientY: 20 });
    fireClick(link);

    // The pointerup already jumped once; the trailing click must not jump again.
    expect(scrollEditorToAnchor).toHaveBeenCalledTimes(1);
  });

  it("does not jump from the compatibility click after a drag past the tap slop", async () => {
    const { link } = await renderWithToc();

    firePointer(link, "pointerdown", { pointerId: 8, pointerType: "touch", clientX: 20, clientY: 20 });
    firePointer(link, "pointermove", { pointerId: 8, pointerType: "touch", clientX: 20, clientY: 60 });
    firePointer(link, "pointerup", { pointerId: 8, pointerType: "touch", clientX: 20, clientY: 60 });
    fireClick(link);

    expect(scrollEditorToAnchor).not.toHaveBeenCalled();
  });

  it("does not jump from the compatibility click after a pointercancel", async () => {
    const { link } = await renderWithToc();

    firePointer(link, "pointerdown", { pointerId: 9, pointerType: "touch", clientX: 20, clientY: 20 });
    firePointer(link, "pointercancel", { pointerId: 9, pointerType: "touch", clientX: 20, clientY: 20 });
    fireClick(link);

    expect(scrollEditorToAnchor).not.toHaveBeenCalled();
  });

  it("does not double-jump from the compatibility click that follows a mouse pointerdown", async () => {
    const { link } = await renderWithToc();

    firePointer(link, "pointerdown", { pointerId: 10, pointerType: "mouse", clientX: 20, clientY: 20 });
    fireClick(link);

    // Pre-existing double-invocation bug: pointerdown jumped once; the click
    // that follows must be suppressed rather than jumping a second time.
    expect(scrollEditorToAnchor).toHaveBeenCalledTimes(1);
  });

  it("blocks default hash/legacy anchor navigation on pointerdown for both mouse and touch", async () => {
    const { link } = await renderWithToc();

    const touchDown = firePointer(link, "pointerdown", {
      pointerId: 5,
      pointerType: "touch",
      clientX: 20,
      clientY: 20,
    });
    expect(touchDown.defaultPrevented).toBe(true);
    firePointer(link, "pointerup", { pointerId: 5, pointerType: "touch", clientX: 20, clientY: 20 });

    const mouseDown = firePointer(link, "pointerdown", {
      pointerId: 6,
      pointerType: "mouse",
      clientX: 20,
      clientY: 20,
    });
    expect(mouseDown.defaultPrevented).toBe(true);
  });
});

describe("isWithinTocTapSlop (SN-233)", () => {
  it("treats small movement as a tap", () => {
    expect(isWithinTocTapSlop(10, 10, 12, 11)).toBe(true);
    expect(isWithinTocTapSlop(10, 10, 10, 10)).toBe(true);
  });

  it("treats movement past the slop as a drag", () => {
    expect(isWithinTocTapSlop(10, 10, 10, 25)).toBe(false);
    expect(isWithinTocTapSlop(10, 10, 40, 10)).toBe(false);
  });

  it("respects a custom slop threshold", () => {
    expect(isWithinTocTapSlop(0, 0, 0, 20, 25)).toBe(true);
    expect(isWithinTocTapSlop(0, 0, 0, 20, 15)).toBe(false);
  });
});
