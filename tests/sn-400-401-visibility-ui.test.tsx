/** @jest-environment jsdom */

// SN-400 / SN-401: Follow toggle and the read-only Companion commands panel.

import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { CompanionCommandPanel } from "@/components/companion-command-panel";
import { JupyterDeepWorkToolbar } from "@/components/jupyter-deep-work-toolbar";
import { parseCompanionCommandEvent } from "@/lib/companion-command-activity";

function toolbar(props: Partial<React.ComponentProps<typeof JupyterDeepWorkToolbar>> = {}) {
  return render(
    <JupyterDeepWorkToolbar
      identity={{ projectName: "LeRobot", accessMode: "editable" }}
      focus={null}
      sessionStatus="ready"
      commandState={{ pending: null, failed: null }}
      onCommand={() => undefined}
      {...props}
    />
  );
}

describe("SN-400 Follow toggle", () => {
  it("reflects and flips the follow state", () => {
    const onFollowCompanionChange = jest.fn();
    toolbar({ followCompanion: true, onFollowCompanionChange });
    const button = screen.getByTestId("jupyter-toolbar-follow-companion");
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(onFollowCompanionChange).toHaveBeenCalledWith(false);
  });

  it("is absent outside Deep Work", () => {
    toolbar({ identity: undefined, onFollowCompanionChange: jest.fn(), onCompanionCommands: jest.fn() });
    expect(screen.queryByTestId("jupyter-toolbar-follow-companion")).toBeNull();
    expect(screen.queryByTestId("jupyter-toolbar-companion-commands")).toBeNull();
  });

  it("shows the command count and a running indicator", () => {
    const onCompanionCommands = jest.fn();
    toolbar({ onCompanionCommands, companionCommandCount: 3, companionCommandsRunning: 1 });
    const button = screen.getByTestId("jupyter-toolbar-companion-commands");
    expect(button).toHaveTextContent("Commands (3)");
    expect(screen.getByLabelText("Companion command running")).toBeInTheDocument();
    fireEvent.click(button);
    expect(onCompanionCommands).toHaveBeenCalled();
  });
});

describe("SN-401 CompanionCommandPanel", () => {
  it("explains the empty state", () => {
    render(<CompanionCommandPanel commands={[]} />);
    expect(screen.getByTestId("companion-command-empty")).toHaveTextContent("Computer access");
  });

  it("lists commands read-only, expanding running output and showing exit codes", () => {
    const running = parseCompanionCommandEvent("t", { command_id: "1", command: "python train.py", status: "running", output: "epoch 1" })!;
    const failed = parseCompanionCommandEvent("t", { command_id: "2", command: "pip list", status: "failed", exit_code: 2, output: "boom", output_truncated: true })!;
    const onClear = jest.fn();
    render(<CompanionCommandPanel commands={[running, failed]} onClear={onClear} />);
    const rows = screen.getAllByTestId("companion-command");
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual(["running", "failed"]);
    expect(screen.getByText("exit 2")).toBeInTheDocument();
    // Running output is shown without a click; finished output on demand.
    expect(screen.getAllByTestId("companion-command-output")).toHaveLength(1);
    fireEvent.click(screen.getByText("pip list"));
    const outputs = screen.getAllByTestId("companion-command-output");
    expect(outputs[1]).toHaveTextContent("earlier output trimmed");
    expect(outputs[1]).toHaveTextContent("boom");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByText("Clear"));
    expect(onClear).toHaveBeenCalled();
  });
});
