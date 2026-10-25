/**
 * @jest-environment jsdom
 */
/**
 * SN-377: transcript "Waiting for cell…" affordance and per-thread wake selection.
 */
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { AiSidebar, type AiSidebarMessage } from "@/components/ai-sidebar";
import {
  companionCellWakeIndicatorTurnId,
  isCompanionCellWakeWaiting,
  selectThreadCellWakeItems,
  upsertCompanionCellWake,
  type CompanionCellWake,
} from "@/lib/api/companion-cell-wakes";
import {
  EMPTY_COMPANION_THREAD_INDICATORS,
  clearCompanionThreadTurn,
  markCompanionThreadWorking,
  resolveCompanionSidebarIndicators,
  resolveCompanionThreadTerminal,
} from "@/lib/companion-thread-indicators";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => require("react").createElement("div", null, children),
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("remark-math", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: jest.fn() }));

const PAGE_A = "Nb/Sec/a.html";
const PAGE_B = "Nb/Sec/b.html";

function wake(overrides: Partial<CompanionCellWake> = {}): CompanionCellWake {
  return {
    wakeId: "wake-1",
    runId: "run-1",
    pagePath: PAGE_A,
    cellId: "slow-1",
    index: 2,
    note: "summarize the loss",
    status: "pending",
    outcome: null,
    threadKey: `${PAGE_A}::whole`,
    storePath: PAGE_A,
    scopeKey: "whole",
    sourceTurnId: "turn-1",
    runStartedAt: "2026-10-25T10:00:00.000Z",
    registeredAt: "2026-10-25T10:00:45.000Z",
    timeoutAt: "2026-10-25T10:30:45.000Z",
    settledAt: null,
    resumeTurnId: null,
    resumeUserMessageId: null,
    resumeAssistantMessageId: null,
    error: null,
    ...overrides,
  };
}

function renderCompanion(overrides: Partial<React.ComponentProps<typeof AiSidebar>> = {}) {
  const props: React.ComponentProps<typeof AiSidebar> = {
    pageTitle: "Analysis",
    scopeLabel: "Whole note",
    tokenLabel: "direct edit",
    activeScope: "whole",
    scopeOptions: [{ value: "whole", label: "Whole note" }],
    keepConversation: false,
    onKeepConversationChange: jest.fn(),
    activeProviderLabel: "Claude",
    activeModelLabel: "sonnet",
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
  return { ...render(<AiSidebar {...props} />), props };
}

describe("SN-377 cell wake selection", () => {
  it("shows only waiting wakes for the displayed thread", () => {
    const wakes = [
      wake(),
      wake({ wakeId: "wake-b", storePath: PAGE_B, threadKey: `${PAGE_B}::whole` }),
      wake({ wakeId: "wake-scope", scopeKey: "parent_context" }),
      wake({ wakeId: "wake-done", status: "resumed", resumeTurnId: "t2" }),
      wake({ wakeId: "wake-resuming", status: "resuming", registeredAt: "2026-10-25T10:05:00.000Z" }),
    ];
    const items = selectThreadCellWakeItems(wakes, { storePath: PAGE_A, scopeKey: "whole" }, { cancelling: ["wake-1"] });
    expect(items.map((item) => item.wakeId)).toEqual(["wake-1", "wake-resuming"]);
    expect(items[0]).toMatchObject({ cellLabel: "Cell 2 (slow-1)", note: "summarize the loss", resuming: false, cancelling: true });
    expect(items[1].resuming).toBe(true);
    expect(selectThreadCellWakeItems(wakes, { storePath: "", scopeKey: "whole" })).toEqual([]);
  });

  it("treats a resuming wake with a started turn as no longer waiting", () => {
    expect(isCompanionCellWakeWaiting(wake({ status: "resuming" }))).toBe(true);
    expect(isCompanionCellWakeWaiting(wake({ status: "resuming", resumeTurnId: "t2" }))).toBe(false);
    expect(isCompanionCellWakeWaiting(wake({ status: "cancelled" }))).toBe(false);
    expect(upsertCompanionCellWake([wake()], wake({ status: "cancelled" }))).toEqual([wake({ status: "cancelled" })]);
  });

  it("drives SN-373 dots: waiting pulses its page only, the resume turn then lights ready, cancel clears", () => {
    const wakeTurn = companionCellWakeIndicatorTurnId("wake-1");
    let state = markCompanionThreadWorking(EMPTY_COMPANION_THREAD_INDICATORS, { storePath: PAGE_A, scopeKey: "whole", turnId: "turn-1" });
    state = markCompanionThreadWorking(state, { storePath: PAGE_A, scopeKey: "whole", turnId: wakeTurn });
    // The parked provider turn finishing does not clear the wake's working dot.
    state = resolveCompanionThreadTerminal(state, { turnId: "turn-1", status: "completed", isViewed: () => false });
    expect(resolveCompanionSidebarIndicators(state).pages).toEqual({ [PAGE_A]: "working" });

    const resumed = markCompanionThreadWorking(clearCompanionThreadTurn(state, wakeTurn), { storePath: PAGE_A, scopeKey: "whole", turnId: "resume-1" });
    const done = resolveCompanionThreadTerminal(resumed, { turnId: "resume-1", status: "completed", isViewed: () => false });
    expect(resolveCompanionSidebarIndicators(done).pages).toEqual({ [PAGE_A]: "ready" });

    expect(resolveCompanionSidebarIndicators(clearCompanionThreadTurn(state, wakeTurn)).pages).toEqual({});
  });
});

describe("SN-377 Waiting for cell… transcript row", () => {
  it("renders the waiting row with note and owner cancel actions", () => {
    const onCancelCellWake = jest.fn();
    renderCompanion({
      cellWakes: selectThreadCellWakeItems([wake()], { storePath: PAGE_A, scopeKey: "whole" }),
      onCancelCellWake,
    });

    const row = screen.getByTestId("ai-cell-wake");
    expect(row.getAttribute("role")).toBe("status");
    expect(row.getAttribute("data-wake-state")).toBe("waiting");
    expect(row.textContent).toContain("Waiting for cell…");
    expect(row.textContent).toContain("Cell 2 (slow-1)");
    expect(row.textContent).toContain("Note: summarize the loss");
    // Replaces the empty-conversation placeholder.
    expect(screen.queryByText(/Ask anything/)).toBeNull();

    fireEvent.click(screen.getByTestId("ai-cell-wake-stop"));
    fireEvent.click(screen.getByTestId("ai-cell-wake-interrupt"));
    expect(onCancelCellWake.mock.calls).toEqual([
      ["wake-1", false],
      ["wake-1", true],
    ]);
  });

  it("shows resuming without cancel actions, and disables actions while cancelling", () => {
    const { rerender, props } = renderCompanion({
      cellWakes: [{ ...selectThreadCellWakeItems([wake()], { storePath: PAGE_A, scopeKey: "whole" })[0], resuming: true }],
      onCancelCellWake: jest.fn(),
    });
    expect(screen.getByTestId("ai-cell-wake").textContent).toContain("Cell finished — resuming…");
    expect(screen.queryByTestId("ai-cell-wake-stop")).toBeNull();

    rerender(
      <AiSidebar
        {...props}
        cellWakes={selectThreadCellWakeItems([wake()], { storePath: PAGE_A, scopeKey: "whole" }, { cancelling: ["wake-1"], errors: { "wake-1": "Network down" } })}
      />
    );
    expect((screen.getByTestId("ai-cell-wake-stop") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("ai-cell-wake").textContent).toContain("Network down");
  });
});
