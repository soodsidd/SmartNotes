/**
 * SN-211 — Companion icon highlights when an answer is ready (closed panel).
 *
 * Unit coverage for the pure decision helpers that drive the closed-panel
 * companion affordance, plus source-wiring assertions confirming the shell and
 * immersive PDF reader render/clear the ready + working states off the existing
 * durable-turn terminal stream (no second turn lifecycle).
 */

import * as fs from "fs";
import * as path from "path";

import {
  resolveCompanionIconState,
  shouldLightCompanionReady,
} from "@/lib/ai-sidebar";

// ─── shouldLightCompanionReady: terminal event → ready decision ────────────────

describe("SN-211 shouldLightCompanionReady", () => {
  it("lights ready when a turn completes successfully while the panel is closed", () => {
    expect(shouldLightCompanionReady("completed", false)).toBe(true);
    // Unknown/absent status is treated as success by describeTerminalTurnStatus.
    expect(shouldLightCompanionReady(undefined, false)).toBe(true);
    expect(shouldLightCompanionReady("", false)).toBe(true);
  });

  it("never lights ready while the panel is open (completion is already viewed)", () => {
    expect(shouldLightCompanionReady("completed", true)).toBe(false);
    expect(shouldLightCompanionReady(undefined, true)).toBe(false);
  });

  it("never lights ready for error / cancel / interrupted terminal outcomes", () => {
    expect(shouldLightCompanionReady("failed", false)).toBe(false);
    expect(shouldLightCompanionReady("cancelled", false)).toBe(false);
    expect(shouldLightCompanionReady("interrupted", false)).toBe(false);
  });
});

// ─── resolveCompanionIconState: mutually-exclusive display state ───────────────

describe("SN-211 resolveCompanionIconState", () => {
  it("shows ready (not working) when an answer is ready and the panel is closed", () => {
    expect(
      resolveCompanionIconState({ answerReady: true, turnPending: false, panelOpen: false })
    ).toEqual({ ready: true, working: false });
  });

  it("shows the quiet working state while a turn runs and the panel is closed", () => {
    expect(
      resolveCompanionIconState({ answerReady: false, turnPending: true, panelOpen: false })
    ).toEqual({ ready: false, working: true });
  });

  it("ready wins over working when both flags are set", () => {
    expect(
      resolveCompanionIconState({ answerReady: true, turnPending: true, panelOpen: false })
    ).toEqual({ ready: true, working: false });
  });

  it("suppresses both states while the panel is open (opening clears the badge)", () => {
    expect(
      resolveCompanionIconState({ answerReady: true, turnPending: false, panelOpen: true })
    ).toEqual({ ready: false, working: false });
    expect(
      resolveCompanionIconState({ answerReady: false, turnPending: true, panelOpen: true })
    ).toEqual({ ready: false, working: false });
  });

  it("shows nothing when idle and closed", () => {
    expect(
      resolveCompanionIconState({ answerReady: false, turnPending: false, panelOpen: false })
    ).toEqual({ ready: false, working: false });
  });
});

// ─── Shell + reader wiring (source assertions) ────────────────────────────────

const SHELL_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
  "utf8"
);
const PDF_READER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/immersive-pdf-reader.tsx"),
  "utf8"
);

describe("SN-211 shell wiring", () => {
  it("tracks a watched turn id and pending flag independent of the transcript observer", () => {
    expect(SHELL_SRC).toContain("watchedTurnIdRef");
    expect(SHELL_SRC).toContain("setCompanionTurnPending");
    expect(SHELL_SRC).toContain("setCompanionAnswerReady");
  });

  it("detects the closed-panel terminal event before the transcript-bound guard", () => {
    const watcherIdx = SHELL_SRC.indexOf("event.turn_id === watchedTurnIdRef.current");
    const boundGuardIdx = SHELL_SRC.indexOf("event.turn_id !== activeTurnIdRef.current");
    expect(watcherIdx).toBeGreaterThan(-1);
    expect(boundGuardIdx).toBeGreaterThan(-1);
    // The background watcher must run BEFORE the transcript-bound early return,
    // otherwise a detached (closed-panel) turn would be dropped.
    expect(watcherIdx).toBeLessThan(boundGuardIdx);
  });

  it("gates the ready decision through shouldLightCompanionReady with the live panel state", () => {
    expect(SHELL_SRC).toContain("shouldLightCompanionReady(status, aiOpenRef.current)");
  });

  it("lights ready from terminal reconcile when the panel is still closed", () => {
    const reconcileIdx = SHELL_SRC.indexOf("const reattachOrReconcileTurn");
    expect(reconcileIdx).toBeGreaterThan(-1);
    // Limit the slice to this callback so we don't pick up the chat_event watcher.
    const nextCallback = SHELL_SRC.indexOf("const clearCompanionScopeOnPage", reconcileIdx);
    const reconcileBody = SHELL_SRC.slice(
      reconcileIdx,
      nextCallback > reconcileIdx ? nextCallback : reconcileIdx + 8000
    );
    expect(reconcileBody).toContain("shouldLightCompanionReady(terminalStatus, aiOpenRef.current)");
    expect(reconcileBody).toContain("setCompanionAnswerReady(true)");
    expect(reconcileBody).toContain("setCompanionTurnPending(false)");
    // Working/watcher must clear on reconcile whether success or failure.
    expect(reconcileBody).toContain("watchedTurnIdRef.current = null");
  });

  it("discovers durable turns while the companion is closed so navigate-away can reconcile", () => {
    // Closed-panel discovery must not require aiOpen — otherwise a turn that
    // finished during in-app navigation never hits terminal reconcile until open
    // (and opening would clear ready before it could show).
    expect(SHELL_SRC).toMatch(
      /SN-211: also run while the companion is CLOSED[\s\S]*?if \(!vaultUiStateHydrated\) \{\s*return;\s*\}/
    );
    expect(SHELL_SRC).not.toMatch(
      /SN-211: also run while the companion is CLOSED[\s\S]*?if \(!vaultUiStateHydrated \|\| !aiOpen\)/
    );
  });

  it("clears the ready highlight when the companion opens", () => {
    expect(SHELL_SRC).toMatch(/if \(aiOpen\) \{\s*setCompanionAnswerReady\(false\);/);
    expect(SHELL_SRC).toContain("aiOpenRef.current = aiOpen;");
  });

  it("stops watching on cancel so a stopped turn never lights ready", () => {
    const cancelIdx = SHELL_SRC.indexOf("const handleAiCancel");
    const cancelBody = SHELL_SRC.slice(cancelIdx, cancelIdx + 900);
    expect(cancelBody).toContain("watchedTurnIdRef.current = null;");
    expect(cancelBody).toContain("setCompanionTurnPending(false);");
    expect(cancelBody).not.toContain("setCompanionAnswerReady(true)");
  });

  it("renders ready and working indicators on the desktop/mobile ai-toggle button", () => {
    expect(SHELL_SRC).toContain('data-testid="companion-ready-indicator"');
    expect(SHELL_SRC).toContain('data-testid="companion-working-indicator"');
    expect(SHELL_SRC).toContain("isAiReady={companionIconReady}");
    expect(SHELL_SRC).toContain("isAiWorking={companionIconWorking}");
  });

  it("passes the closed-panel states down to the immersive PDF reader", () => {
    expect(SHELL_SRC).toContain("companionAnswerReady={companionIconReady}");
    expect(SHELL_SRC).toContain("companionWorking={companionIconWorking}");
  });
});

describe("SN-211 immersive PDF reader wiring", () => {
  it("threads and renders the companion ready + working badge on the reader control", () => {
    expect(PDF_READER_SRC).toContain('data-testid="pdf-reader-companion-ready-indicator"');
    expect(PDF_READER_SRC).toContain('data-testid="pdf-reader-companion-working-indicator"');
    expect(PDF_READER_SRC).toContain("companionAnswerReady");
    expect(PDF_READER_SRC).toContain("companionWorking");
  });

  it("only shows the reader badge while the companion is closed", () => {
    expect(PDF_READER_SRC).toContain("!companionOpen && companionAnswerReady");
    expect(PDF_READER_SRC).toContain("!companionOpen && companionWorking");
  });
});
