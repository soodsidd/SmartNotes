/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PageTitleBar } from "@/components/page-title-bar";

describe("page title bar", () => {
  it("shows one editable title above a rule and date/time row", () => {
    const onCommit = jest.fn();
    render(<PageTitleBar pagePath="Work/Note.html" title="Untitled page" createdAt="2026-10-19T16:30:00Z" focusOnCreate onCommit={onCommit} />);

    const input = screen.getByRole("textbox", { name: "Page title" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Untitled page");
    expect(screen.getByTestId("page-title-bar").querySelectorAll(".page-title-bar__rule")).toHaveLength(1);
    expect(screen.getByTestId("page-title-metadata").querySelectorAll("time")).toHaveLength(2);

    fireEvent.change(input, { target: { value: "Research notes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Research notes");

    onCommit.mockClear();
    input.focus();
    fireEvent.change(input, { target: { value: "Cancelled title" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).toHaveBeenCalledWith("Untitled page");
    expect(onCommit).not.toHaveBeenCalledWith("Cancelled title");
  });
});
