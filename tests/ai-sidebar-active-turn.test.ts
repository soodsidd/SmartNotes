import {
  createEmptyCompanionSidecar,
  describeTerminalTurnStatus,
  findCompanionActiveTurn,
  getCompanionActiveTurn,
  normalizeCompanionActiveTurn,
  normalizeCompanionSidecar,
  normalizeVolatileCompanionSession,
  resolveLiveTurnReattachAction,
  setCompanionActiveTurn,
  setCompanionScopeSession,
  shouldApplyTurnEventSeq,
  type CompanionActiveTurn,
} from "@/lib/ai-sidebar";

const turn: CompanionActiveTurn = {
  turnId: "turn-123",
  assistantMessageId: "assistant-1",
  lastSeq: 4,
  startedAt: 1_700_000_000_000,
};

describe("SN-132 companion active-turn pointer", () => {
  describe("normalizeCompanionActiveTurn", () => {
    it("accepts a well-formed pointer", () => {
      expect(normalizeCompanionActiveTurn(turn)).toEqual(turn);
    });

    it("rejects pointers missing turnId or assistantMessageId", () => {
      expect(normalizeCompanionActiveTurn({ ...turn, turnId: "" })).toBeNull();
      expect(normalizeCompanionActiveTurn({ ...turn, assistantMessageId: "" })).toBeNull();
      expect(normalizeCompanionActiveTurn(null)).toBeNull();
      expect(normalizeCompanionActiveTurn("nope")).toBeNull();
    });

    it("defaults an invalid lastSeq to -1 and fills startedAt", () => {
      const normalized = normalizeCompanionActiveTurn({
        turnId: "t",
        assistantMessageId: "a",
        lastSeq: Number.NaN,
      });
      expect(normalized?.lastSeq).toBe(-1);
      expect(typeof normalized?.startedAt).toBe("number");
    });
  });

  describe("setCompanionActiveTurn", () => {
    it("creates a scope holding only the pointer when none exists", () => {
      const next = setCompanionActiveTurn(createEmptyCompanionSidecar(), "whole", turn);
      expect(getCompanionActiveTurn(next, "whole")).toEqual(turn);
      expect(next.scopes.whole.messages).toEqual([]);
    });

    it("attaches the pointer to an existing transcript without dropping messages", () => {
      const base = setCompanionScopeSession(createEmptyCompanionSidecar(), "whole", {
        messages: [{ id: "user-1", role: "user", content: "hi" }],
      });
      const next = setCompanionActiveTurn(base, "whole", turn);
      expect(next.scopes.whole.messages).toHaveLength(1);
      expect(getCompanionActiveTurn(next, "whole")).toEqual(turn);
    });

    it("advances the resume cursor by replacing the pointer", () => {
      let sidecar = setCompanionActiveTurn(createEmptyCompanionSidecar(), "whole", turn);
      sidecar = setCompanionActiveTurn(sidecar, "whole", { ...turn, lastSeq: 9 });
      expect(getCompanionActiveTurn(sidecar, "whole")?.lastSeq).toBe(9);
    });

    it("clearing the pointer drops an otherwise-empty scope", () => {
      let sidecar = setCompanionActiveTurn(createEmptyCompanionSidecar(), "whole", turn);
      sidecar = setCompanionActiveTurn(sidecar, "whole", null);
      expect(sidecar.scopes.whole).toBeUndefined();
    });

    it("clearing the pointer keeps a scope that still has messages", () => {
      let sidecar = setCompanionScopeSession(createEmptyCompanionSidecar(), "whole", {
        messages: [{ id: "a-1", role: "assistant", content: "done" }],
        activeTurn: turn,
      });
      sidecar = setCompanionActiveTurn(sidecar, "whole", null);
      expect(sidecar.scopes.whole.messages).toHaveLength(1);
      expect(getCompanionActiveTurn(sidecar, "whole")).toBeNull();
    });
  });

  describe("findCompanionActiveTurn", () => {
    it("discovers a live pointer even when a different scope is currently selected", () => {
      const sidecar = setCompanionActiveTurn(
        createEmptyCompanionSidecar(),
        "page_tree",
        turn
      );

      expect(findCompanionActiveTurn(sidecar, "whole")).toEqual({
        scopeKey: "page_tree",
        pointer: turn,
      });
    });

    it("prefers the selected scope when more than one pointer is present", () => {
      let sidecar = setCompanionActiveTurn(createEmptyCompanionSidecar(), "whole", {
        ...turn,
        turnId: "turn-whole",
        startedAt: turn.startedAt + 1,
      });
      sidecar = setCompanionActiveTurn(sidecar, "section", turn);

      expect(findCompanionActiveTurn(sidecar, "section")).toEqual({
        scopeKey: "section",
        pointer: turn,
      });
    });
  });

  describe("setCompanionScopeSession preserves live turns", () => {
    it("keeps a scope with no messages when an active turn is present", () => {
      const next = setCompanionScopeSession(createEmptyCompanionSidecar(), "whole", {
        messages: [],
        activeTurn: turn,
      });
      expect(getCompanionActiveTurn(next, "whole")).toEqual(turn);
    });

    it("still deletes an empty scope with no active turn", () => {
      const base = setCompanionScopeSession(createEmptyCompanionSidecar(), "whole", {
        messages: [{ id: "u", role: "user", content: "x" }],
      });
      const next = setCompanionScopeSession(base, "whole", { messages: [] });
      expect(next.scopes.whole).toBeUndefined();
    });
  });

  describe("persistence round-trips", () => {
    it("survives sidecar normalization", () => {
      const sidecar = setCompanionActiveTurn(createEmptyCompanionSidecar(), "whole", turn);
      const round = normalizeCompanionSidecar(JSON.parse(JSON.stringify(sidecar)));
      expect(getCompanionActiveTurn(round, "whole")).toEqual(turn);
    });

    it("survives volatile-session normalization", () => {
      const round = normalizeVolatileCompanionSession({
        pagePath: "Notebook/Page.html",
        scopeKey: "whole",
        messages: [],
        activeTurn: turn,
      });
      expect(round?.activeTurn).toEqual(turn);
    });

    it("drops a malformed pointer during normalization", () => {
      const round = normalizeCompanionSidecar({
        scopes: { whole: { messages: [], activeTurn: { turnId: "", assistantMessageId: "" } } },
      });
      expect(getCompanionActiveTurn(round, "whole")).toBeNull();
    });
  });

  describe("resolveLiveTurnReattachAction", () => {
    it("reattaches when the pointer's turn is still running in scope", () => {
      expect(
        resolveLiveTurnReattachAction(turn, [{ turn_id: "turn-123" }, { turn_id: "other" }])
      ).toBe("reattach");
    });

    it("reconciles when the turn is no longer active (completed/interrupted while away)", () => {
      expect(resolveLiveTurnReattachAction(turn, [{ turn_id: "other" }])).toBe("reconcile");
      expect(resolveLiveTurnReattachAction(turn, [])).toBe("reconcile");
      expect(resolveLiveTurnReattachAction(turn, null)).toBe("reconcile");
    });

    it("does nothing without a valid pointer", () => {
      expect(resolveLiveTurnReattachAction(null, [{ turn_id: "turn-123" }])).toBe("none");
    });
  });

  describe("describeTerminalTurnStatus", () => {
    it("treats completed as non-failure with no note", () => {
      expect(describeTerminalTurnStatus("completed")).toEqual({ isFailure: false, note: "" });
      expect(describeTerminalTurnStatus(undefined)).toEqual({ isFailure: false, note: "" });
    });

    it("flags interrupted/failed/cancelled with an explicit note", () => {
      expect(describeTerminalTurnStatus("interrupted").isFailure).toBe(true);
      expect(describeTerminalTurnStatus("failed").isFailure).toBe(true);
      expect(describeTerminalTurnStatus("cancelled").isFailure).toBe(true);
      expect(describeTerminalTurnStatus("interrupted").note).toMatch(/interrupted/i);
    });
  });

  describe("shouldApplyTurnEventSeq", () => {
    it("applies only events beyond the applied cursor (idempotent replay)", () => {
      expect(shouldApplyTurnEventSeq(5, 4)).toBe(true);
      expect(shouldApplyTurnEventSeq(4, 4)).toBe(false);
      expect(shouldApplyTurnEventSeq(3, 4)).toBe(false);
    });

    it("always applies events without a numeric seq (legacy/test injection)", () => {
      expect(shouldApplyTurnEventSeq(undefined, 4)).toBe(true);
      expect(shouldApplyTurnEventSeq(Number.NaN, 4)).toBe(true);
    });
  });
});
