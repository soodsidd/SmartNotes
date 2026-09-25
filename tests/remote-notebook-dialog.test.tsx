/**
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RemoteNotebookForm } from "@/components/remote-notebook-dialog";
import {
  listServerFolders,
  validateServerFolder,
} from "@/lib/api/fs-native";
import { registerPortableNotebook } from "@/lib/api/notebook-registry";

jest.mock("@/lib/api/fs-native", () => ({
  createServerFolder: jest.fn(),
  listServerFolders: jest.fn(),
  pickNativeFolder: jest.fn(),
  validateServerFolder: jest.fn(),
}));

jest.mock("@/lib/api/notebook-registry", () => ({
  registerPortableNotebook: jest.fn(),
}));

const listing = {
  path: "C:\\Server\\Notes",
  parentPath: "C:\\Server",
  roots: [{ label: "Home", path: "C:\\Users\\Owner" }],
  entries: [{ name: "Projects", path: "C:\\Server\\Notes\\Projects" }],
};

function mockMobilePwa() {
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
  Object.defineProperty(window, "matchMedia", {
    value: jest.fn().mockImplementation((query: string) => ({
      matches:
        query === "(display-mode: standalone)" ||
        query === "(max-width: 767px)" ||
        query === "(pointer: coarse)",
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
    configurable: true,
  });
}

describe("RemoteNotebookForm mobile server-folder flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMobilePwa();
    (listServerFolders as jest.Mock).mockResolvedValue(listing);
    (validateServerFolder as jest.Mock).mockResolvedValue({ valid: true, path: listing.path });
    (registerPortableNotebook as jest.Mock).mockResolvedValue({
      notebook: {
        id: "nb_1",
        name: "Mobile Notebook",
        rootPath: listing.path,
        path: "+nb_1",
        addedAt: "2026-07-01T00:00:00.000Z",
      },
    });
  });

  it("uses the in-app server browser in standalone mobile mode instead of the Windows picker", async () => {
    render(<RemoteNotebookForm />);

    expect(screen.queryByTestId("remote-notebook-pick-folder-btn")).not.toBeInTheDocument();
    expect(await screen.findByTestId("server-folder-browser")).toBeInTheDocument();
    expect(screen.getAllByText("This browser shows folders on the Smart Notes backend host, not folders on this phone.")).toHaveLength(2);
    expect(listServerFolders).toHaveBeenCalledWith(undefined);
  });

  it("selects a validated server folder and registers it", async () => {
    render(<RemoteNotebookForm />);

    fireEvent.click(await screen.findByTestId("server-folder-use-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-notebook-selected-path")).toHaveTextContent(listing.path);
    });

    fireEvent.click(screen.getByTestId("remote-notebook-register-btn"));
    await waitFor(() => {
      expect(registerPortableNotebook).toHaveBeenCalledWith(
        {
          rootPath: listing.path,
          name: undefined,
          createIfMissing: true,
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it("clears the loading state and shows a boundary error when listing fails", async () => {
    (listServerFolders as jest.Mock).mockRejectedValueOnce(
      new Error("Your phone can browse only folders visible to the Smart Notes backend host.")
    );

    render(<RemoteNotebookForm />);

    expect(await screen.findByTestId("server-folder-error")).toHaveTextContent(
      "Your phone can browse only folders visible to the Smart Notes backend host."
    );
    expect(screen.queryByText("Loading server folders")).not.toBeInTheDocument();
  });
});
