/**
 * @jest-environment jsdom
 *
 * SN-334 — compact PDF passage action row shared by the selection menu and the
 * tapped-highlight dish.
 */
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PdfPassageActions, PdfPassageMenu } from "@/components/pdf-passage-actions";

it("offers Highlight, Record and Ask Companion in that order", () => {
  render(<PdfPassageActions onHighlight={jest.fn()} onRecord={jest.fn()} onAsk={jest.fn()} />);
  const toolbar = screen.getByRole("toolbar", { name: "Selected passage actions" });
  expect(Array.from(toolbar.querySelectorAll("button")).map((button) => button.textContent?.trim())).toEqual([
    "Highlight",
    "Record",
    "Ask Companion",
  ]);
});

it("runs each action once and passes the Ask anchor rect", () => {
  const onHighlight = jest.fn();
  const onRecord = jest.fn();
  const onAsk = jest.fn();
  render(<PdfPassageActions onHighlight={onHighlight} onRecord={onRecord} onAsk={onAsk} />);
  fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
  fireEvent.click(screen.getByRole("button", { name: "Record" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask Companion" }));
  expect(onHighlight).toHaveBeenCalledTimes(1);
  expect(onRecord).toHaveBeenCalledTimes(1);
  expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number), bottom: expect.any(Number) }));
});

it("keeps the PDF range by stopping action pointerdown before the page provider", () => {
  const pagePointerDown = jest.fn();
  render(
    <div onPointerDown={pagePointerDown}>
      <PdfPassageActions onHighlight={jest.fn()} onAsk={jest.fn()} />
    </div>
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Ask Companion" }));
  expect(pagePointerDown).not.toHaveBeenCalled();
});

it("shows Record and Ask Companion only for a tapped highlight", () => {
  render(<PdfPassageActions label="Highlight actions" onRecord={jest.fn()} onAsk={jest.fn()} />);
  const toolbar = screen.getByRole("toolbar", { name: "Highlight actions" });
  expect(toolbar.textContent).not.toContain("Highlight");
  expect(screen.getByRole("button", { name: "Record" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Ask Companion" })).toBeVisible();
});

it("hides Record without a destination and disables Highlight until annotations load", () => {
  render(<PdfPassageActions onHighlight={jest.fn()} highlightDisabled onAsk={jest.fn()} />);
  expect(screen.queryByRole("button", { name: "Record" })).toBeNull();
  expect(screen.getByRole("button", { name: "Highlight" })).toBeDisabled();
});

it("anchors the menu below the passage, or above it when EmbedPDF suggests top", () => {
  const { rerender } = render(<PdfPassageMenu anchorWidth={200} anchorHeight={30} above={false}><span /></PdfPassageMenu>);
  const menu = screen.getByTestId("pdf-passage-menu");
  expect(menu).toHaveAttribute("data-placement", "bottom");
  expect(menu.style.left).toBe("100px");
  expect(menu.style.top).toBe("30px");
  rerender(<PdfPassageMenu anchorWidth={200} anchorHeight={30} above><span /></PdfPassageMenu>);
  expect(menu).toHaveAttribute("data-placement", "top");
  expect(menu.style.top).toBe("0px");
});

it("shifts the menu back inside a narrow viewport", () => {
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 360 });
  const spy = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: -40, right: 240, width: 280, top: 0, bottom: 44, height: 44, x: -40, y: 0, toJSON: () => ({}) } as DOMRect);
  render(<PdfPassageMenu anchorWidth={20} anchorHeight={12} above={false}><span /></PdfPassageMenu>);
  expect(screen.getByTestId("pdf-passage-menu").style.getPropertyValue("--pdf-passage-shift")).toBe("48px");
  spy.mockRestore();
});
