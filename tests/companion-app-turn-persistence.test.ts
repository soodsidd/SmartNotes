import {
  buildCompanionAppMessagePrompt,
  createEmptyCompanionSidecar,
  getCompanionActiveTurn,
  normalizeCompanionSidecar,
  readVolatileCompanionSession,
  setCompanionActiveTurn,
  setCompanionScopeSession,
  writeVolatileCompanionSession,
  type CompanionActiveTurn,
  type CompanionStoredMessage,
} from "@/lib/ai-sidebar";

const scopeKey = "whole";
const pagePath = "Notebook/Apps/e2e-app.html";
const activeTurn: CompanionActiveTurn = {
  turnId: "turn-app-send",
  assistantMessageId: "assistant-app-send",
  lastSeq: -1,
  startedAt: 1_700_000_000_000,
};

function appSendMessages(): CompanionStoredMessage[] {
  const prompt = buildCompanionAppMessagePrompt({
    text: "Give me one tip.",
    payload: { mood: "focused", hours: 6 },
    appTitle: "E2E App",
  });
  return [
    { id: "user-app-send", role: "user", content: prompt },
    { id: activeTurn.assistantMessageId, role: "assistant", content: "Take a short break." },
  ];
}

function createSessionStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("SN-203 companion.send turn persistence", () => {
  it("keeps the completed auto-run transcript in the durable sidecar with Keep ON", () => {
    const messages = appSendMessages();
    let sidecar = setCompanionScopeSession(createEmptyCompanionSidecar(), scopeKey, {
      messages,
      activeTurn,
    });

    // The ordinary terminal-turn lifecycle clears its live pointer but retains
    // the transcript when Keep is ON. Serialize/normalize to model a reload.
    sidecar = setCompanionActiveTurn(sidecar, scopeKey, null);
    const restored = normalizeCompanionSidecar(JSON.parse(JSON.stringify(sidecar)));

    expect(restored.scopes[scopeKey]?.messages).toEqual(messages);
    expect(getCompanionActiveTurn(restored, scopeKey)).toBeNull();
  });

  it("keeps Keep OFF session-only and leaves no durable sidecar scope", () => {
    const messages = appSendMessages();
    const storage = createSessionStorage();
    writeVolatileCompanionSession(storage, {
      pagePath,
      scopeKey,
      messages,
      activeTurn: null,
    });

    // Same-tab reload restores sessionStorage, while durable terminal cleanup
    // removes the page/scope thread so another browser session cannot replay it.
    expect(readVolatileCompanionSession(storage)?.messages).toEqual(messages);
    const durable = setCompanionScopeSession(
      setCompanionScopeSession(createEmptyCompanionSidecar(), scopeKey, {
        messages,
        activeTurn,
      }),
      scopeKey,
      null
    );
    expect(durable.scopes[scopeKey]).toBeUndefined();
    expect(readVolatileCompanionSession(createSessionStorage())).toBeNull();
  });
});
