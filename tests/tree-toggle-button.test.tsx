/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { TreeToggleButton, TreeToggleSpacer, isTreeToggleTarget } from "@/components/tree-toggle-button";

function Row({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = React.useState(true);
  const [opened, setOpened] = React.useState(0);
  const [dragStarts, setDragStarts] = React.useState(0);
  const fromToggle = React.useRef(false);
  return (
    <div
      data-testid="row"
      draggable
      onPointerDownCapture={(event) => {
        fromToggle.current = isTreeToggleTarget(event.target);
      }}
      onDragStart={(event) => {
        if (fromToggle.current) {
          event.preventDefault();
          return;
        }
        setDragStarts((count) => count + 1);
      }}
      onClick={(event) => {
        if (isTreeToggleTarget(event.target)) return;
        setOpened((count) => count + 1);
      }}
    >
      <TreeToggleButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} compact={compact} label="Notes" testId="toggle" />
      <span data-testid="title">Notes</span>
      <output data-testid="state">{`${expanded ? "open" : "closed"}:${opened}:${dragStarts}`}</output>
    </div>
  );
}

test("one click toggles exactly once and never opens the row", () => {
  render(<Row />);
  const toggle = screen.getByRole("button", { name: "Collapse Notes" });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(toggle);
  expect(screen.getByTestId("state")).toHaveTextContent("closed:0:0");
  fireEvent.click(screen.getByRole("button", { name: "Expand Notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Collapse Notes" }));
  expect(screen.getByTestId("state")).toHaveTextContent("closed:0:0");
  fireEvent.click(screen.getByTestId("title"));
  expect(screen.getByTestId("state")).toHaveTextContent("closed:1:0");
});

test("clicking the glyph inside the toggle still counts as a toggle hit", () => {
  render(<Row />);
  const glyph = screen.getByTestId("toggle").querySelector("svg")!;
  expect(isTreeToggleTarget(glyph)).toBe(true);
  fireEvent.click(glyph);
  expect(screen.getByTestId("state")).toHaveTextContent("closed:0:0");
});

test("a drag gesture that begins on the toggle does not start a row drag", () => {
  render(<Row />);
  const toggle = screen.getByTestId("toggle");
  fireEvent.pointerDown(toggle);
  fireEvent.dragStart(screen.getByTestId("row"));
  expect(screen.getByTestId("state")).toHaveTextContent("open:0:0");
  fireEvent.pointerDown(screen.getByTestId("title"));
  fireEvent.dragStart(screen.getByTestId("row"));
  expect(screen.getByTestId("state")).toHaveTextContent("open:0:1");
});

test("hit target is a 44px touch box on phones and the 26px affordance on compact desktop", () => {
  const { rerender } = render(<Row />);
  expect(screen.getByTestId("toggle")).toHaveClass("size-11");
  rerender(<Row compact />);
  expect(screen.getByTestId("toggle")).toHaveClass("h-[var(--desktop-tree-affordance-size)]", "w-5");
  const { container } = render(<TreeToggleSpacer compact />);
  expect(container.firstChild).toHaveClass("w-5");
});
