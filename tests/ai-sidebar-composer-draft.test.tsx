/**
 * @jest-environment jsdom
 */

import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiSidebar, type AiComposerAttachment, type AiSidebarMessage } from "@/components/ai-sidebar";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    require("react").createElement("div", null, children),
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("remark-math", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: jest.fn() }));

function renderCompanion(
  overrides: Partial<React.ComponentProps<typeof AiSidebar>> = {}
) {
  const props: React.ComponentProps<typeof AiSidebar> = {
    pageTitle: "Optics note",
    scopeLabel: "Whole note",
    tokenLabel: "direct edit",
    activeScope: "whole",
    scopeOptions: [{ value: "whole", label: "Whole note" }],
    keepConversation: false,
    onKeepConversationChange: jest.fn(),
    activeProviderLabel: "Codex",
    activeModelLabel: "gpt-5.4",
    assistantLabel: "James",
    messages: [] as AiSidebarMessage[],
    composerResetKey: 0,
    disabled: false,
    isTurnActive: false,
    providers: [],
    verboseEnabled: true,
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
    onScopeChange: jest.fn(),
    onAttach: jest.fn(),
    ...overrides,
  };

  return {
    ...render(<AiSidebar {...props} />),
    props,
  };
}

describe("Companion composer local draft", () => {
  it("keeps typing local and submits the current prompt text", () => {
    const onSubmit = jest.fn();
    renderCompanion({ onSubmit });

    const input = screen.getByTestId("ai-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Summarize the calibration notes" } });
    expect(input.value).toBe("Summarize the calibration notes");

    fireEvent.click(screen.getByTestId("ai-send-btn"));

    expect(onSubmit).toHaveBeenCalledWith("Summarize the calibration notes", []);
    expect(input.value).toBe("");
  });

  it("preserves draft and attachments through a close snapshot and remount", async () => {
    const onComposerSnapshot = jest.fn();
    const onSubmit = jest.fn();
    const view = renderCompanion({ onComposerSnapshot, onSubmit });

    const input = screen.getByTestId("ai-input") as HTMLTextAreaElement;
    const file = new File(["# Close/reopen\n\nKeep this."], "saved-draft.md", {
      type: "text/markdown",
    });

    fireEvent.change(input, { target: { value: "Keep this unsent draft" } });
    fireEvent.paste(input, {
      clipboardData: {
        files: [file],
      },
    });

    await waitFor(() => expect(screen.getByText("saved-draft.md")).toBeTruthy());
    expect(onComposerSnapshot).not.toHaveBeenCalled();

    view.unmount();

    expect(onComposerSnapshot).toHaveBeenCalledTimes(1);
    const snapshot = onComposerSnapshot.mock.calls[0][0] as {
      draft: string;
      attachments: AiComposerAttachment[];
    };
    expect(snapshot.draft).toBe("Keep this unsent draft");
    expect(snapshot.attachments).toEqual([
      expect.objectContaining({
        kind: "markdown",
        name: "saved-draft.md",
        content: "# Close/reopen\n\nKeep this.",
      }),
    ]);

    renderCompanion({
      initialComposerDraft: snapshot.draft,
      initialComposerAttachments: snapshot.attachments,
      onSubmit,
    });

    expect((screen.getByTestId("ai-input") as HTMLTextAreaElement).value).toBe(
      "Keep this unsent draft"
    );
    expect(screen.getByText("saved-draft.md")).toBeTruthy();

    fireEvent.click(screen.getByTestId("ai-send-btn"));
    expect(onSubmit).toHaveBeenCalledWith("Keep this unsent draft", snapshot.attachments);
  });

  it("clears the local draft and persisted snapshot when the shell changes the reset key", async () => {
    const onComposerSnapshot = jest.fn();
    const attachment: AiComposerAttachment = {
      id: "attachment-1",
      kind: "markdown",
      name: "old-page.md",
      content: "stale",
    };
    const view = renderCompanion({
      composerResetKey: "page-a::whole",
      initialComposerDraft: "Draft tied to the first page",
      initialComposerAttachments: [attachment],
      onComposerSnapshot,
    });

    expect((screen.getByTestId("ai-input") as HTMLTextAreaElement).value).toBe(
      "Draft tied to the first page"
    );
    expect(screen.getByText("old-page.md")).toBeTruthy();

    view.rerender(
      <AiSidebar
        {...view.props}
        composerResetKey="page-b::whole"
        initialComposerDraft="Draft tied to the first page"
        initialComposerAttachments={[attachment]}
        onComposerSnapshot={onComposerSnapshot}
      />
    );

    await waitFor(() => {
      expect((screen.getByTestId("ai-input") as HTMLTextAreaElement).value).toBe("");
    });
    expect(screen.queryByText("old-page.md")).toBeNull();
    expect(onComposerSnapshot).toHaveBeenCalledWith({ draft: "", attachments: [] });
  });

  it("SN-254: injects a prefilled draft when composerInjectKey changes without clearing attachments", async () => {
    const onComposerSnapshot = jest.fn();
    const attachment: AiComposerAttachment = {
      id: "attachment-1",
      kind: "markdown",
      name: "keep-me.md",
      content: "kept",
    };
    const view = renderCompanion({
      composerInjectKey: 0,
      initialComposerDraft: "",
      initialComposerAttachments: [attachment],
      onComposerSnapshot,
    });

    expect((screen.getByTestId("ai-input") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("keep-me.md")).toBeTruthy();

    view.rerender(
      <AiSidebar
        {...view.props}
        composerInjectKey={1}
        initialComposerDraft="Continue this Jupyter inline AI task"
        initialComposerAttachments={[attachment]}
        onComposerSnapshot={onComposerSnapshot}
      />
    );

    await waitFor(() => {
      expect((screen.getByTestId("ai-input") as HTMLTextAreaElement).value).toBe(
        "Continue this Jupyter inline AI task"
      );
    });
    expect(screen.getByText("keep-me.md")).toBeTruthy();
    expect(onComposerSnapshot).toHaveBeenCalledWith({
      draft: "Continue this Jupyter inline AI task",
      attachments: [attachment],
    });
  });

  it("submits the exact prompt text with local text attachments", async () => {
    const onSubmit = jest.fn();
    const onAttach = jest.fn();
    renderCompanion({ onSubmit, onAttach });

    const input = screen.getByTestId("ai-input") as HTMLTextAreaElement;
    const file = new File(["# Findings\n\nStable output."], "findings.md", {
      type: "text/markdown",
    });

    fireEvent.paste(input, {
      clipboardData: {
        files: [file],
      },
    });

    await waitFor(() => expect(screen.getByText("findings.md")).toBeTruthy());

    fireEvent.change(input, { target: { value: "Use this attachment" } });
    fireEvent.click(screen.getByTestId("ai-send-btn"));

    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [prompt, attachments] = onSubmit.mock.calls[0] as [
      string,
      AiComposerAttachment[],
    ];
    expect(prompt).toBe("Use this attachment");
    expect(attachments).toEqual([
      expect.objectContaining({
        kind: "markdown",
        name: "findings.md",
        content: "# Findings\n\nStable output.",
      }),
    ]);
  });
});
