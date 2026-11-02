/**
 * @jest-environment jsdom
 *
 * SN-406: Companion composer dictation — append-not-replace, silence auto-stop
 * hand-off, and the speech-engine-offline path that keeps the recording.
 */

import "@testing-library/jest-dom";
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AiSidebar, type AiSidebarMessage } from "@/components/ai-sidebar";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => require("react").createElement("div", null, children),
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("remark-math", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: jest.fn() }));

const recorderInstances: Array<{ onAutoStop: (reason: string) => void; stop: jest.Mock; start: jest.Mock }> = [];

jest.mock("@/lib/speech/recorder", () => {
  class DictationCaptureError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  class DictationRecorder {
    onAutoStop: (reason: string) => void;
    start = jest.fn(async () => undefined);
    stop = jest.fn(async () => ({ pcm16: new Int16Array(16000 * 2), sampleRate: 16000, durationSeconds: 2 }));
    cancel = jest.fn(async () => undefined);
    constructor(options: { onAutoStop: (reason: string) => void }) {
      this.onAutoStop = options.onAutoStop;
      recorderInstances.push(this as never);
    }
  }
  return { DictationRecorder, DictationCaptureError };
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function renderCompanion() {
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
  };
  return render(<AiSidebar {...props} />);
}

describe("Companion composer dictation", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    recorderInstances.length = 0;
    fetchMock.mockReset();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it("tap to start / tap to stop appends the transcript to the existing draft", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { text: "hello from the phone", chunks: 1 }));
    renderCompanion();
    const input = screen.getByTestId("ai-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Existing draft" } });

    const mic = screen.getByTestId("ai-dictation-btn");
    expect(mic).toHaveAttribute("aria-label", "Dictate");
    await act(async () => fireEvent.click(mic));
    await waitFor(() => expect(mic).toHaveAttribute("data-dictation-phase", "recording"));
    expect(mic).toHaveAttribute("aria-label", "Stop dictation");
    expect(screen.getByTestId("ai-dictation-status")).toHaveTextContent(/Listening 0:00/);

    await act(async () => fireEvent.click(mic));
    await waitFor(() => expect(input.value).toBe("Existing draft hello from the phone"));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/speech/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers["x-sample-rate"]).toBe("16000");
    expect(mic).toHaveAttribute("data-dictation-phase", "idle");
  });

  it("silence auto-stop transcribes and appends without a second tap", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { text: "auto stopped" }));
    renderCompanion();
    const input = screen.getByTestId("ai-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Keep this." } });
    const mic = screen.getByTestId("ai-dictation-btn");
    await act(async () => fireEvent.click(mic));
    await waitFor(() => expect(mic).toHaveAttribute("data-dictation-phase", "recording"));

    await act(async () => recorderInstances[0].onAutoStop("silence"));
    await waitFor(() => expect(input.value).toBe("Keep this. auto stopped"));
    expect(recorderInstances[0].stop).toHaveBeenCalledTimes(1);
  });

  it("engine offline: shows a clear message, keeps the clip, leaves the draft, and Retry appends", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: "Speech engine offline.", code: "engine_offline" }));
    renderCompanion();
    const input = screen.getByTestId("ai-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Draft stays" } });
    const mic = screen.getByTestId("ai-dictation-btn");
    await act(async () => fireEvent.click(mic));
    await waitFor(() => expect(mic).toHaveAttribute("data-dictation-phase", "recording"));
    await act(async () => fireEvent.click(mic));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Speech engine offline/);
    expect(alert).toHaveTextContent(/recording is kept/);
    expect(input.value).toBe("Draft stays");
    // A held clip blocks a new recording until it is retried or discarded.
    expect(mic).toBeDisabled();
    // The composer still works.
    fireEvent.change(input, { target: { value: "Draft stays, edited" } });
    expect(screen.getByTestId("ai-send-btn")).not.toBeDisabled();

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "recovered words" }));
    await act(async () => fireEvent.click(screen.getByTestId("dictation-retry")));
    await waitFor(() => expect(input.value).toBe("Draft stays, edited recovered words"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mic).not.toBeDisabled();
    // Retry re-sent the same held clip.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1].body as Blob).size).toBe(16000 * 2 * 2);
    expect((fetchMock.mock.calls[0][1].body as Blob).size).toBe(16000 * 2 * 2);
  });

  it("network failure also keeps the clip; Discard drops it explicitly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderCompanion();
    const mic = screen.getByTestId("ai-dictation-btn");
    await act(async () => fireEvent.click(mic));
    await waitFor(() => expect(mic).toHaveAttribute("data-dictation-phase", "recording"));
    await act(async () => fireEvent.click(mic));
    expect(await screen.findByRole("alert")).toHaveTextContent(/recording is kept/);
    await act(async () => fireEvent.click(screen.getByTestId("dictation-discard")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mic).not.toBeDisabled();
  });
});

describe("SN-407 Companion composer push-to-talk", () => {
  beforeEach(() => {
    recorderInstances.length = 0;
    (globalThis as { fetch: unknown }).fetch = jest.fn(async () => jsonResponse(200, { text: "by shortcut" }));
  });

  it("holding the configured F8 key in the composer records; releasing appends the transcript", async () => {
    window.localStorage.setItem("smart-notes-dictation-ptt-key", "F8");
    renderCompanion();
    const input = screen.getByTestId("ai-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Draft" } });
    const mic = screen.getByTestId("ai-dictation-btn");
    await waitFor(() => expect(mic).toHaveAttribute("title", expect.stringContaining("hold F8")));
    input.focus();
    await act(async () => {
      fireEvent.keyDown(input, { key: "F8", code: "F8" });
    });
    await waitFor(() => expect(mic).toHaveAttribute("data-dictation-phase", "recording"));
    expect(screen.getByTestId("ai-dictation-status")).toHaveTextContent(/release F8 to insert/);
    await act(async () => {
      fireEvent.keyDown(input, { key: "F8", code: "F8", repeat: true });
    });
    await act(async () => {
      fireEvent.keyUp(input, { key: "F8", code: "F8" });
    });
    await waitFor(() => expect(input.value).toBe("Draft by shortcut"));
    expect(recorderInstances).toHaveLength(1);
  });

  it("the tap mic status reflects the configured (default 3 s) auto-stop window", async () => {
    renderCompanion();
    const mic = screen.getByTestId("ai-dictation-btn");
    await act(async () => {
      fireEvent.click(mic);
    });
    await waitFor(() => expect(mic).toHaveAttribute("data-dictation-phase", "recording"));
    expect(screen.getByTestId("ai-dictation-status")).toHaveTextContent(/stops after 3 s of silence/);
  });
});
