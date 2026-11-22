/** @jest-environment jsdom */
jest.mock("tldraw/tldraw.css", () => ({}));
jest.mock("tldraw", () => ({
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

const SIBLINGS = [
  { path: "Notebook/Section/Song.html", title: "Song" },
  { path: "Notebook/Section/Song (page 2).html", title: "Song (page 2)" },
  { path: "Notebook/Section/Song (page 3).html", title: "Song (page 3)" },
];

it("shows Add next page button on a music page", async () => {
  const onAdd = jest.fn();
  render(
    <InkCanvas
      pagePath="Notebook/Section/Song.html"
      title="Song"
      music
      onAddMusicPage={onAdd}
    />
  );
  await waitFor(() => expect(screen.getByTestId("music-add-page")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("music-add-page"));
  expect(onAdd).toHaveBeenCalledTimes(1);
});

it("does not show Prev/Next buttons for a single-page song", async () => {
  render(
    <InkCanvas
      pagePath="Notebook/Section/Song.html"
      title="Song"
      music
      musicSiblings={[{ path: "Notebook/Section/Song.html", title: "Song" }]}
      musicPageIndex={0}
    />
  );
  await waitFor(() => expect(screen.getByTestId("music-page")).toBeInTheDocument());
  expect(screen.queryByTestId("music-prev-page")).not.toBeInTheDocument();
  expect(screen.queryByTestId("music-next-page")).not.toBeInTheDocument();
});

it("shows Prev/Next buttons and correct disabled state on first page of multi-page song", async () => {
  render(
    <InkCanvas
      pagePath={SIBLINGS[0].path}
      title={SIBLINGS[0].title}
      music
      musicSiblings={SIBLINGS}
      musicPageIndex={0}
    />
  );
  await waitFor(() => expect(screen.getByTestId("music-prev-page")).toBeInTheDocument());
  expect(screen.getByTestId("music-prev-page")).toBeDisabled();
  expect(screen.getByTestId("music-next-page")).not.toBeDisabled();
  expect(screen.getByLabelText("Page 1 of 3")).toBeInTheDocument();
});

it("shows Prev/Next with correct disabled state on last page of multi-page song", async () => {
  render(
    <InkCanvas
      pagePath={SIBLINGS[2].path}
      title={SIBLINGS[2].title}
      music
      musicSiblings={SIBLINGS}
      musicPageIndex={2}
    />
  );
  await waitFor(() => expect(screen.getByTestId("music-next-page")).toBeInTheDocument());
  expect(screen.getByTestId("music-prev-page")).not.toBeDisabled();
  expect(screen.getByTestId("music-next-page")).toBeDisabled();
  expect(screen.getByLabelText("Page 3 of 3")).toBeInTheDocument();
});

it("calls onNavigateMusicPage with correct path on Prev/Next click", async () => {
  const onNavigate = jest.fn();
  render(
    <InkCanvas
      pagePath={SIBLINGS[1].path}
      title={SIBLINGS[1].title}
      music
      musicSiblings={SIBLINGS}
      musicPageIndex={1}
      onNavigateMusicPage={onNavigate}
    />
  );
  await waitFor(() => expect(screen.getByTestId("music-prev-page")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("music-prev-page"));
  expect(onNavigate).toHaveBeenCalledWith(SIBLINGS[0].path);
  fireEvent.click(screen.getByTestId("music-next-page"));
  expect(onNavigate).toHaveBeenCalledWith(SIBLINGS[2].path);
});

it("does not show Add next page button in readOnly mode", async () => {
  render(
    <InkCanvas
      pagePath="Notebook/Section/Song.html"
      title="Song"
      music
      readOnly
      onAddMusicPage={jest.fn()}
    />
  );
  await waitFor(() => expect(screen.getByTestId("music-page")).toBeInTheDocument());
  expect(screen.queryByTestId("music-add-page")).not.toBeInTheDocument();
});
