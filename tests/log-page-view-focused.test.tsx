/**
 * @jest-environment jsdom
 */

import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LogPageView } from "@/components/log-page-view";
import { FocusedLogShell } from "@/components/focused-log-shell";
import { focusedLogUrl } from "@/lib/api/log";
import type { LogRow } from "@/lib/log-contract";
import {
  acceptFocusedLogEntry,
  emptyFocusedLogState,
  focusedLogStorageKey,
  readFocusedLogState,
  saveFocusedLogDraft,
  writeFocusedLogState,
} from "@/lib/focused-log-local-state";

const mockFetchLogDocument = jest.fn();
const mockAppendLogRow = jest.fn();
const mockSaveLogForm = jest.fn();
const mockUpdateLogRow = jest.fn();
const mockDeleteLogRow = jest.fn();
const mockSocketHandlers = new Map<string, (...args: any[]) => void>();

jest.mock("@/lib/api/log", () => ({
  fetchLogDocument: (...args: unknown[]) => mockFetchLogDocument(...args),
  appendLogRow: (...args: unknown[]) => mockAppendLogRow(...args),
  saveLogForm: (...args: unknown[]) => mockSaveLogForm(...args),
  updateLogRow: (...args: unknown[]) => mockUpdateLogRow(...args),
  deleteLogRow: (...args: unknown[]) => mockDeleteLogRow(...args),
  focusedLogUrl: (path: string) => `/log?path=${encodeURIComponent(path)}`,
  focusedLogHistoryUrl: (path: string, view?: string) =>
    view
      ? `/log?path=${encodeURIComponent(path)}&view=${encodeURIComponent(view)}`
      : `/log?path=${encodeURIComponent(path)}&tab=history`,
}));

jest.mock("socket.io-client", () => ({
  io: () => ({
    on: (name: string, handler: (...args: any[]) => void) => void mockSocketHandlers.set(name, handler),
    off: (name: string) => void mockSocketHandlers.delete(name),
    disconnect: jest.fn(),
  }),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock("@/components/log-jsonforms", () => ({
  LogJsonForms: ({
    data,
    onChange,
  }: {
    data: Record<string, unknown>;
    onChange: (data: Record<string, unknown>, errors: unknown[]) => void;
  }) => {
    const ReactModule = require("react") as typeof React;
    return ReactModule.createElement(
      ReactModule.Fragment,
      null,
      ReactModule.createElement("input", {
        "data-testid": "mock-log-entry",
        value: String(data.entry ?? ""),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          onChange({ ...data, entry: event.target.value }, []);
        },
      }),
      ReactModule.createElement(
        "div",
        { "data-testid": "mock-log-data" },
        JSON.stringify(data)
      )
    );
  },
}));

const pagePath = "Notebook/Section/Workout.html";
const form = {
  version: 1 as const,
  schema: {
    type: "object" as const,
    properties: { entry: { type: "string", title: "Entry" } },
    required: ["entry"],
  },
  uischema: {
    type: "VerticalLayout",
    elements: [{ type: "Control", scope: "#/properties/entry" }],
  },
};

function response(rows: LogRow[] = []) {
  return {
    path: pagePath,
    version: 1 as const,
    schema: { fields: [{ id: "entry", name: "Entry", type: "text" as const, required: true }] },
    rows,
    form,
  };
}

const defaultedForm = {
  version: 1 as const,
  schema: {
    type: "object" as const,
    properties: {
      entry: { type: "string", title: "Entry", default: "Schema entry" },
      mood: { type: "string", title: "Mood", enum: ["steady", "energized"], default: "steady" },
      settings: {
        type: "object",
        properties: {
          units: { type: "string", default: "metric" },
        },
      },
    },
    required: ["entry"],
  },
  uischema: {
    type: "VerticalLayout",
    elements: [{ type: "Control", scope: "#/properties/entry" }],
  },
};

const historyForm = {
  version: 1 as const,
  schema: {
    type: "object" as const,
    properties: {
      entry: { type: "string", title: "Category", default: "travel" },
      amount: { type: "number", title: "Amount", default: 5 },
      notes: { type: "string", title: "Notes", default: "Manual draft" },
    },
    required: ["entry"],
  },
  uischema: {
    type: "VerticalLayout",
    elements: [
      { type: "Control", scope: "#/properties/entry" },
      { type: "Control", scope: "#/properties/amount" },
      { type: "Control", scope: "#/properties/notes" },
    ],
  },
  historySuggestion: {
    matchFields: ["entry"],
    copyFields: ["amount", "notes"],
  },
};

function historyResponse() {
  return {
    ...response([{
      id: "r_history01",
      createdAt: "2026-07-29T12:00:00.000Z",
      values: {
        entry: "travel",
        amount: 24,
        notes: "Prior note",
      },
    }]),
    schema: {
      fields: [
        { id: "entry", name: "Category", type: "text" as const, required: true },
        { id: "amount", name: "Amount", type: "number" as const },
        { id: "notes", name: "Notes", type: "text" as const },
      ],
    },
    form: historyForm,
  };
}

function defaultedResponse(rows: LogRow[] = []) {
  return {
    ...response(rows),
    form: defaultedForm,
  };
}

function renderFocused() {
  return render(<FocusedLogShell pagePath={pagePath} title="Workout" />);
}

beforeEach(() => {
  window.localStorage.clear();
  mockSocketHandlers.clear();
  mockFetchLogDocument.mockReset().mockImplementation(async () => response());
  mockAppendLogRow.mockReset();
  mockSaveLogForm.mockReset().mockImplementation(async () => response());
  mockUpdateLogRow.mockReset();
  mockDeleteLogRow.mockReset();
  Object.defineProperty(window.document, "visibilityState", { configurable: true, value: "visible" });
});

describe("focused LogPageView local-first workflow (SN-149)", () => {
  it("exposes accessible Form, History, Table, and Source tabs plus safe linked-form actions", async () => {
    mockFetchLogDocument.mockResolvedValue({
      ...response([{
        id: "r_linked01",
        createdAt: "2026-07-29T12:00:00.000Z",
        values: { entry: "Run" },
      }]),
      form: {
        ...form,
        views: [{
          id: "trend",
          name: "Recent trend",
          columns: [{ field: "entry", label: "Entry" }],
          presentation: "timeline",
        }],
        actions: [{ type: "open-history", label: "View trend", view: "trend" }],
      },
    });
    render(<LogPageView pagePath={pagePath} title="Workout" />);

    await screen.findByTestId("mock-log-entry");
    const linkedAction = screen.getByRole("link", { name: /View trend/ });
    expect(linkedAction).toHaveAttribute(
      "href",
      `/log?path=${encodeURIComponent(pagePath)}&view=trend`
    );
    const formTab = screen.getByTestId("log-tab-form");
    const historyTab = screen.getByTestId("log-tab-history");
    expect(screen.getByRole("tablist", { name: "Log views" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(formTab).toHaveAttribute("tabindex", "0");
    expect(historyTab).toHaveAttribute("tabindex", "-1");

    formTab.focus();
    fireEvent.keyDown(formTab, { key: "ArrowRight" });
    expect(historyTab).toHaveFocus();
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("log-history-timeline")).toBeInTheDocument();
  });

  it("shows a notebook suggestion without mutating manual values, then copies one field explicitly", async () => {
    mockFetchLogDocument.mockResolvedValue(historyResponse());
    render(<LogPageView pagePath={pagePath} title="Expenses" />);

    await screen.findByTestId("log-history-suggestion");
    expect(screen.getByText("Latest match")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("mock-log-data").textContent ?? "{}")).toEqual({
      entry: "travel",
      amount: 5,
      notes: "Manual draft",
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy previous Amount" }));
    expect(JSON.parse(screen.getByTestId("mock-log-data").textContent ?? "{}")).toEqual({
      entry: "travel",
      amount: 24,
      notes: "Manual draft",
    });
  });

  it("copies all suggested values with one explicit action in the focused shell", async () => {
    mockFetchLogDocument.mockResolvedValue(historyResponse());
    renderFocused();

    await screen.findByTestId("log-history-suggestion");
    expect(JSON.parse(screen.getByTestId("mock-log-data").textContent ?? "{}")).toEqual({
      entry: "travel",
      amount: 5,
      notes: "Manual draft",
    });

    fireEvent.click(screen.getByTestId("log-history-copy-all"));
    expect(JSON.parse(screen.getByTestId("mock-log-data").textContent ?? "{}")).toEqual({
      entry: "travel",
      amount: 24,
      notes: "Prior note",
    });
    expect(screen.getByTestId("log-draft-status").textContent).toContain("Saving");
  });

  it("restores a draft over schema defaults and fills only values absent from that draft", async () => {
    const drafted = saveFocusedLogDraft(emptyFocusedLogState(pagePath), {
      entry: "Draft entry",
      mood: "",
    });
    writeFocusedLogState(window.localStorage, drafted);
    mockFetchLogDocument.mockResolvedValue(defaultedResponse());

    renderFocused();

    await screen.findByDisplayValue("Draft entry");
    expect(JSON.parse(screen.getByTestId("mock-log-data").textContent ?? "{}")).toEqual({
      entry: "Draft entry",
      mood: "",
      settings: { units: "metric" },
    });
  });

  it("submits edited defaults and restores initialized defaults after a successful notebook submit", async () => {
    mockFetchLogDocument.mockResolvedValue(defaultedResponse());
    mockAppendLogRow.mockImplementation(async (_path, values) => {
      const row: LogRow = {
        id: "r_defaulted01",
        createdAt: "2026-07-30T12:00:00.000Z",
        values,
      };
      return { ...defaultedResponse([row]), row };
    });
    render(<LogPageView pagePath={pagePath} title="Workout" />);

    const input = await screen.findByDisplayValue("Schema entry");
    fireEvent.change(input, { target: { value: "Edited entry" } });
    fireEvent.click(screen.getByTestId("log-submit"));

    await waitFor(() => expect(mockAppendLogRow).toHaveBeenCalledWith(
      pagePath,
      {
        entry: "Edited entry",
        mood: "steady",
        settings: { units: "metric" },
      }
    ));
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId("mock-log-data").textContent ?? "{}")).toEqual({
        entry: "Schema entry",
        mood: "steady",
        settings: { units: "metric" },
      });
    });
  });

  it("exposes draft status and activity chrome through the actual focused shell", async () => {
    renderFocused();

    await screen.findByTestId("mock-log-entry");
    expect(screen.getByTestId("log-draft-status").textContent).toContain("Draft saves on this device");
    expect(screen.getByTestId("log-activity-strip")).toBeTruthy();
    expect(screen.getByRole("log", { name: "Focused log activity" }).textContent)
      .toContain("No local activity yet");
  });

  it("shows an unmistakable notebook bridge without enabling local-first behavior there", async () => {
    render(
      <LogPageView
        pagePath={pagePath}
        title="Workout"
        focusedShellHref={focusedLogUrl(pagePath)}
      />
    );

    await screen.findByTestId("mock-log-entry");
    expect(screen.getByText("Autosave + offline submit")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open focused log" });
    expect(link.getAttribute("href")).toBe(
      "/log?path=Notebook%2FSection%2FWorkout.html"
    );
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
    expect(screen.queryByTestId("log-draft-status")).toBeNull();
    expect(screen.queryByTestId("log-activity-strip")).toBeNull();
  });

  it("shows Saving → Saved (draft), writes on visibility-hide, and restores after remount", async () => {
    const view = renderFocused();
    const input = await screen.findByTestId("mock-log-entry");

    fireEvent.change(input, { target: { value: "Squat" } });
    expect(screen.getByTestId("log-draft-status").textContent).toContain("Saving");
    expect(screen.getByRole("status").textContent).toContain("Saving");

    Object.defineProperty(window.document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(window.document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByTestId("log-draft-status").textContent).toContain("Saved (draft)"));

    const stored = JSON.parse(window.localStorage.getItem(focusedLogStorageKey(pagePath)) ?? "{}") as {
      draft?: { values?: Record<string, unknown> };
    };
    expect(stored.draft?.values?.entry).toBe("Squat");
    expect(screen.getByRole("log").textContent).toContain("Draft saved on this device");

    view.unmount();
    renderFocused();
    expect(await screen.findByDisplayValue("Squat")).toBeTruthy();
    expect(screen.getByTestId("log-draft-status").textContent).toContain("Saved (draft)");
  });

  it("surfaces a draft persistence failure without blocking typing", async () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    renderFocused();
    const input = await screen.findByTestId("mock-log-entry");

    fireEvent.change(input, { target: { value: "Bench" } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByTestId("log-draft-status").textContent).toContain("Couldn’t save draft"));
    expect((input as HTMLInputElement).value).toBe("Bench");
    setItem.mockRestore();
  });

  it("accepts immediately, keeps pending actions safe, retries, and records activity", async () => {
    const serverRows: LogRow[] = [];
    mockFetchLogDocument.mockImplementation(async () => response(serverRows));
    mockAppendLogRow.mockRejectedValueOnce(new Error("offline"));

    renderFocused();
    const input = await screen.findByTestId("mock-log-entry");
    fireEvent.change(input, { target: { value: "Deadlift" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId("log-submit"));

    await waitFor(() => expect(screen.getByRole("log").textContent).toContain("Entry accepted locally"));
    await waitFor(() => expect(screen.getByRole("log").textContent).toContain("Sync failed — will retry"));
    expect((input as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByTestId("log-tab-table"));
    const pending = screen.getByText("pending sync");
    const rowId = pending.getAttribute("data-testid")?.replace("log-row-pending-", "");
    expect(rowId).toBeTruthy();
    expect(screen.queryByTestId(`log-row-edit-${rowId}`)).toBeNull();
    expect(screen.queryByTestId(`log-row-delete-${rowId}`)).toBeNull();

    mockAppendLogRow.mockImplementation(async (
      _path: string,
      _values: Record<string, unknown>,
      row: LogRow
    ) => {
      serverRows.push(row);
      return { ...response(serverRows), row };
    });
    fireEvent(window, new Event("online"));

    await waitFor(() => expect(screen.getByRole("log").textContent).toContain("Entry synced to vault"));
    await waitFor(() => expect(screen.queryByText("pending sync")).toBeNull());
    expect(screen.getByText("Deadlift")).toBeTruthy();
    expect(screen.getByRole("log").textContent).toContain("Retrying vault sync");
  });

  it("posts an accepted row even when the next larger syncing write exceeds local quota", async () => {
    const serverRows: LogRow[] = [];
    mockFetchLogDocument.mockImplementation(async () => response(serverRows));
    mockAppendLogRow.mockImplementation(async (
      _path: string,
      _values: Record<string, unknown>,
      row: LogRow
    ) => {
      serverRows.push(row);
      return { ...response(serverRows), row };
    });
    renderFocused();
    const input = await screen.findByTestId("mock-log-entry");

    const nativeSetItem = Storage.prototype.setItem;
    let writes = 0;
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      writes += 1;
      if (writes === 2) throw new Error("quota");
      return nativeSetItem.call(this, key, value);
    });
    fireEvent.change(input, { target: { value: "Quota-safe submit" } });
    fireEvent.click(screen.getByTestId("log-submit"));

    await waitFor(() => expect(mockAppendLogRow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readFocusedLogState(window.localStorage, pagePath).outbox).toHaveLength(0));
    expect(serverRows[0]?.values.entry).toBe("Quota-safe submit");
    setItem.mockRestore();
  });

  it("preserves the draft and pending row across a focused Source save, then clears only the draft", async () => {
    const accepted = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "Queued row" });
    const drafted = saveFocusedLogDraft(accepted.state, { entry: "Press" });
    writeFocusedLogState(window.localStorage, drafted);
    mockAppendLogRow.mockRejectedValue(new Error("offline"));

    renderFocused();
    await screen.findByDisplayValue("Press");

    fireEvent.click(screen.getByTestId("log-tab-source"));
    fireEvent.click(screen.getByTestId("log-source-save"));
    expect(await screen.findByDisplayValue("Press")).toBeTruthy();

    fireEvent.click(screen.getByTestId("log-tab-table"));
    expect(screen.getByText("Queued row")).toBeTruthy();
    expect(screen.getByText("pending sync")).toBeTruthy();
    fireEvent.click(screen.getByTestId("log-tab-form"));
    fireEvent.click(screen.getByTestId("log-draft-clear"));
    expect((screen.getByTestId("mock-log-entry") as HTMLInputElement).value).toBe("");
    const stored = JSON.parse(window.localStorage.getItem(focusedLogStorageKey(pagePath)) ?? "{}") as {
      draft?: unknown;
      outbox?: unknown[];
    };
    expect(stored.draft).toBeNull();
    expect(stored.outbox).toHaveLength(1);
  });

  it("preserves dirty Source text, local draft, and both outboxes across remote and storage refreshes", async () => {
    const local = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "Local pending" });
    const drafted = saveFocusedLogDraft(local.state, { entry: "Unsaved form draft" });
    writeFocusedLogState(window.localStorage, drafted);
    mockAppendLogRow.mockRejectedValue(new Error("offline"));

    renderFocused();
    await screen.findByDisplayValue("Unsaved form draft");
    fireEvent.click(screen.getByTestId("log-tab-source"));
    const source = screen.getByTestId("log-source-textarea") as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: "{\"unsavedSource\":true}" } });
    await act(async () => {
      mockSocketHandlers.get("file_updated")?.({ path: pagePath });
    });
    await waitFor(() => expect(mockFetchLogDocument.mock.calls.length).toBeGreaterThan(1));
    expect(source.value).toBe("{\"unsavedSource\":true}");

    const external = acceptFocusedLogEntry(
      readFocusedLogState(window.localStorage, pagePath),
      { entry: "Other tab pending" }
    );
    writeFocusedLogState(window.localStorage, external.state);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: focusedLogStorageKey(pagePath) }));
    });
    fireEvent.click(screen.getByTestId("log-tab-table"));
    expect(await screen.findByText("Local pending")).toBeTruthy();
    expect(screen.getByText("Other tab pending")).toBeTruthy();
    expect(screen.getAllByText("pending sync")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("log-tab-form"));
    expect(screen.getByDisplayValue("Unsaved form draft")).toBeTruthy();
    fireEvent.click(screen.getByTestId("log-tab-source"));
    expect((screen.getByTestId("log-source-textarea") as HTMLTextAreaElement).value)
      .toBe("{\"unsavedSource\":true}");
  });

  it("keeps a local pre-debounce draft authoritative when another tab writes storage", async () => {
    renderFocused();
    const input = await screen.findByTestId("mock-log-entry") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Local typing" } });
    expect(screen.getByRole("status").textContent).toContain("Saving");

    const external = saveFocusedLogDraft(
      readFocusedLogState(window.localStorage, pagePath),
      { entry: "Other tab draft" }
    );
    writeFocusedLogState(window.localStorage, external);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: focusedLogStorageKey(pagePath) }));
    });

    expect(input.value).toBe("Local typing");
    await waitFor(() => {
      expect(readFocusedLogState(window.localStorage, pagePath).draft?.values.entry).toBe("Local typing");
    });
    expect(screen.getByRole("status").textContent).toContain("Saved (draft)");
  });

  it("keeps a pending outbox row visible after deleting a durable row", async () => {
    const durable: LogRow = {
      id: "r_durable001",
      createdAt: "2026-07-27T09:00:00.000Z",
      values: { entry: "Durable" },
    };
    const pending = acceptFocusedLogEntry(emptyFocusedLogState(pagePath), { entry: "Pending" });
    writeFocusedLogState(window.localStorage, pending.state);
    mockFetchLogDocument.mockImplementation(async () => response([durable]));
    mockAppendLogRow.mockRejectedValue(new Error("offline"));
    mockDeleteLogRow.mockResolvedValue(response([]));

    renderFocused();
    await screen.findByDisplayValue("");
    fireEvent.click(screen.getByTestId("log-tab-table"));
    fireEvent.click(screen.getByTestId("log-row-delete-r_durable001"));

    await waitFor(() => expect(screen.queryByText("Durable")).toBeNull());
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("pending sync")).toBeTruthy();
  });

  it("does not overwrite a corrupt local record during load, reconnect, or autosave", async () => {
    const key = focusedLogStorageKey(pagePath);
    window.localStorage.setItem(key, "{broken");
    renderFocused();
    const input = await screen.findByTestId("mock-log-entry");
    expect(screen.getByRole("status").textContent).toContain("Couldn’t save draft");
    fireEvent(window, new Event("online"));
    fireEvent.change(input, { target: { value: "Must not replace unknown state" } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Couldn’t save draft"));
    expect(window.localStorage.getItem(key)).toBe("{broken");
  });

  it("shows a controlled error when GET fails and a partial snapshot cannot be used", async () => {
    window.localStorage.setItem(focusedLogStorageKey(pagePath), JSON.stringify({
      version: 1,
      pagePath,
      draft: null,
      outbox: [],
      activity: [],
      snapshot: {
        savedAt: "2026-07-27T10:00:00.000Z",
        document: { rows: "bad" },
        form: { schema: null, uischema: "bad" },
      },
    }));
    mockFetchLogDocument.mockRejectedValue(new Error("offline"));
    renderFocused();
    expect((await screen.findByTestId("log-error")).textContent).toContain("offline");
  });

  it("flushes an entry accepted after the prior drain while final refresh is still pending", async () => {
    const serverRows: LogRow[] = [];
    let releaseRefresh!: (value: ReturnType<typeof response>) => void;
    const heldRefresh = new Promise<ReturnType<typeof response>>((resolve) => {
      releaseRefresh = resolve;
    });
    mockFetchLogDocument
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(async () => heldRefresh)
      .mockImplementation(async () => response(serverRows));
    mockAppendLogRow.mockImplementation(async (
      _path: string,
      _values: Record<string, unknown>,
      row: LogRow
    ) => {
      serverRows.push(row);
      return { ...response(serverRows), row };
    });

    renderFocused();
    const input = await screen.findByTestId("mock-log-entry");
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.click(screen.getByTestId("log-submit"));
    await waitFor(() => expect(mockAppendLogRow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockFetchLogDocument).toHaveBeenCalledTimes(2));

    fireEvent.change(input, { target: { value: "B" } });
    fireEvent.click(screen.getByTestId("log-submit"));
    releaseRefresh(response(serverRows));

    await waitFor(() => expect(mockAppendLogRow).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const stored = readFocusedLogState(window.localStorage, pagePath);
      expect(stored.outbox).toHaveLength(0);
    });
    expect(serverRows.map((row) => row.values.entry)).toEqual(["A", "B"]);
  });

  it("keeps a remounted entry safe when the old component refresh finishes late", async () => {
    const serverRows: LogRow[] = [];
    let releaseOldRefresh!: (value: ReturnType<typeof response>) => void;
    const oldRefresh = new Promise<ReturnType<typeof response>>((resolve) => {
      releaseOldRefresh = resolve;
    });
    mockFetchLogDocument
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(async () => oldRefresh)
      .mockImplementation(async () => response(serverRows));
    mockAppendLogRow.mockImplementation(async (
      _path: string,
      _values: Record<string, unknown>,
      row: LogRow
    ) => {
      serverRows.push(row);
      return { ...response(serverRows), row };
    });

    const oldView = renderFocused();
    const oldInput = await screen.findByTestId("mock-log-entry");
    fireEvent.change(oldInput, { target: { value: "Old mount" } });
    fireEvent.click(screen.getByTestId("log-submit"));
    await waitFor(() => expect(mockFetchLogDocument).toHaveBeenCalledTimes(2));
    oldView.unmount();

    renderFocused();
    const newInput = await screen.findByTestId("mock-log-entry");
    fireEvent.change(newInput, { target: { value: "New mount" } });
    fireEvent.click(screen.getByTestId("log-submit"));
    await waitFor(() => expect(mockAppendLogRow).toHaveBeenCalledTimes(2));
    await act(async () => {
      releaseOldRefresh(response(serverRows));
    });

    await waitFor(() => expect(readFocusedLogState(window.localStorage, pagePath).outbox).toHaveLength(0));
    expect(serverRows.map((row) => row.values.entry)).toEqual(["Old mount", "New mount"]);
  });
});
