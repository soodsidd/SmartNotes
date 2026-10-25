/** @jest-environment jsdom */
/**
 * SN-310: Add comment on design Preview (right-click / long-press menu),
 * comments panel edit/resolve/delete, and the frame bridge message contract.
 */
import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DesignPageView } from "@/components/design-page-view";
import { InlineAiPopover } from "@/components/inline-ai-popover";
import { buildDesignSrcDoc, isDesignFrameMessage } from "@/components/ui-render-view";
import type { PageComment } from "@/lib/comment-types";

jest.mock("next/dynamic", () => () => function DynamicStub() { return null; });
jest.mock("@/components/annotation-draw-toolbar", () => ({ AnnotationDrawToolbar: () => null }));
jest.mock("@/lib/api/jupyter", () => ({ streamJupyterFastLanePrompt: jest.fn() }));

beforeAll(() => {
  global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
});

const SOURCE = "smart-notes-design-frame";
const context = { surface: "design" as const, target: "Clicked paragraph", text: "Jane Doe", pageText: "Jane Doe", tableText: "" };

function postFromFrame(data: unknown) {
  const frame = screen.getByTestId("design-page-frame") as HTMLIFrameElement;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
  });
}

function Harness({ initial = [], onSave }: { initial?: PageComment[]; onSave: jest.Mock }) {
  const [comments, setComments] = React.useState<PageComment[]>(initial);
  return (
    <>
      <DesignPageView
        pagePath="Career/Resumes/resume.html"
        title="Resume"
        bodyHtml="<h1>Jane Doe</h1>"
        onBodyChange={() => undefined}
        comments={comments}
        onCommentsChange={(next) => {
          onSave(next);
          setComments(next);
        }}
      />
      <InlineAiPopover pagePath="Career/Resumes/resume.html" onAsk={jest.fn()} onOpenCompanion={jest.fn()} />
    </>
  );
}

describe("design page comments UI (SN-310)", () => {
  it("adds an element-anchored comment from the Preview context menu", () => {
    const onSave = jest.fn();
    render(<Harness onSave={onSave} />);

    // Frame reports the pressed element first, then the existing ask-companion menu.
    postFromFrame({ source: SOURCE, kind: "comment-anchor", path: [0], tag: "h1", quote: "Jane Doe" });
    postFromFrame({ source: SOURCE, kind: "ask-companion", x: 20, y: 30, context });

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Ask Companion/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Add comment/ }));

    fireEvent.change(screen.getByTestId("comment-composer-textarea"), { target: { value: "Make the name larger" } });
    fireEvent.click(screen.getByTestId("comment-composer-submit"));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [saved] = onSave.mock.calls[0][0] as PageComment[];
    expect(saved).toMatchObject({
      quote: "Jane Doe",
      text: "Make the name larger",
      resolvedAt: null,
      target: { kind: "design-element", path: [0], tag: "h1" },
    });
    // Panel opens with the new comment listed.
    expect(within(screen.getByTestId("design-comments-panel")).getByText("Make the name larger")).toBeVisible();
    expect(screen.getByTestId("design-comments-toggle")).toHaveAccessibleName("Comments (1 open)");
  });

  it("falls back to a page-level comment when no fresh anchor arrived", () => {
    const onSave = jest.fn();
    render(<Harness onSave={onSave} />);
    postFromFrame({ source: SOURCE, kind: "ask-companion", x: 5, y: 5, context });
    fireEvent.click(screen.getByRole("menuitem", { name: /Add comment/ }));
    fireEvent.change(screen.getByTestId("comment-composer-textarea"), { target: { value: "One page max" } });
    fireEvent.click(screen.getByTestId("comment-composer-submit"));
    const [saved] = onSave.mock.calls[0][0] as PageComment[];
    expect(saved.target).toBeUndefined();
    expect(saved.quote).toBe("");
  });

  it("edits, resolves, reopens and deletes from the comments panel", () => {
    const onSave = jest.fn();
    const initial: PageComment[] = [
      { id: "cmt_a", quote: "Jane Doe", text: "Bigger", createdAt: "2026-10-14T00:00:00.000Z", resolvedAt: null, target: { kind: "design-element", path: [0], tag: "h1" } },
    ];
    render(<Harness initial={initial} onSave={onSave} />);
    fireEvent.click(screen.getByTestId("design-comments-toggle"));

    fireEvent.click(screen.getByTestId("design-comment-edit"));
    fireEvent.change(screen.getByTestId("design-comment-edit-textarea"), { target: { value: "Bigger and bold" } });
    fireEvent.click(screen.getByTestId("design-comment-edit-save"));
    expect(onSave.mock.calls.at(-1)[0][0].text).toBe("Bigger and bold");

    fireEvent.click(screen.getByTestId("design-comment-resolve"));
    expect(onSave.mock.calls.at(-1)[0][0].resolvedAt).toEqual(expect.any(String));
    expect(screen.queryByTestId("design-comment-item")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("design-comments-show-resolved"));
    fireEvent.click(screen.getByTestId("design-comment-reopen"));
    expect(onSave.mock.calls.at(-1)[0][0].resolvedAt).toBeNull();

    fireEvent.click(screen.getByTestId("design-comment-delete"));
    expect(onSave.mock.calls.at(-1)[0]).toEqual([]);
  });

  it("renders numbered pins at frame-reported rects and opens the comment from a pin", () => {
    const initial: PageComment[] = [
      { id: "cmt_pin", quote: "Jane Doe", text: "Pin me", createdAt: "2026-10-14T00:00:00.000Z", resolvedAt: null, target: { kind: "design-element", path: [0], tag: "h1" } },
    ];
    render(<Harness initial={initial} onSave={jest.fn()} />);
    postFromFrame({ source: SOURCE, kind: "comment-rects", rects: [{ id: "cmt_pin", top: 40, left: 10, width: 200, height: 30 }] });
    const pin = screen.getByTestId("design-comment-pin");
    expect(pin).toHaveTextContent("1");
    fireEvent.click(pin);
    expect(within(screen.getByTestId("design-comments-panel")).getByText("Pin me")).toBeVisible();
  });

  it("hides comment entry points when the shell does not allow comments (read-only / version preview)", () => {
    render(
      <>
        <DesignPageView pagePath="a.html" title="A" bodyHtml="<p>x</p>" />
        <InlineAiPopover pagePath="a.html" onAsk={jest.fn()} onOpenCompanion={jest.fn()} />
      </>
    );
    expect(screen.queryByTestId("design-comments-toggle")).not.toBeInTheDocument();
    postFromFrame({ source: SOURCE, kind: "ask-companion", x: 5, y: 5, context });
    expect(screen.queryByRole("menuitem", { name: /Add comment/ })).not.toBeInTheDocument();
  });
});

describe("design frame comment bridge contract (SN-310)", () => {
  it("validates comment-anchor and comment-rects messages", () => {
    expect(isDesignFrameMessage({ source: SOURCE, kind: "comment-anchor", path: [0, 2], tag: "h1", quote: "Hi" })).toBe(true);
    expect(isDesignFrameMessage({ source: SOURCE, kind: "comment-anchor", path: [-1], tag: "h1", quote: "Hi" })).toBe(false);
    expect(isDesignFrameMessage({ source: SOURCE, kind: "comment-anchor", path: [0], tag: "<script>", quote: "Hi" })).toBe(false);
    expect(isDesignFrameMessage({ source: SOURCE, kind: "comment-anchor", path: [0], tag: "p", quote: "x".repeat(281) })).toBe(false);
    expect(isDesignFrameMessage({ source: SOURCE, kind: "comment-rects", rects: [{ id: "c", top: 1, left: 2, width: 3, height: 4 }] })).toBe(true);
    expect(isDesignFrameMessage({ source: SOURCE, kind: "comment-rects", rects: [{ id: "c", top: "1" }] })).toBe(false);
  });

  it("installs the anchor bridge in both editable and read-only frames", () => {
    for (const editable of [true, false]) {
      const doc = buildDesignSrcDoc("<p>x</p>", undefined, editable);
      expect(doc).toContain("comment-anchor");
      expect(doc).toContain("comment-rects-request");
      expect(doc).toContain("replace(/\\s+/g");
    }
  });
});
