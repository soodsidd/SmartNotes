/**
 * SN-373 — page/section sidebar dots for live companion turns.
 *
 * Unit coverage for the per-thread working → ready → clear-on-acknowledge state
 * machine, plus source-wiring assertions confirming the shell feeds it from the
 * existing SN-132/SN-211 turn signals and the sidebar renders the dots on page
 * rows, unified section headers, and dual-pane rail section rows.
 */

import * as fs from "fs";
import * as path from "path";

import {
  EMPTY_COMPANION_THREAD_INDICATORS,
  COMPANION_INDICATOR_SETTLED_LIMIT,
  acknowledgeCompanionThread,
  clearCompanionThreadTurn,
  companionIndicatorThreadKey,
  lookupCompanionSidebarIndicator,
  markCompanionThreadWorking,
  resolveCompanionSidebarIndicators,
  resolveCompanionThreadTerminal,
  type CompanionThreadIndicatorState,
} from "@/lib/companion-thread-indicators";

const PAGE_A = { storePath: "Work/Research/a.html", scopeKey: "whole" };
const PAGE_B = { storePath: "Work/Research/b.html", scopeKey: "whole" };
const SECTION = { storePath: "Work/Research", scopeKey: "section" };
const notViewed = () => false;

function start(state: CompanionThreadIndicatorState, thread: typeof PAGE_A, turnId: string) {
  return markCompanionThreadWorking(state, { ...thread, turnId });
}

function rows(state: CompanionThreadIndicatorState) {
  return resolveCompanionSidebarIndicators(state);
}

describe("SN-373 per-thread working → ready → acknowledge", () => {
  it("a running page-scoped turn shows working on that page row", () => {
    const state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "t1");
    expect(rows(state)).toEqual({ pages: { "Work/Research/a.html": "working" }, sections: {} });
  });

  it("successful terminal turns the same row ready; acknowledging clears it", () => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "t1");
    state = resolveCompanionThreadTerminal(state, { turnId: "t1", status: "completed", isViewed: notViewed });
    expect(lookupCompanionSidebarIndicator(rows(state), "page", PAGE_A.storePath)).toBe("ready");
    state = acknowledgeCompanionThread(state, PAGE_A);
    expect(rows(state)).toEqual({ pages: {}, sections: {} });
  });

  it("does not light ready when the owner is viewing that thread at completion", () => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "t1");
    const viewedKey = companionIndicatorThreadKey(PAGE_A);
    state = resolveCompanionThreadTerminal(state, {
      turnId: "t1",
      status: "completed",
      isViewed: (key) => key === viewedKey,
    });
    expect(rows(state).pages).toEqual({});
  });

  it.each(["failed", "cancelled", "interrupted"])("%s terminal never shows green and clears working", (status) => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "t1");
    state = resolveCompanionThreadTerminal(state, { turnId: "t1", status, isViewed: notViewed });
    expect(rows(state).pages).toEqual({});
  });

  it("cancel / send failure clears the turn without green", () => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "t1");
    state = clearCompanionThreadTurn(state, "t1");
    expect(rows(state).pages).toEqual({});
    // A late `done` for the cancelled turn must not resurrect it.
    state = resolveCompanionThreadTerminal(state, { turnId: "t1", status: "completed", isViewed: notViewed });
    expect(rows(state).pages).toEqual({});
  });

  it("acknowledging a still-working thread keeps it pulsing", () => {
    const state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "t1");
    expect(acknowledgeCompanionThread(state, PAGE_A)).toBe(state);
  });

  it("a new turn on the thread supersedes its unread ready dot", () => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "t1");
    state = resolveCompanionThreadTerminal(state, { turnId: "t1", status: "completed", isViewed: notViewed });
    state = start(state, PAGE_A, "t2");
    expect(rows(state).pages["Work/Research/a.html"]).toBe("working");
  });

  it("a duplicate terminal (reconcile after live done) does not re-light an acknowledged dot", () => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "t1");
    state = resolveCompanionThreadTerminal(state, { turnId: "t1", status: "completed", isViewed: notViewed });
    state = acknowledgeCompanionThread(state, PAGE_A);
    state = resolveCompanionThreadTerminal(state, {
      turnId: "t1",
      status: "completed",
      isViewed: notViewed,
      fallbackThread: PAGE_A,
    });
    expect(rows(state).pages).toEqual({});
    // And a stale reattach of the settled turn does not restart working.
    expect(start(state, PAGE_A, "t1")).toBe(state);
  });

  it("reconcile can light ready for a turn this tab never saw start (fallback thread)", () => {
    const state = resolveCompanionThreadTerminal(EMPTY_COMPANION_THREAD_INDICATORS, {
      turnId: "t9",
      status: "completed",
      isViewed: notViewed,
      fallbackThread: PAGE_B,
    });
    expect(rows(state).pages["Work/Research/b.html"]).toBe("ready");
  });

  it("ignores live terminals for unknown turns without a fallback (other apps/tabs)", () => {
    const state = resolveCompanionThreadTerminal(EMPTY_COMPANION_THREAD_INDICATORS, {
      turnId: "foreign",
      status: "completed",
      isViewed: notViewed,
    });
    expect(state).toBe(EMPTY_COMPANION_THREAD_INDICATORS);
  });

  it("a stale fallback terminal does not clobber a newer turn on the same thread", () => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "t2");
    state = resolveCompanionThreadTerminal(state, {
      turnId: "t1",
      status: "completed",
      isViewed: notViewed,
      fallbackThread: PAGE_A,
    });
    expect(rows(state).pages["Work/Research/a.html"]).toBe("working");
  });

  it("bounds the settled-turn history", () => {
    let state = EMPTY_COMPANION_THREAD_INDICATORS;
    for (let index = 0; index < COMPANION_INDICATOR_SETTLED_LIMIT + 25; index += 1) {
      state = clearCompanionThreadTurn(state, `t${index}`);
    }
    expect(state.settledTurnIds).toHaveLength(COMPANION_INDICATOR_SETTLED_LIMIT);
  });
});

describe("SN-373 parallel turns stay independent (SN-322)", () => {
  it("multiple pages and a section can show indicators at once; finishing/acking one leaves the others", () => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, PAGE_A, "a1");
    state = start(state, PAGE_B, "b1");
    state = start(state, SECTION, "s1");
    expect(rows(state)).toEqual({
      pages: { "Work/Research/a.html": "working", "Work/Research/b.html": "working" },
      sections: { "Work/Research": "working" },
    });

    state = resolveCompanionThreadTerminal(state, { turnId: "a1", status: "completed", isViewed: notViewed });
    state = resolveCompanionThreadTerminal(state, { turnId: "s1", status: "completed", isViewed: notViewed });
    expect(rows(state)).toEqual({
      pages: { "Work/Research/a.html": "ready", "Work/Research/b.html": "working" },
      sections: { "Work/Research": "ready" },
    });

    state = acknowledgeCompanionThread(state, PAGE_A);
    expect(rows(state)).toEqual({
      pages: { "Work/Research/b.html": "working" },
      sections: { "Work/Research": "ready" },
    });
  });
});

describe("SN-373 row projection", () => {
  it("shared notebook-section threads land on the section row, not on every page", () => {
    const state = start(EMPTY_COMPANION_THREAD_INDICATORS, SECTION, "s1");
    const projected = rows(state);
    expect(projected.pages).toEqual({});
    expect(lookupCompanionSidebarIndicator(projected, "section", "Work/Research")).toBe("working");
    expect(lookupCompanionSidebarIndicator(projected, "page", PAGE_A.storePath)).toBeNull();
  });

  it("page-tree, parent-context and legacy heading threads land on their store page row", () => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, { storePath: "N/root.html", scopeKey: "page_tree" }, "p1");
    state = start(state, { storePath: "N/x.html", scopeKey: "parent_context" }, "p2");
    state = start(state, { storePath: "N/y.html", scopeKey: "section:intro" }, "p3");
    expect(rows(state)).toEqual({
      pages: { "N/root.html": "working", "N/x.html": "working", "N/y.html": "working" },
      sections: {},
    });
  });

  it("ready wins over working when two threads share a row", () => {
    let state = start(EMPTY_COMPANION_THREAD_INDICATORS, { storePath: "N/root.html", scopeKey: "whole" }, "w1");
    state = resolveCompanionThreadTerminal(state, { turnId: "w1", status: "completed", isViewed: notViewed });
    state = start(state, { storePath: "N/root.html", scopeKey: "page_tree" }, "p1");
    expect(rows(state).pages["N/root.html"]).toBe("ready");
  });

  it("normalizes Windows separators and trailing slashes on lookup", () => {
    const state = start(EMPTY_COMPANION_THREAD_INDICATORS, { storePath: "Work\\Research\\", scopeKey: "section" }, "s1");
    expect(lookupCompanionSidebarIndicator(rows(state), "section", "Work/Research/")).toBe("working");
  });
});

// ─── Source wiring: shell + sidebar use the shared state machine ───────────────

describe("SN-373 source wiring", () => {
  const shellSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "components", "notebook-shell-reliable.tsx"),
    "utf8"
  );

  it("feeds indicators from the existing turn signals (no second lifecycle)", () => {
    expect(shellSource).toContain("markCompanionThreadWorking(");
    expect(shellSource).toContain("resolveCompanionThreadTerminal(");
    expect(shellSource).toContain("clearCompanionThreadTurn(");
    expect(shellSource).toContain("acknowledgeCompanionThread(");
  });

  it("renders the dot on page rows and on both section-row variants", () => {
    expect(shellSource).toContain("CompanionThreadDot");
    expect(shellSource).toMatch(/companion-thread-dot-page-/);
    expect(shellSource).toMatch(/companion-thread-dot-section-/);
    expect(shellSource).toMatch(/companion-thread-dot-rail-section-/);
  });

  it("working dot is a motion-reduce aware muted pulse; ready is a solid accent dot", () => {
    expect(shellSource).toMatch(/bg-muted-foreground\/70 animate-pulse motion-reduce:animate-none/);
    expect(shellSource).toContain("Companion answer ready");
  });
});
