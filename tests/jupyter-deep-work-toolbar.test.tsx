/** @jest-environment jsdom */

import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { JupyterDeepWorkToolbar } from "@/components/jupyter-deep-work-toolbar";
import type { JupyterFocusState } from "@/lib/jupyter-focus";

function focus(overrides: Partial<JupyterFocusState> = {}): JupyterFocusState {
  return {
    pagePath: "C:/Projects/worktree",
    workspacePath: "src/index.ts",
    documentKind: "file",
    isDirty: true,
    activeCellIndex: null,
    activeCellId: null,
    caret: { line: 0, column: 4, offset: 4 },
    selection: {
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: 4, offset: 4 },
    },
    selectionRects: [],
    content: null,
    ...overrides,
  };
}

function menuItem(label: string): HTMLElement {
  const item = screen.getByText(label).closest('[data-slot="dropdown-menu-item"]');
  if (!item) throw new Error(`Missing menu item: ${label}`);
  return item as HTMLElement;
}

describe("JupyterDeepWorkToolbar (SN-257)", () => {
  it("shows only the slim primary chrome with identity, file state, annotations, and one overflow", () => {
    const onAnnotations = jest.fn();
    render(
      <JupyterDeepWorkToolbar
        identity={{
          projectName: "Smart Notes",
          branch: "av/sn-257",
          worktreeLabel: "SN-257",
          accessMode: "editable",
        }}
        title="Deep Work"
        focus={focus()}
        sessionStatus="ready"
        commandState={{ pending: null, failed: null }}
        onCommand={() => undefined}
        onBack={() => undefined}
        backLabel="Return to Ascent Vector"
        onAnnotations={onAnnotations}
        annotationCount={2}
      />
    );

    expect(screen.getByText("Smart Notes")).toBeInTheDocument();
    expect(screen.getByText("SN-257")).toBeInTheDocument();
    expect(screen.getByText("Editable")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("Dirty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to Ascent Vector" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("jupyter-toolbar-annotations"));
    expect(onAnnotations).toHaveBeenCalledTimes(1);

    expect(screen.queryByTestId("jupyter-toolbar-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("jupyter-toolbar-run")).not.toBeInTheDocument();
    expect(screen.queryByTestId("jupyter-toolbar-terminal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("jupyter-toolbar-new-notebook")).not.toBeInTheDocument();
    expect(screen.queryByTestId("jupyter-toolbar-companion")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("jupyter-toolbar-overflow")).toHaveLength(1);
  });

  it("keeps useful file and workspace commands in the single overflow", () => {
    const onCommand = jest.fn();
    const onBack = jest.fn();
    const onViewDiff = jest.fn();
    render(
      <JupyterDeepWorkToolbar
        identity={{ projectName: "Smart Notes", branch: "av/sn-257", accessMode: "editable" }}
        focus={focus()}
        sessionStatus="ready"
        commandState={{ pending: null, failed: null }}
        onCommand={onCommand}
        onBack={onBack}
        backLabel="Return to Ascent Vector"
        onViewDiff={onViewDiff}
        onRevealFolder={() => undefined}
        onReloadLab={() => undefined}
        onStopWorkspace={() => undefined}
      />
    );

    fireEvent.click(screen.getByTestId("jupyter-toolbar-overflow"));
    expect(screen.getByText("Format document")).toBeInTheDocument();
    expect(screen.getByText("Format selection")).toBeInTheDocument();
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByText("Reload files")).toBeInTheDocument();
    expect(screen.getByText("Reveal workspace folder")).toBeInTheDocument();
    expect(screen.getByText("Reload JupyterLab")).toBeInTheDocument();
    expect(screen.getByText("Stop workspace")).toBeInTheDocument();
    expect(screen.getByText("View diff in Ascent Vector")).toBeInTheDocument();
    expect(screen.getAllByText("Return to Ascent Vector")).toHaveLength(2);
    expect(screen.queryByText("Run file")).not.toBeInTheDocument();
    expect(screen.queryByText("Run selection")).not.toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
    expect(screen.queryByText("New notebook")).not.toBeInTheDocument();
    expect(screen.queryByText("Companion")).not.toBeInTheDocument();

    fireEvent.click(menuItem("Format document"));
    expect(onCommand).toHaveBeenCalledWith("format-document");
  });

  it("keeps kernel controls in the notebook overflow without duplicating Lab run controls", () => {
    render(
      <JupyterDeepWorkToolbar
        identity={{ projectName: "Smart Notes", accessMode: "editable" }}
        focus={focus({ documentKind: "notebook", selection: null })}
        sessionStatus="ready"
        commandState={{ pending: null, failed: null }}
        onCommand={() => undefined}
      />
    );

    fireEvent.click(screen.getByTestId("jupyter-toolbar-overflow"));
    expect(screen.getByText("Interrupt kernel")).toBeInTheDocument();
    expect(screen.getByText("Restart kernel")).toBeInTheDocument();
    expect(screen.getByText("Select kernel")).toBeInTheDocument();
    expect(screen.queryByText("Run cell")).not.toBeInTheDocument();
    expect(screen.queryByText("Run all cells")).not.toBeInTheDocument();
    expect(screen.queryByText("New notebook")).not.toBeInTheDocument();
  });

  it("disables write-capable overflow actions in a read-only workspace", () => {
    const onCommand = jest.fn();
    render(
      <JupyterDeepWorkToolbar
        identity={{ projectName: "Main checkout", branch: "main", accessMode: "read-only" }}
        focus={focus()}
        sessionStatus="ready"
        commandState={{ pending: null, failed: null }}
        onCommand={onCommand}
      />
    );

    expect(screen.getByText("Read-only")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("jupyter-toolbar-overflow"));
    expect(menuItem("Format document")).toHaveAttribute("data-disabled");
    expect(menuItem("Format selection")).toHaveAttribute("data-disabled");
    expect(menuItem("Terminal")).toHaveAttribute("data-disabled");
    fireEvent.click(menuItem("Format document"));
    fireEvent.click(menuItem("Terminal"));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("shows saved, empty, and command-error states without adding a Save control", () => {
    const { rerender } = render(
      <JupyterDeepWorkToolbar
        title="Deep Work"
        focus={focus({ isDirty: false })}
        sessionStatus="ready"
        commandState={{ pending: null, failed: null }}
        onCommand={() => undefined}
      />
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();

    rerender(
      <JupyterDeepWorkToolbar
        title="Deep Work"
        focus={null}
        sessionStatus="starting"
        commandState={{ pending: null, failed: "format-document", error: "JupyterLab could not format this document." }}
        onCommand={() => undefined}
      />
    );
    expect(screen.getByText("Waiting for JupyterLab")).toBeInTheDocument();
    expect(screen.getByText("No document selected")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("JupyterLab could not format this document.");
    expect(screen.queryByTestId("jupyter-toolbar-save")).not.toBeInTheDocument();
  });

  it("uses Back to notes and omits AV-only overflow actions for a local workspace", () => {
    render(
      <JupyterDeepWorkToolbar
        identity={{ projectName: "local-workspace", branch: "feature/local", accessMode: "editable" }}
        focus={focus()}
        sessionStatus="ready"
        commandState={{ pending: null, failed: null }}
        onCommand={() => undefined}
        onBack={() => undefined}
        backLabel="Back to notes"
      />
    );

    expect(screen.getByRole("button", { name: "Back to notes" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("jupyter-toolbar-overflow"));
    expect(screen.queryByText("View diff in Ascent Vector")).not.toBeInTheDocument();
    expect(screen.queryByText("Return to Ascent Vector")).not.toBeInTheDocument();
  });
});
