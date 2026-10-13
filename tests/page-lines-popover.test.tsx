/**
 * @jest-environment jsdom
 */

/**
 * SN-297: rule / grid line popover (fork photo #14) — control order, labels,
 * selection, and the per-browser "Always create" toggle.
 */
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PageLinesPopover } from "@/components/page-lines-popover";
import {
  DEFAULT_PAGE_LINES,
  NEW_PAGE_LINES_STORAGE_KEY,
  type PageLinesSetting,
} from "@/lib/page-lines";

function Harness({ initial = DEFAULT_PAGE_LINES, onChange }: { initial?: PageLinesSetting; onChange?: (next: PageLinesSetting) => void }) {
  const [value, setValue] = React.useState(initial);
  return (
    <PageLinesPopover
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

async function openPopover() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("toolbar-page-lines"));
  });
  return screen.findByTestId("page-lines-popover");
}

describe("PageLinesPopover", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows sections, tiles, swatches, and footer copy in photo #14 order", async () => {
    render(<Harness />);
    const popover = await openPopover();
    const text = popover.textContent ?? "";
    const order = [
      "Rule Lines",
      "None",
      "Grid Lines",
      "Rule Line Color",
      "Always create pages with these lines",
      "New text pages in this browser only.",
    ].map((label) => text.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const ruleTiles = ["none", "rule-narrow", "rule-college", "rule-wide", "rule-college-margin"];
    for (const id of ruleTiles) expect(screen.getByTestId(`page-lines-tile-${id}`)).toBeTruthy();
    for (const id of ["grid-small", "grid-medium", "grid-large", "grid-xlarge"]) {
      expect(screen.getByTestId(`page-lines-tile-${id}`)).toBeTruthy();
    }
    const swatches = screen.getAllByRole("radio").map((node) => node.getAttribute("aria-label"));
    expect(swatches).toEqual(["Light blue", "Blue", "Green", "Lavender", "Grey"]);

    expect(screen.getByTestId("page-lines-tile-none").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("page-lines-color-light-blue").getAttribute("aria-checked")).toBe("true");
  });

  it("selects rule, grid, and color options", async () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    await openPopover();

    fireEvent.click(screen.getByTestId("page-lines-tile-rule-college-margin"));
    expect(onChange).toHaveBeenLastCalledWith({ style: "rule-college-margin", color: "light-blue" });
    expect(screen.getByTestId("page-lines-tile-rule-college-margin").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("page-lines-tile-none").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByTestId("page-lines-tile-grid-large"));
    expect(onChange).toHaveBeenLastCalledWith({ style: "grid-large", color: "light-blue" });

    fireEvent.click(screen.getByTestId("page-lines-color-lavender"));
    expect(onChange).toHaveBeenLastCalledWith({ style: "grid-large", color: "lavender" });
    expect(screen.getByTestId("toolbar-page-lines").className).toContain("toolbar-btn--active");
  });

  it("stores the always-create default in this browser and follows later picks", async () => {
    render(<Harness initial={{ style: "rule-wide", color: "green" }} />);
    await openPopover();
    const toggle = screen.getByTestId("page-lines-always-create");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(NEW_PAGE_LINES_STORAGE_KEY)!)).toEqual({
      style: "rule-wide",
      color: "green",
    });

    fireEvent.click(screen.getByTestId("page-lines-tile-grid-small"));
    expect(JSON.parse(window.localStorage.getItem(NEW_PAGE_LINES_STORAGE_KEY)!)).toEqual({
      style: "grid-small",
      color: "green",
    });

    fireEvent.click(toggle);
    expect(window.localStorage.getItem(NEW_PAGE_LINES_STORAGE_KEY)).toBeNull();
  });

  it("does not write the browser default while the toggle is off", async () => {
    render(<Harness />);
    await openPopover();
    fireEvent.click(screen.getByTestId("page-lines-tile-rule-narrow"));
    expect(window.localStorage.getItem(NEW_PAGE_LINES_STORAGE_KEY)).toBeNull();
  });
});
