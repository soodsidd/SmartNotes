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
