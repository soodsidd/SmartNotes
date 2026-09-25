/**
 * @jest-environment jsdom
 */

import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { LogHistoryView } from "@/components/log-history-view";
import type { LogDocument } from "@/lib/log-contract";
import type { LogFormDefinition } from "@/lib/log-form-contract";

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const pagePath = "Notebook/Section/Metrics.html";
const document: LogDocument = {
  version: 1,
  schema: {
    fields: [
      { id: "kind", name: "Activity", type: "select", options: ["run", "ride"] },
      { id: "amount", name: "Distance", type: "number" },
      { id: "when", name: "Day", type: "date" },
      { id: "notes", name: "Notes", type: "text" },
    ],
  },
  rows: [
    {
      id: "older",
      createdAt: "2026-07-01T08:00:00.000Z",
      values: { kind: "run", amount: 5, when: "2026-07-01", notes: "Easy miles" },
    },
    {
      id: "newer",
      createdAt: "2026-07-03T09:30:00.000Z",
      values: { kind: "ride", amount: 20, when: "2026-07-03", notes: "Long aerobic session" },
    },
  ],
};

const form: LogFormDefinition = {
  version: 1,
  schema: {
    type: "object",
    properties: {
      kind: { type: "string", title: "Activity" },
      amount: { type: "number", title: "Distance" },
      when: { type: "string", format: "date", title: "Day" },
      notes: { type: "string", title: "Notes" },
    },
  },
  uischema: { type: "VerticalLayout", elements: [] },
  views: [
    {
      id: "runs",
      name: "Running",
      filters: [{ field: "kind", operator: "eq", value: "run" }],
      columns: [
        { field: "amount", label: "Distance", unit: "km", format: "number" },
        { field: "notes", label: "Session note", format: "text" },
      ],
      sort: [{ field: "createdAt", direction: "desc" }],
      limit: 50,
      presentation: "cards",
    },
    {
      id: "by-activity",
      name: "By activity",
      columns: [
        { field: "kind", label: "Activity" },
        { field: "amount", label: "Distance", unit: "km", format: "number" },
      ],
      grouping: ["kind"],
      summaries: [{ operator: "sum", field: "amount", as: "distance", label: "Total", unit: "km" }],
      limit: 50,
      presentation: "grouped",
    },
    {
      id: "total",
      name: "Total distance",
      columns: [{ field: "amount", label: "Distance" }],
      summaries: [{ operator: "sum", field: "amount", as: "total", label: "Distance logged", unit: "km" }],
      limit: 50,
      presentation: "summary",
    },
  ],
};

function history(view: string | null = null, onViewChange = jest.fn()) {
  return render(
    <LogHistoryView
      pagePath={pagePath}
      document={document}
      form={form}
      requestedViewId={view}
      onViewChange={onViewChange}
      onOpenForm={jest.fn()}
    />
  );
}

describe("LogHistoryView", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders a readable newest-first default chronology and stable default exports", () => {
    history();

    expect(screen.getByTestId("log-history-timeline")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "All entries" })).toBeInTheDocument();
    const notes = screen.getAllByText(/Long aerobic session|Easy miles/);
    expect(notes[0]).toHaveTextContent("Long aerobic session");
    expect(screen.getByTestId("log-history-count")).toHaveTextContent("Showing 2 of 2 entries");
    expect(screen.getByTestId("log-history-export-json")).toHaveAttribute(
      "href",
      `/api/page/log/query?path=${encodeURIComponent(pagePath)}`
    );
    expect(screen.getByTestId("log-history-export-csv")).toHaveAttribute(
      "href",
      `/api/page/log/query?path=${encodeURIComponent(pagePath)}&format=csv`
    );
  });

  it("selects and renders named card, grouped, and summary presentation presets", () => {
    const onViewChange = jest.fn();
    const rendered = history("runs", onViewChange);

    expect(screen.getByTestId("log-history-cards")).toBeInTheDocument();
    expect(screen.getByText("5 km")).toBeInTheDocument();
    expect(screen.queryByText("20 km")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("log-history-view-select"), {
      target: { value: "by-activity" },
    });
    expect(onViewChange).toHaveBeenCalledWith("by-activity");

    rendered.rerender(
      <LogHistoryView
        pagePath={pagePath}
        document={document}
        form={form}
        requestedViewId="by-activity"
        onViewChange={onViewChange}
        onOpenForm={jest.fn()}
      />
    );
    expect(screen.getByTestId("log-history-grouped")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Activity: run" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Activity: ride" })).toBeInTheDocument();

    rendered.rerender(
      <LogHistoryView
        pagePath={pagePath}
        document={document}
        form={form}
        requestedViewId="total"
        onViewChange={onViewChange}
        onOpenForm={jest.fn()}
      />
    );
    expect(screen.getByTestId("log-history-summaries")).toHaveTextContent("Distance logged");
    expect(screen.getByTestId("log-history-summaries")).toHaveTextContent("25 km");
    expect(screen.queryByTestId("log-history-cards")).not.toBeInTheDocument();
  });

  it("falls back to the complete default chronology when a requested view is missing", () => {
    history("agent-authored-view-that-was-dropped");

    expect(screen.getByTestId("log-history-fallback")).toHaveTextContent(
      "Showing all entries instead"
    );
    expect(screen.getByTestId("log-history-view-select")).toHaveValue("");
    expect(screen.getByTestId("log-history-count")).toHaveTextContent("Showing 2 of 2 entries");
    expect(screen.getByText("Easy miles")).toBeInTheDocument();
    expect(screen.getByText("Long aerobic session")).toBeInTheDocument();
  });

  it("copies the canonical live URL and exposes current named JSON/CSV links", async () => {
    history("runs");

    fireEvent.click(screen.getByTestId("log-history-copy-link"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `http://localhost/log?path=${encodeURIComponent(pagePath)}&view=runs`
    ));
    expect(screen.getByTestId("log-history-export-json")).toHaveAttribute(
      "href",
      `/api/page/log/query?path=${encodeURIComponent(pagePath)}&view=runs`
    );
    expect(screen.getByTestId("log-history-export-csv")).toHaveAttribute(
      "href",
      `/api/page/log/query?path=${encodeURIComponent(pagePath)}&view=runs&format=csv`
    );
  });
});
