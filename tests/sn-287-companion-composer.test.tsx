/**
 * @jest-environment jsdom
 */

/**
 * SN-287: Companion composer — composition-safe send, explicit mobile
 * newline vs Send, follow-up drafting during a running turn, and failed-send
 * retention with a retry that cannot duplicate an accepted server-owned turn.
 */

import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AiSidebar,
  type AiComposerAttachment,
  type AiComposerFailedSend,
  type AiSidebarMessage,
} from "@/components/ai-sidebar";
import {
  COMPOSER_COMPOSITION_COMMIT_GRACE_MS,
  isDuplicateTurnIdRejection,
  resolveComposerEnterAction,
} from "@/lib/ai-sidebar";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    require("react").createElement("div", null, children),
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("remark-math", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: jest.fn() }));

const SHELL_SRC = fs
  .readFileSync(path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"), "utf8")
  .replace(/\r\n/g, "\n");

function renderCompanion(overrides: Partial<React.ComponentProps<typeof AiSidebar>> = {}) {
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
    ...overrides,
  };
  const view = render(<AiSidebar {...props} />);
  return {
    ...view,
    props,
    rerenderWith: (next: Partial<React.ComponentProps<typeof AiSidebar>>) =>
      view.rerender(<AiSidebar {...props} {...next} />),
  };
}

const input = () => screen.getByTestId("ai-input") as HTMLTextAreaElement;

describe("SN-287 resolveComposerEnterAction", () => {
  it("submits a plain desktop Enter on an idle composer", () => {
    expect(resolveComposerEnterAction({ key: "Enter" })).toBe("submit");
  });

  it("never sends while an IME composition is active", () => {
    expect(resolveComposerEnterAction({ key: "Enter", isComposing: true })).toBe("pass");
    expect(resolveComposerEnterAction({ key: "Enter", keyCode: 229 })).toBe("pass");
  });

  it("treats the Safari post-compositionend Enter as the IME commit", () => {
    expect(resolveComposerEnterAction({ key: "Enter", msSinceCompositionEnd: 0 })).toBe("pass");
    expect(
      resolveComposerEnterAction({
        key: "Enter",
        msSinceCompositionEnd: COMPOSER_COMPOSITION_COMMIT_GRACE_MS - 1,
      })
    ).toBe("pass");
    expect(
      resolveComposerEnterAction({
        key: "Enter",
        msSinceCompositionEnd: COMPOSER_COMPOSITION_COMMIT_GRACE_MS + 1,
      })
    ).toBe("submit");
  });

  it("inserts a newline for Shift+Enter and for any mobile Enter", () => {
    expect(resolveComposerEnterAction({ key: "Enter", shiftKey: true })).toBe("newline");
    expect(resolveComposerEnterAction({ key: "Enter", mobile: true })).toBe("newline");
    expect(resolveComposerEnterAction({ key: "Enter", mobile: true, turnActive: true })).toBe("newline");
  });

  it("holds (does not send) a desktop Enter while a turn is running", () => {
    expect(resolveComposerEnterAction({ key: "Enter", turnActive: true })).toBe("hold");
  });

  it("ignores other keys", () => {
    expect(resolveComposerEnterAction({ key: "a" })).toBe("pass");
  });
});

describe("SN-287 isDuplicateTurnIdRejection", () => {
  it("recognizes only the server's 409 turn_id reuse rejection", () => {
    expect(isDuplicateTurnIdRejection(409, "turn_id already exists")).toBe(true);
    expect(isDuplicateTurnIdRejection(409, "something else")).toBe(false);
    expect(isDuplicateTurnIdRejection(500, "turn_id already exists")).toBe(false);
    expect(isDuplicateTurnIdRejection(409, undefined)).toBe(false);
  });
});

describe("SN-287 composition-safe desktop composer", () => {
  it("does not send when Enter commits IME composition text", () => {
    const onSubmit = jest.fn();
    renderCompanion({ onSubmit });

    fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: "にほんご" } });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    // Safari: compositionend fires first, then a non-composing Enter keydown.
    fireEvent.compositionEnd(input());
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input().value).toBe("にほんご");
  });

  it("sends on a deliberate Enter after composition has settled", () => {
    const onSubmit = jest.fn();
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    renderCompanion({ onSubmit });

    fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: "日本語で要約して" } });
    fireEvent.compositionEnd(input());
    now.mockReturnValue(1_000 + COMPOSER_COMPOSITION_COMMIT_GRACE_MS + 200);
    fireEvent.keyDown(input(), { key: "Enter" });
    now.mockRestore();

    expect(onSubmit).toHaveBeenCalledWith("日本語で要約して", []);
  });

  it("labels the desktop soft-keyboard key as send", () => {
    renderCompanion();
    expect(input().getAttribute("enterkeyhint")).toBe("send");
  });
});

describe("SN-287 mobile newline vs Send", () => {
  it("Enter never submits on mobile; the Send button does", () => {
    const onSubmit = jest.fn();
    renderCompanion({ onSubmit, mobile: true });

    expect(input().getAttribute("enterkeyhint")).toBe("enter");
    fireEvent.change(input(), { target: { value: "Line one" } });
    const enter = fireEvent.keyDown(input(), { key: "Enter" });
    // Not default-prevented: the textarea inserts the newline natively.
    expect(enter).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input(), { target: { value: "Line one\nLine two" } });
    fireEvent.click(screen.getByTestId("ai-send-btn"));
    expect(onSubmit).toHaveBeenCalledWith("Line one\nLine two", []);
  });
});

describe("SN-287 follow-up drafting during a running turn", () => {
  it("keeps the composer editable and never starts another turn", async () => {
    const onSubmit = jest.fn();
    const view = renderCompanion({ onSubmit, isTurnActive: true });

    expect(input().disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Attach file" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("ai-send-btn")).toBeNull();
    expect(screen.getByTestId("ai-stop-btn")).toBeTruthy();

    fireEvent.change(input(), { target: { value: "Follow-up: what about chapter 3?" } });
    const enter = fireEvent.keyDown(input(), { key: "Enter" });
    expect(enter).toBe(false); // held, not inserted and not sent
    expect(onSubmit).not.toHaveBeenCalled();

    // Attachments can be added while the turn runs.
    const file = new File(["notes"], "follow-up.md", { type: "text/markdown" });
    fireEvent.paste(input(), { clipboardData: { files: [file] } });
    await waitFor(() => expect(screen.getByText("follow-up.md")).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();

    // Turn finishes: the draft and attachment are still there and now send.
    view.rerenderWith({ isTurnActive: false });
    expect(input().value).toBe("Follow-up: what about chapter 3?");
    fireEvent.click(screen.getByTestId("ai-send-btn"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      "Follow-up: what about chapter 3?",
      [expect.objectContaining({ name: "follow-up.md", kind: "markdown" })]
    );
  });

  it("keeps the follow-up draft on mobile while a turn runs", () => {
    const onSubmit = jest.fn();
    renderCompanion({ onSubmit, isTurnActive: true, mobile: true });
    expect(input().disabled).toBe(false);
    expect(input().placeholder).toBe("Draft a follow-up…");
    fireEvent.change(input(), { target: { value: "next question" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input().value).toBe("next question");
  });
});

describe("SN-287 failed-send retention", () => {
  const attachment: AiComposerAttachment = {
    id: "a-1",
    kind: "markdown",
    name: "evidence.md",
    content: "# kept",
  };
  const failedSend: AiComposerFailedSend = {
    id: "11111111-1111-4111-8111-111111111111",
    prompt: "Summarize the calibration notes",
    attachments: [attachment],
    error: "Could not reach Smart Notes AI.",
  };

  it("shows the failed send with Retry wired to the shell", () => {
    const onRetryFailedSend = jest.fn();
    renderCompanion({ failedSend, onRetryFailedSend, onEditFailedSend: jest.fn() });

    expect(screen.getByTestId("ai-failed-send").textContent).toContain("Not sent");
    expect(screen.getByTestId("ai-failed-send").textContent).toContain("Could not reach Smart Notes AI.");
    fireEvent.click(screen.getByTestId("ai-failed-send-retry"));
    expect(onRetryFailedSend).toHaveBeenCalledTimes(1);
  });

  it("disables Retry while a turn is running so it cannot start a second turn", () => {
    renderCompanion({ failedSend, isTurnActive: true, onRetryFailedSend: jest.fn() });
    expect((screen.getByTestId("ai-failed-send-retry") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Edit restores the prompt and attachments ahead of any follow-up draft", () => {
    const onEditFailedSend = jest.fn();
    const view = renderCompanion({ failedSend, onEditFailedSend, onRetryFailedSend: jest.fn() });

    fireEvent.change(input(), { target: { value: "and the follow-up" } });
    act(() => {
      fireEvent.click(screen.getByTestId("ai-failed-send-edit"));
    });

    expect(onEditFailedSend).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("Summarize the calibration notes\n\nand the follow-up");
    expect(screen.getByText("evidence.md")).toBeTruthy();
    view.rerenderWith({ failedSend: null, onEditFailedSend });
    expect(screen.queryByTestId("ai-failed-send")).toBeNull();
  });

  it("does not revoke image previews at submit (the shell keeps them for retry)", () => {
    const revoke = jest.fn();
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    try {
      const image: AiComposerAttachment = {
        id: "img-1",
        kind: "image",
        name: "plot.png",
        path: "/uploads/plot.png",
        url: "blob:plot",
      };
      const onSubmit = jest.fn();
      renderCompanion({ onSubmit, initialComposerAttachments: [image] });
      fireEvent.click(screen.getByTestId("ai-send-btn"));
      expect(onSubmit).toHaveBeenCalledWith("", [image]);
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      URL.revokeObjectURL = original;
    }
  });
});

describe("SN-287 shell retry identity (source contract)", () => {
  it("re-sends a retry under the original turn identity", () => {
    expect(SHELL_SRC).toContain("const turnId = retryIdentity?.turnId ?? safeRandomUUID();");
    expect(SHELL_SRC).toContain("retryIdentity?.userMessageId ??");
    expect(SHELL_SRC).toContain("retryIdentity?.assistantMessageId ??");
  });

  it("treats a 409 turn_id reuse as proof of acceptance and reattaches instead of re-sending", () => {
    const branch = SHELL_SRC.indexOf("isDuplicateTurnIdRejection(response.status, payload.error)");
    expect(branch).toBeGreaterThan(-1);
    const block = SHELL_SRC.slice(branch, branch + 900);
    expect(block).toContain("await reattachOrReconcileTurn(submitPath, submitScopeKey, pointer);");
    expect(block).toContain("return;");
  });

  it("retains the failed composer draft with its turn identity and never retries during a live turn", () => {
    expect(SHELL_SRC).toContain("retainFailedSend(errorMessage, { turnId, userMessageId, assistantMessageId });");
    expect(SHELL_SRC).toMatch(/if \(!failed \|\| activeTurnIdRef\.current\) \{\n\s+return;/);
    expect(SHELL_SRC).toContain('void handleAiSubmit(prompt, attachments, { origin: "composer" })');
  });
});
