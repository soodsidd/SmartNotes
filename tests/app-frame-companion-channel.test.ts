import {
  APP_FRAME_MESSAGE_SOURCE,
  APP_FRAME_MAX_COMPANION_TEXT_LENGTH,
  APP_FRAME_MAX_PAGE_PATH_LENGTH,
  APP_FRAME_MAX_RESPONSE_BYTES,
  AppFrameHostLimiter,
  buildAppSrcDoc,
  buildCompanionDeliverMessage,
  isAppFrameRequestKind,
  normalizeVaultRelativePagePath,
  parseAppFrameMessage,
} from "@/lib/app-frame";

const NONCE = "nonce-xyz";

function openPageMessage(overrides: Record<string, unknown> = {}) {
  return {
    source: APP_FRAME_MESSAGE_SOURCE,
    nonce: NONCE,
    kind: "open-page" as const,
    requestId: "q_abc123",
    pagePath: "Notebook/Section/page.html",
    ...overrides,
  };
}

function companionSendMessage(overrides: Record<string, unknown> = {}) {
  return {
    source: APP_FRAME_MESSAGE_SOURCE,
    nonce: NONCE,
    kind: "companion-send" as const,
    requestId: "q_def456",
    text: "How is this log entry?",
    payload: { weight: 100 },
    ...overrides,
  };
}

describe("SN-205 open-page app-frame message", () => {
  it("parses a well-formed open-page request", () => {
    expect(parseAppFrameMessage(openPageMessage(), NONCE)).toEqual({
      source: APP_FRAME_MESSAGE_SOURCE,
      nonce: NONCE,
      kind: "open-page",
      requestId: "q_abc123",
      pagePath: "Notebook/Section/page.html",
    });
  });

  it("rejects a mismatched nonce, malformed requestId, extra keys, and oversized paths", () => {
    expect(parseAppFrameMessage(openPageMessage(), "other-nonce")).toBeNull();
    expect(parseAppFrameMessage(openPageMessage({ requestId: "bad-id" }), NONCE)).toBeNull();
    expect(parseAppFrameMessage(openPageMessage({ extra: true }), NONCE)).toBeNull();
    expect(parseAppFrameMessage(openPageMessage({ pagePath: 42 }), NONCE)).toBeNull();
    expect(
      parseAppFrameMessage(openPageMessage({ pagePath: "a".repeat(APP_FRAME_MAX_PAGE_PATH_LENGTH + 1) }), NONCE)
    ).toBeNull();
    expect(parseAppFrameMessage(openPageMessage({ pagePath: "" }), NONCE)).toBeNull();
  });
});

describe("SN-205 normalizeVaultRelativePagePath", () => {
  it("accepts canonical vault-relative paths and normalizes separators", () => {
    expect(normalizeVaultRelativePagePath("Notebook/Section/page.html")).toBe("Notebook/Section/page.html");
    expect(normalizeVaultRelativePagePath("Notebook\\Section\\page.html")).toBe("Notebook/Section/page.html");
    expect(normalizeVaultRelativePagePath("  Notebook/page.html  ")).toBe("Notebook/page.html");
    expect(normalizeVaultRelativePagePath("/Notebook/page.html")).toBe("Notebook/page.html");
  });

  it("rejects external, absolute, protocol-relative, traversing, and oversized targets", () => {
    expect(normalizeVaultRelativePagePath("https://evil.test/x")).toBeNull();
    expect(normalizeVaultRelativePagePath("javascript:alert(1)")).toBeNull();
    expect(normalizeVaultRelativePagePath("mailto:a@b.c")).toBeNull();
    expect(normalizeVaultRelativePagePath("//evil.test/x")).toBeNull();
    expect(normalizeVaultRelativePagePath("C:/Windows/system32")).toBeNull();
    expect(normalizeVaultRelativePagePath("Notebook/../../secret.html")).toBeNull();
    expect(normalizeVaultRelativePagePath("Notebook/./page.html")).toBeNull();
    expect(normalizeVaultRelativePagePath("a".repeat(APP_FRAME_MAX_PAGE_PATH_LENGTH + 1))).toBeNull();
    expect(normalizeVaultRelativePagePath(42)).toBeNull();
    expect(normalizeVaultRelativePagePath("")).toBeNull();
  });
});

describe("SN-203 companion-send app-frame message", () => {
  it("parses a well-formed companion-send request, preserving an arbitrary JSON payload", () => {
    const parsed = parseAppFrameMessage(companionSendMessage({ payload: [1, "two", { three: true }] }), NONCE);
    expect(parsed).toEqual({
      source: APP_FRAME_MESSAGE_SOURCE,
      nonce: NONCE,
      kind: "companion-send",
      requestId: "q_def456",
      text: "How is this log entry?",
      payload: [1, "two", { three: true }],
    });
  });

  it("allows a null payload and empty text", () => {
    expect(parseAppFrameMessage(companionSendMessage({ payload: null, text: "" }), NONCE)).toMatchObject({
      kind: "companion-send",
      text: "",
      payload: null,
    });
  });

  it("rejects mismatched nonce, extra keys, oversized text, and non-string text", () => {
    expect(parseAppFrameMessage(companionSendMessage(), "other")).toBeNull();
    expect(parseAppFrameMessage(companionSendMessage({ extra: 1 }), NONCE)).toBeNull();
    expect(parseAppFrameMessage(companionSendMessage({ text: 5 }), NONCE)).toBeNull();
    expect(
      parseAppFrameMessage(companionSendMessage({ text: "a".repeat(APP_FRAME_MAX_COMPANION_TEXT_LENGTH + 1) }), NONCE)
    ).toBeNull();
  });

  it("rejects an oversized payload past the app-frame message byte bound", () => {
    const huge = "x".repeat(300 * 1024);
    expect(parseAppFrameMessage(companionSendMessage({ payload: { huge } }), NONCE)).toBeNull();
  });
});

describe("SN-203 buildCompanionDeliverMessage", () => {
  it("builds a host→app envelope with exact shape", () => {
    expect(buildCompanionDeliverMessage(NONCE, "d_1", { advice: "looks good" })).toEqual({
      source: "smart-notes-app-host",
      nonce: NONCE,
      kind: "companion-deliver",
      messageId: "d_1",
      message: { advice: "looks good" },
    });
  });

  it("returns null when the envelope exceeds the host response bound", () => {
    const huge = "y".repeat(APP_FRAME_MAX_RESPONSE_BYTES + 10);
    expect(buildCompanionDeliverMessage(NONCE, "d_2", { huge })).toBeNull();
  });
});

describe("SN-203/SN-205 host limiter inflight tracking", () => {
  it("inflight-tracks open-page and companion-send like rpc/accept", () => {
    expect(isAppFrameRequestKind("open-page")).toBe(true);
    expect(isAppFrameRequestKind("companion-send")).toBe(true);
    expect(isAppFrameRequestKind("heartbeat")).toBe(false);

    const limiter = new AppFrameHostLimiter();
    const parsed = parseAppFrameMessage(openPageMessage(), NONCE)!;
    expect(limiter.admit(parsed)).toBeNull();
    // A duplicate in-flight request id is rejected until finished.
    expect(limiter.admit(parsed)).toBe("Duplicate App table request id.");
    limiter.finish("q_abc123");
    expect(limiter.admit(parsed)).toBeNull();
  });
});

describe("SN-203/SN-205 in-iframe bridge surface", () => {
  const srcDoc = buildAppSrcDoc("<p>app</p>", NONCE, true);

  it("exposes openPage and the companion send/onMessage API", () => {
    expect(srcDoc).toContain("openPage:");
    expect(srcDoc).toContain("companion");
    expect(srcDoc).toContain("send:");
    expect(srcDoc).toContain("onMessage:");
    expect(srcDoc).toContain("hostRequest");
    expect(srcDoc).toContain("companionHandlers");
  });

  it("dispatches host→app companion-deliver to registered receivers only, never into rpc data", () => {
    expect(srcDoc).toContain("companion-deliver");
    expect(srcDoc).toContain("'kind,message,messageId,nonce,source'");
    // The data channel stays a distinct verb.
    expect(srcDoc).toContain("kind: 'rpc'");
    expect(srcDoc).toContain("companion-send");
  });
});
