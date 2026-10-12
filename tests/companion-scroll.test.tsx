/**
 * @jest-environment jsdom
 */

/**
 * SN-285: Companion transcript follows a streaming reply only while the reader
 * is parked at the live bottom; scrolling up preserves position and offers
 * Jump to latest.
 */

import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AiSidebar, type AiSidebarMessage } from "@/components/ai-sidebar";
import {
  COMPANION_FOLLOW_THRESHOLD_PX,
  classifyTranscriptChange,
  isNearBottom,
  resolveCompanionScroll,
  snapshotTranscript,
} from "@/lib/companion-scroll";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    require("react").createElement("div", null, children),
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("remark-math", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: jest.fn() }));

const user = (id: string): AiSidebarMessage => ({ id, role: "user", content: `prompt ${id}` });
const assistant = (id: string, content: string, isStreaming = false): AiSidebarMessage => ({
  id,
  role: "assistant",
  content,
  isStreaming,
});

describe("companion scroll policy helpers", () => {
  it("treats positions within the threshold as near the bottom", () => {
    expect(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(
      isNearBottom({ scrollTop: 600 - COMPANION_FOLLOW_THRESHOLD_PX, scrollHeight: 1000, clientHeight: 400 })
    ).toBe(true);
    expect(
      isNearBottom({ scrollTop: 600 - COMPANION_FOLLOW_THRESHOLD_PX - 1, scrollHeight: 1000, clientHeight: 400 })
    ).toBe(false);
  });

  it("classifies open/restore/replace/clear as reset", () => {
    const a = snapshotTranscript([user("u1"), assistant("a1", "hi")]);
    expect(classifyTranscriptChange(null, a)).toBe("reset");
    expect(classifyTranscriptChange(snapshotTranscript([]), a)).toBe("reset");
    expect(classifyTranscriptChange(a, snapshotTranscript([user("x1"), assistant("x2", "other")]))).toBe("reset");
    expect(classifyTranscriptChange(a, snapshotTranscript([user("u1")]))).toBe("reset");
  });

  it("classifies a newly appended prompt as sent and token growth as update", () => {
    const base = [user("u1"), assistant("a1", "hi")];
    const before = snapshotTranscript(base);
    expect(classifyTranscriptChange(before, snapshotTranscript([...base, user("u2")]))).toBe("sent");
    expect(classifyTranscriptChange(before, snapshotTranscript([user("u1"), assistant("a1", "hi there", true)]))).toBe(
      "update"
    );
    expect(classifyTranscriptChange(before, snapshotTranscript([...base, assistant("a2", "tool")]))).toBe("update");
  });

  it("follows on reset/sent, and on update only while following", () => {
    expect(resolveCompanionScroll("reset", false)).toBe("follow");
    expect(resolveCompanionScroll("sent", false)).toBe("follow");
    expect(resolveCompanionScroll("update", true)).toBe("follow");
    expect(resolveCompanionScroll("update", false)).toBe("preserve");
  });
});

describe("Companion transcript scroll behavior", () => {
  const clientHeight = 400;
  let scrollHeight = 1000;

  function renderTranscript(messages: AiSidebarMessage[]) {
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
      messages,
      verboseEnabled: true,
      onSubmit: jest.fn(),
      onScopeChange: jest.fn(),
    };
    const view = render(<AiSidebar {...props} />);
    const transcript = screen.getByTestId("ai-transcript");
    Object.defineProperty(transcript, "clientHeight", { configurable: true, get: () => clientHeight });
    Object.defineProperty(transcript, "scrollHeight", { configurable: true, get: () => scrollHeight });
    const rerender = (next: AiSidebarMessage[]) => view.rerender(<AiSidebar {...props} messages={next} />);
    return { transcript, rerender };
  }

  function scrollTo(node: HTMLElement, top: number) {
    act(() => {
      node.scrollTop = top;
      fireEvent.scroll(node);
    });
  }

  beforeEach(() => {
    scrollHeight = 1000;
  });

  it("auto-follows streaming tokens while near the bottom", () => {
    const { transcript, rerender } = renderTranscript([user("u1"), assistant("a1", "Hel", true)]);
    rerender([user("u1"), assistant("a1", "Hello", true)]);
    expect(transcript.scrollTop).toBe(1000);

    scrollTo(transcript, 1000 - clientHeight);
    scrollHeight = 1400;
    rerender([user("u1"), assistant("a1", "Hello world", true)]);
    expect(transcript.scrollTop).toBe(1400);
    expect(screen.queryByTestId("ai-jump-to-latest")).toBeNull();
  });

  it("preserves position when scrolled up, then Jump to latest rejoins following", () => {
    const { transcript, rerender } = renderTranscript([user("u1"), assistant("a1", "Hel", true)]);
    scrollTo(transcript, 120);
    expect(screen.getByTestId("ai-jump-to-latest")).toBeTruthy();

    scrollHeight = 1600;
    rerender([user("u1"), assistant("a1", "Hello there, more tokens", true)]);
    expect(transcript.scrollTop).toBe(120);

    fireEvent.click(screen.getByRole("button", { name: /jump to latest/i }));
    expect(transcript.scrollTop).toBe(1600);
    expect(screen.queryByTestId("ai-jump-to-latest")).toBeNull();

    scrollHeight = 1900;
    rerender([user("u1"), assistant("a1", "Hello there, more tokens and more", true)]);
    expect(transcript.scrollTop).toBe(1900);
  });

  it("returning to the bottom manually resumes following", () => {
    const { transcript, rerender } = renderTranscript([user("u1"), assistant("a1", "Hel", true)]);
    scrollTo(transcript, 50);
    scrollTo(transcript, scrollHeight - clientHeight - 10);
    expect(screen.queryByTestId("ai-jump-to-latest")).toBeNull();
    scrollHeight = 1300;
    rerender([user("u1"), assistant("a1", "Hello!", true)]);
    expect(transcript.scrollTop).toBe(1300);
  });

  it("lands at the latest message when a conversation is restored or a prompt is sent", () => {
    const { transcript, rerender } = renderTranscript([user("u1"), assistant("a1", "Hi")]);
    scrollTo(transcript, 0);

    scrollHeight = 1200;
    rerender([user("u1"), assistant("a1", "Hi"), user("u2")]);
    expect(transcript.scrollTop).toBe(1200);

    scrollTo(transcript, 0);
    scrollHeight = 2200;
    rerender([user("r1"), assistant("r2", "Restored conversation")]);
    expect(transcript.scrollTop).toBe(2200);
    expect(screen.queryByTestId("ai-jump-to-latest")).toBeNull();
  });
});
