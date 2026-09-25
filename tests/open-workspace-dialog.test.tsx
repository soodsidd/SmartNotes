/** @jest-environment jsdom */

import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { OpenWorkspaceDialog } from "@/components/open-workspace-dialog";
import { pickNativeFolder } from "@/lib/api/fs-native";
import { fetchJupyterWorkspaceSessionStatus } from "@/lib/api/jupyter";

jest.mock("@/lib/api/fs-native", () => ({ pickNativeFolder: jest.fn() }));
jest.mock("@/lib/api/jupyter", () => ({ fetchJupyterWorkspaceSessionStatus: jest.fn() }));

const mockedPickFolder = jest.mocked(pickNativeFolder);
const mockedStatus = jest.mocked(fetchJupyterWorkspaceSessionStatus);

describe("OpenWorkspaceDialog (SN-259)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("opens an owner-selected disk folder without AV identity or a parent allowlist", async () => {
    mockedStatus.mockResolvedValue({
      status: "stopped",
      pagePath: "C:/Projects/LeRobot",
      rootPath: "C:/Projects/LeRobot",
      accessMode: "editable",
      resolvedAccessMode: "editable",
      branch: "feature/local",
    });
    const onOpenWorkspace = jest.fn();
    const onOpenChange = jest.fn();
    render(
      <OpenWorkspaceDialog open onOpenChange={onOpenChange} onOpenWorkspace={onOpenWorkspace} />
    );

    fireEvent.change(screen.getByLabelText("Absolute folder path"), {
      target: { value: "C:/Projects/LeRobot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: "C:/Projects/LeRobot",
      projectName: "LeRobot",
      branch: "feature/local",
      requestedAccess: "editable",
      ownerOpen: true,
    })));
    const opened = onOpenWorkspace.mock.calls[0][0];
    expect(opened).not.toHaveProperty("projectId");
    expect(opened).not.toHaveProperty("repoId");
    expect(opened).not.toHaveProperty("workItemId");
    expect(opened).not.toHaveProperty("returnUrl");
    expect(mockedStatus).toHaveBeenCalledWith({
      rootPath: "C:/Projects/LeRobot",
      requestedAccess: "editable",
      ownerOpen: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("fills the path from the native folder picker", async () => {
    mockedPickFolder.mockResolvedValue({
      available: true,
      cancelled: false,
      path: "C:\\Projects\\worktrees\\picked",
    });
    render(<OpenWorkspaceDialog open onOpenChange={() => undefined} onOpenWorkspace={() => undefined} />);

    fireEvent.click(screen.getByTestId("open-workspace-pick-folder"));
    await waitFor(() => expect(screen.getByLabelText("Absolute folder path")).toHaveValue(
      "C:\\Projects\\worktrees\\picked"
    ));
  });

  it("requires a clear unlock action before opening a detected default branch as editable", async () => {
    mockedStatus.mockResolvedValue({
      status: "stopped",
      pagePath: "C:/Projects/worktrees/main-checkout",
      rootPath: "C:/Projects/worktrees/main-checkout",
      accessMode: "read-only",
      resolvedAccessMode: "read-only",
      branch: "main",
    });
    const onOpenWorkspace = jest.fn();
    render(
      <OpenWorkspaceDialog open onOpenChange={() => undefined} onOpenWorkspace={onOpenWorkspace} />
    );

    fireEvent.change(screen.getByLabelText("Absolute folder path"), {
      target: { value: "C:/Projects/worktrees/main-checkout" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    expect(await screen.findByTestId("open-workspace-default-branch-warning")).toHaveTextContent(
      "main"
    );
    expect(onOpenWorkspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("open-workspace-unlock-editing"));
    expect(onOpenWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      branch: "main",
      requestedAccess: "editable",
      ownerOpen: true,
      defaultBranchEditConfirmed: true,
    }));
  });

  it("shows remaining folder-validation errors without leaving the dialog", async () => {
    mockedStatus.mockRejectedValue(new Error("Workspace path does not exist: C:/Missing/project"));
    const onOpenWorkspace = jest.fn();
    render(
      <OpenWorkspaceDialog open onOpenChange={() => undefined} onOpenWorkspace={onOpenWorkspace} />
    );

    fireEvent.change(screen.getByLabelText("Absolute folder path"), {
      target: { value: "C:/Missing/project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace path does not exist");
    expect(onOpenWorkspace).not.toHaveBeenCalled();
  });
});
