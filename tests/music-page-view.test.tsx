/** @jest-environment jsdom */
jest.mock("tldraw/tldraw.css", () => ({}));
jest.mock("tldraw", () => ({
  DrawShapeUtil: class {},
  Tldraw: () => <div data-testid="mock-ink-surface" />,
}));
jest.mock("@/lib/api/ink", () => ({
  fetchInkScene: jest.fn(async () => ({ scene: null, backgroundMode: "blank" })),
  parseInkSidecarJson: jest.fn(),
  saveInkScene: jest.fn(async () => {}),
}));

import * as React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InkCanvas } from "@/components/ink-canvas";

beforeAll(() => {
  global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
});

it.each(["tldraw", "smart-notes"] as const)("shows fixed staff paper and toggles full screen with %s", async (inkEngine) => {
  render(<InkCanvas pagePath="Notebook/Section/Melody.html" title="Melody" music inkEngine={inkEngine} />);
  await waitFor(() => expect(screen.getByTestId("music-page")).toBeInTheDocument());
  expect(screen.getByLabelText("Grand staff music paper")).toBeInTheDocument();
  expect(screen.getByTestId(inkEngine === "tldraw" ? "mock-ink-surface" : "smart-notes-ink-surface")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
  expect(screen.getByTestId("music-page")).toHaveClass("music-page--fullscreen");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByTestId("music-page")).not.toHaveClass("music-page--fullscreen");
});

it.each(["tldraw", "smart-notes"] as const)("pans the entire score with one finger and keeps pan continuous after a pinch with %s", async (inkEngine) => {
  render(<InkCanvas pagePath="Notebook/Section/Melody.html" music inkEngine={inkEngine} />);
  const page = await screen.findByTestId("music-page");
  const viewport = page.querySelector<HTMLElement>(".music-page__viewport")!;
  const paper = viewport.querySelector<HTMLElement>(".music-page__scaled")!;
  const ink = paper.querySelector<HTMLElement>(".music-page__ink")!;
  const inkPointerDown = jest.fn();
  ink.addEventListener("pointerdown", inkPointerDown);
  const touch = (clientX: number, clientY: number) => ({ clientX, clientY });
  const pointer = (type: string, pointerType: string, pointerId: number) => Object.assign(
    new Event(type, { bubbles: true }), { pointerType, pointerId }
  );

  fireEvent(ink, pointer("pointerdown", "touch", 1));
  fireEvent.touchStart(ink, { touches: [touch(100, 180)] });
  fireEvent.touchMove(ink, { touches: [touch(70, 130)] });
  expect(inkPointerDown).not.toHaveBeenCalled();
  expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([30, 50]);

  const initialWidth = parseFloat(paper.style.width);
  fireEvent.touchStart(ink, { touches: [touch(70, 130), touch(170, 130)] });
  for (const x of [180, 190, 200, 210, 220]) {
    fireEvent.touchMove(ink, { touches: [touch(70, 130), touch(x, 130)] });
  }
  expect(parseFloat(paper.style.width)).toBeCloseTo(initialWidth * 1.5);
  const beforeLift = [viewport.scrollLeft, viewport.scrollTop];
  fireEvent.touchEnd(ink, { touches: [touch(70, 130)] });
  fireEvent.touchMove(ink, { touches: [touch(60, 105)] });
  expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([beforeLift[0] + 10, beforeLift[1] + 25]);
  fireEvent.touchEnd(ink, { touches: [] });

  fireEvent(ink, pointer("pointerdown", "pen", 2));
  expect(inkPointerDown).toHaveBeenCalledTimes(1);
  fireEvent.touchStart(ink, { touches: [touch(90, 180)] });
  const beforePalm = viewport.scrollTop;
  fireEvent.touchMove(ink, { touches: [touch(90, 120)] });
  expect(viewport.scrollTop).toBe(beforePalm);
  fireEvent.touchEnd(ink, { touches: [] });
  fireEvent(window, pointer("pointerup", "pen", 2));

  fireEvent.click(screen.getByRole("button", { name: "Draw with finger" }));
  fireEvent(ink, pointer("pointerdown", "touch", 3));
  expect(inkPointerDown).toHaveBeenCalledTimes(2);
  fireEvent.touchStart(ink, { touches: [touch(100, 180)] });
  fireEvent.touchMove(ink, { touches: [touch(100, 130)] });
  expect(viewport.scrollTop).toBe(beforePalm);
});
