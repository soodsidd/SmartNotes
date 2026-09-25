/**
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import * as fs from "node:fs";
import * as path from "node:path";
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

jest.mock("@/components/annotation-draw-toolbar", () => ({
  AnnotationDrawToolbar: function MockAnnotationDrawToolbar() {
    return null;
  },
}));

jest.mock("@/components/annotation-layer", () => ({
  getAnnotationHistoryCommand: jest.fn(() => null),
}));

import { RichTextEditor } from "@/components/rich-text-editor";

const GLOBALS_CSS = fs.readFileSync(
  path.resolve(__dirname, "../src/app/globals.css"),
  "utf8"
);

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

describe("RichTextEditor collapsible headings", () => {
  const content = [
    "<h1>Alpha</h1>",
    "<p>Alpha body</p>",
    "<h1>Omega</h1>",
    "<p>Omega body</p>",
  ].join("");

  function mockCollapsibleHeadingLayout() {
    const proseMirror = document.querySelector(".ProseMirror");
    if (!proseMirror) {
      return;
    }

    const layout = [
      { offsetTop: 0, offsetHeight: 32 },
      { offsetTop: 40, offsetHeight: 80 },
      { offsetTop: 120, offsetHeight: 32 },
      { offsetTop: 152, offsetHeight: 80 },
    ];

    Array.from(proseMirror.children).forEach((child, index) => {
      const spec = layout[index];
      if (!spec || !(child instanceof HTMLElement)) {
        return;
      }

      Object.defineProperty(child, "offsetTop", {
        configurable: true,
        get: () => spec.offsetTop,
      });
      Object.defineProperty(child, "offsetHeight", {
        configurable: true,
        get: () => spec.offsetHeight,
      });
    });
  }

  async function renderWithAnnotationScene(annotationScene: Record<string, unknown>) {
    const view = render(
      React.createElement(RichTextEditor, {
        content,
        onChange: jest.fn(),
        annotationScene,
      })
    );

    await screen.findByTestId("heading-collapse-toggle-0");
    mockCollapsibleHeadingLayout();
    view.rerender(
      React.createElement(RichTextEditor, {
        content,
        onChange: jest.fn(),
        annotationScene: { ...annotationScene },
      })
    );

    return view;
  }

  it("editor content frame has deliberate left gutter on mobile (SN-95)", async () => {
    render(React.createElement(RichTextEditor, { content, onChange: jest.fn() }));
    await screen.findByTestId("heading-collapse-toggle-0");

    const frame = screen.getByTestId("editor-content-frame");
    // px-3 (12 px) on mobile; px-8 (32 px) at md breakpoint
    expect(frame.className).toContain("px-3");
    expect(frame.className).toContain("md:px-8");
  });

  it("toggles section content visibility from the heading chevron", async () => {
    render(React.createElement(RichTextEditor, { content, onChange: jest.fn() }));

    const toggle = await screen.findByTestId("heading-collapse-toggle-0");
    expect(toggle).not.toBeDisabled();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText("Alpha body").closest("p")).not.toBeVisible();
    });

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText("Alpha body").closest("p")).toBeVisible();
    });
  });

  it.each([
    { mode: "editable", readOnly: false },
    { mode: "read-only", readOnly: true },
  ])(
    "renders a wide table as a keyboard-accessible local scroll surface in $mode mode",
    async ({ readOnly }) => {
      let editorInstance: Editor | null = null;
      const wideTable = [
        "<h2>Sensor matrix</h2>",
        "<table><tbody><tr>",
        ...Array.from(
          { length: 8 },
          (_, index) =>
            `<th colwidth="160"><p>${index === 7 ? "Speed" : `Sensor ${index + 1}`}</p></th>`
        ),
        "</tr><tr>",
        ...Array.from(
          { length: 8 },
          (_, index) => `<td colwidth="160"><p>Value ${index + 1}</p></td>`
        ),
        "</tr></tbody></table>",
      ].join("");

      render(
        React.createElement(RichTextEditor, {
          content: wideTable,
          onChange: jest.fn(),
          onEditorReady: (editor) => {
            editorInstance = editor;
          },
          readOnly,
        })
      );

      await waitFor(() => expect(editorInstance).not.toBeNull());
      const scrollSurface = screen.getByRole("region", { name: "Table scroll area" });

      expect(scrollSurface).toHaveClass("tableWrapper");
      expect(scrollSurface).toHaveAttribute("tabindex", "0");
      expect(scrollSurface).toHaveTextContent("Speed");
      expect(editorInstance!.getHTML()).not.toContain("tableWrapper");
      expect(editorInstance!.getHTML()).not.toContain("Table scroll area");
    }
  );

  it("clips only collapsed section blocks, leaving expanded table overflow visible", async () => {
    render(React.createElement(RichTextEditor, { content, onChange: jest.fn() }));

    const toggle = await screen.findByTestId("heading-collapse-toggle-0");
    const frame = screen.getByTestId("editor-content-frame");
    const expandedCss = frame.querySelector("style")?.textContent ?? "";

    expect(expandedCss).not.toMatch(/> \* \{[^}]*overflow:\s*hidden/);

    fireEvent.click(toggle);

    await waitFor(() => {
      const collapsedCss = frame.querySelector("style")?.textContent ?? "";
      expect(collapsedCss).toMatch(
        /> :nth-child\(\d+\) \{ overflow: hidden !important; max-height: 0 !important;/
      );
    });
  });

  it("uses the rendered table wrapper for local touch and horizontal overflow", () => {
    expect(GLOBALS_CSS).toMatch(
      /\.editor-content \.tableWrapper\s*\{[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-x:\s*contain;[^}]*-webkit-overflow-scrolling:\s*touch;/s
    );
    expect(GLOBALS_CSS).toMatch(
      /\.editor-content \.tableWrapper:focus-visible\s*\{[^}]*var\(--ring\)/s
    );
  });

  it("disables the chevron and exposes the ink-safe tooltip when annotation ink is present", async () => {
    await renderWithAnnotationScene({
      document: {
        store: {
          "shape:draw-1": {
            typeName: "shape",
            y: 60,
            props: {
              segments: [{ points: [{ x: 0, y: 0 }, { x: 12, y: 18 }] }],
            },
          },
        },
      },
    });

    const toggle = await screen.findByTestId("heading-collapse-toggle-0");
    await waitFor(() => {
      expect(toggle).toBeDisabled();
    });
    expect(toggle.parentElement).toHaveAttribute("title", "Ink marks present - collapse unavailable");
  });

  it("keeps earlier sections collapsible when ink exists only in a later section", async () => {
    await renderWithAnnotationScene({
      document: {
        store: {
          "shape:draw-omega": {
            typeName: "shape",
            y: 170,
            props: {
              segments: [{ points: [{ x: 0, y: 0 }, { x: 12, y: 18 }] }],
            },
          },
        },
      },
    });

    const alphaToggle = await screen.findByTestId("heading-collapse-toggle-0");
    await waitFor(() => {
      expect(alphaToggle).not.toBeDisabled();
    });

    const omegaToggle = await screen.findByTestId("heading-collapse-toggle-1");
    await waitFor(() => {
      expect(omegaToggle).toBeDisabled();
    });
  });

  it("routes wrapper-origin taps into the nearest editor caret position", async () => {
    let editorInstance: Editor | null = null;

    render(
      React.createElement(RichTextEditor, {
        content,
        onChange: jest.fn(),
        onEditorReady: (editor) => {
          editorInstance = editor;
        },
      })
    );

    await waitFor(() => expect(editorInstance).not.toBeNull());

    const editor = editorInstance!;
    const frame = screen.getByTestId("editor-content-frame");
    const proseMirror = screen.getByTestId("rich-text-editor");
    const targetPos = editor.state.doc.child(0).nodeSize + 2;
    const posAtCoords = jest.fn(() => ({ pos: targetPos, inside: 0 }));

    Object.defineProperty(proseMirror, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          left: 100,
          right: 360,
          top: 80,
          bottom: 260,
        }) satisfies Pick<DOMRect, "left" | "right" | "top" | "bottom">,
    });
    editor.view.posAtCoords = posAtCoords;
    editor.commands.setTextSelection(1);

    fireEvent.click(frame, { clientX: 12, clientY: 60 });

    expect(posAtCoords).toHaveBeenCalledWith({ left: 108, top: 84 });
    expect(editor.state.selection.from).toBe(targetPos);
  });

  it("routes editor-surface taps into the nearest editor caret position", async () => {
    let editorInstance: Editor | null = null;

    render(
      React.createElement(RichTextEditor, {
        content,
        onChange: jest.fn(),
        onEditorReady: (editor) => {
          editorInstance = editor;
        },
      })
    );

    await waitFor(() => expect(editorInstance).not.toBeNull());

    const editor = editorInstance!;
    const surface = screen.getByTestId("editor-surface");
    const proseMirror = screen.getByTestId("rich-text-editor");
    const targetPos = editor.state.doc.child(0).nodeSize + 3;
    const posAtCoords = jest.fn(() => ({ pos: targetPos, inside: 0 }));

    Object.defineProperty(proseMirror, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          left: 48,
          right: 300,
          top: 24,
          bottom: 180,
        }) satisfies Pick<DOMRect, "left" | "right" | "top" | "bottom">,
    });
    editor.view.posAtCoords = posAtCoords;
    editor.commands.setTextSelection(1);

    fireEvent.click(surface, { clientX: 8, clientY: 10 });

    expect(posAtCoords).toHaveBeenCalledWith({ left: 56, top: 28 });
    expect(editor.state.selection.from).toBe(targetPos);
  });

  it("keeps the mobile editor frame and annotation overlay padding in sync", async () => {
    function OverlayProbe() {
      return React.createElement("div", { "data-testid": "annotation-overlay-probe" });
    }

    render(
      React.createElement(RichTextEditor, {
        content,
        onChange: jest.fn(),
        annotationOverlay: React.createElement(OverlayProbe),
      })
    );

    const frame = screen.getByTestId("editor-content-frame");
    const overlayPaddingFrame = frame.querySelector("[data-print-ink-clip] > div");

    expect(frame).toHaveClass("px-3", "md:px-8");
    expect(overlayPaddingFrame).toHaveClass("px-3", "md:px-8");
  });

  it("keeps touch-layout heading chevrons discreet without shifting heading text", async () => {
    render(React.createElement(RichTextEditor, { content, onChange: jest.fn() }));

    const frame = screen.getByTestId("editor-content-frame");
    const toggle = await screen.findByTestId("heading-collapse-toggle-0");
    const collapseStyle = frame.querySelector("style");

    expect(toggle.parentElement?.parentElement).toHaveClass("left-0");
    expect(toggle.parentElement?.parentElement).not.toHaveClass("md:left-0");
    expect(toggle).toHaveClass("size-4");
    expect(toggle).toHaveClass("bg-transparent");
    expect(collapseStyle?.textContent).not.toContain("@media (max-width: 767px)");
    expect(collapseStyle?.textContent).not.toContain("padding-left");
  });
});
