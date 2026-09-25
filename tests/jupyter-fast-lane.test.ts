import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fastLane = require("../packages/cli-chat/fast-lane") as {
  ensureWarm: (pagePath: string) => Promise<{ status: string; sessionId: string | null; ttftMs?: number | null }>;
  sendMessage: (
    pagePath: string,
    message: string,
    options?: { signal?: AbortSignal; onText?: (chunk: string) => void }
  ) => Promise<{ text: string; sessionId: string | null; ttftMs: number | null; durationMs: number }>;
  closeSession: (pagePath: string) => { closed: boolean };
  closeAllSessions: () => { closed: number };
  resolveFastLanePolicy: (settings?: Record<string, unknown>) => { provider: string; model: string; effort: string };
  pickSmallestModel: (available?: string[]) => string;
  resolveIsolatedWorkingDirectory: (pagePath: string, stateDir?: string) => string;
  __resetForTesting: () => void;
  __testInternals: {
    buildFastLaneClaudeArgs: (opts: {
      model?: string;
      effort?: string;
      resume?: string | null;
      systemPromptFile?: string | null;
      partialMessages?: boolean;
    }) => string[];
    parseFastLaneLine: (
      line: string,
      state: Record<string, unknown>,
      provider?: string,
      options?: { partialMessages?: boolean }
    ) => Record<string, unknown>;
    createParseState: () => Record<string, unknown>;
    FAST_LANE_SANDBOX: { claude: { allowedTools: string[]; permissionMode: string } };
    SYSTEM_PROMPT: string;
    WARM_PROMPT: string;
    TURN_TIMEOUT_MS: number;
    turnIdleTimeoutMs: () => number;
    turnAbsoluteTimeoutMs: () => number;
  };
};

const FIXTURE_CMD = path.resolve(__dirname, "fixtures", "fake-claude.cmd");

describe("resolveFastLanePolicy — lane-scoped, independent of the companion (SN-247)", () => {
  it("defaults to claude + smallest model + low effort with zero configuration", () => {
    expect(fastLane.resolveFastLanePolicy({})).toEqual({ provider: "claude", model: "haiku", effort: "low" });
  });

  it("never reads the companion's stored provider/model/effort preferences", () => {
    // A settings object shaped like what src/lib/ai-sidebar.ts's companion
    // resolver would read (defaultProvider + claudeModel/claudeEffort with a
    // HIGH-quality, high-effort preference) must not leak into the fast lane.
    const companionLikeSettings = {
      defaultProvider: "cursor",
      claudeModel: "opus",
      claudeEffort: "high",
      cursorModel: "gpt-5.5-high",
      model: "opus",
    };
    expect(fastLane.resolveFastLanePolicy(companionLikeSettings)).toEqual({
      provider: "claude",
      model: "haiku",
      effort: "low",
    });
  });

  it("honors an explicit fastLane* override in the same settings shape", () => {
    expect(fastLane.resolveFastLanePolicy({ fastLaneModel: "sonnet", fastLaneEffort: "medium" })).toEqual({
      provider: "claude",
      model: "sonnet",
      effort: "medium",
    });
  });

  it("pickSmallestModel prefers haiku over sonnet/opus from an available-models list", () => {
    expect(fastLane.pickSmallestModel(["opus", "sonnet", "haiku"])).toBe("haiku");
    expect(fastLane.pickSmallestModel(["opus", "sonnet"])).toBe("sonnet");
    expect(fastLane.pickSmallestModel([])).toBe("haiku");
  });
});

describe("buildFastLaneClaudeArgs — provider argument construction (SN-247 evidence)", () => {
  const { buildFastLaneClaudeArgs, FAST_LANE_SANDBOX } = fastLane.__testInternals;

  it("uses an empty tool list (plan permission mode + glued --tools=)", () => {
    expect(FAST_LANE_SANDBOX.claude.allowedTools).toEqual([]);
    expect(FAST_LANE_SANDBOX.claude.permissionMode).toBe("plan");
    const args = buildFastLaneClaudeArgs({ model: "haiku", effort: "low" });
    expect(args).toContain("--permission-mode");
    expect(args).toContain("plan");
    // Single glued token, NOT ['--tools', ''] — see sandbox.js claudeSandboxArgs
    // comment: a genuinely empty-string array element is silently dropped by
    // cmd.exe's re-tokenization under spawn(..., { shell: true }) on Windows,
    // which then corrupts parsing of the NEXT flag (e.g. --model).
    expect(args).toContain("--tools=");
    expect(args).not.toContain("--tools");
  });

  it("passes the small model and low effort", () => {
    const args = buildFastLaneClaudeArgs({ model: "haiku", effort: "low" });
    expect(args).toEqual(
      expect.arrayContaining(["--model", "haiku", "--effort", "low"])
    );
  });

  it("resumes an existing session instead of sending a system prompt", () => {
    const args = buildFastLaneClaudeArgs({
      model: "haiku",
      effort: "low",
      resume: "session-abc-123",
      systemPromptFile: "/should/not/be/used.txt",
    });
    expect(args).toEqual(expect.arrayContaining(["--resume", "session-abc-123"]));
    expect(args).not.toContain("--system-prompt-file");
  });

  it("sends the system prompt only on a fresh (non-resumed) turn", () => {
    const args = buildFastLaneClaudeArgs({
      model: "haiku",
      effort: "low",
      resume: null,
      systemPromptFile: "/tmp/system-prompt.txt",
    });
    expect(args).toEqual(expect.arrayContaining(["--system-prompt-file", "/tmp/system-prompt.txt"]));
    expect(args).not.toContain("--resume");
  });

  it("always requests stream-json output so the session id can be read from the first event", () => {
    const args = buildFastLaneClaudeArgs({ model: "haiku", effort: "low" });
    expect(args).toEqual(expect.arrayContaining(["--output-format", "stream-json"]));
  });
});

describe("resolveIsolatedWorkingDirectory — isolated per-page cwd (SN-247 evidence)", () => {
  it("is deterministic per page path and distinct across pages", () => {
    const stateDir = "C:/fake-state-dir";
    const a1 = fastLane.resolveIsolatedWorkingDirectory("Notebook/Section/a.html", stateDir);
    const a2 = fastLane.resolveIsolatedWorkingDirectory("Notebook/Section/a.html", stateDir);
    const b = fastLane.resolveIsolatedWorkingDirectory("Notebook/Section/b.html", stateDir);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("is not the state dir or vault root itself — a dedicated sub-path per page", () => {
    const stateDir = path.join("C:", "fake-state-dir");
    const dir = fastLane.resolveIsolatedWorkingDirectory("Notebook/Section/a.html", stateDir);
    expect(dir).not.toBe(stateDir);
    expect(dir.startsWith(stateDir)).toBe(true);
    expect(dir).toContain("fast-lane-sessions");
  });

  it("is notebook-agnostic: works for any vault-relative page path, not a hardcoded one", () => {
    const stateDir = "C:/fake-state-dir";
    expect(() => fastLane.resolveIsolatedWorkingDirectory("Anything/Whatever/Page.html", stateDir)).not.toThrow();
    expect(() => fastLane.resolveIsolatedWorkingDirectory("Other Notebook/Deep/Path/Note.html", stateDir)).not.toThrow();
  });
});

describe("parseFastLaneLine — stream-json parsing", () => {
  it("captures the session id from the FIRST event that carries one (system/init), not only the terminal result", () => {
    const state = fastLane.__testInternals.createParseState();
    fastLane.__testInternals.parseFastLaneLine(
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess-first", tools: [] }),
      state
    );
    expect(state.sessionId).toBe("sess-first");
    // A later event with a DIFFERENT session id must not override the first capture.
    fastLane.__testInternals.parseFastLaneLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] }, session_id: "sess-second" }),
      state
    );
    expect(state.sessionId).toBe("sess-first");
  });

  it("accumulates assistant text and reads ttft_ms + final text from the terminal result event", () => {
    const state = fastLane.__testInternals.createParseState();
    fastLane.__testInternals.parseFastLaneLine(
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess-1" }),
      state
    );
    fastLane.__testInternals.parseFastLaneLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
      state
    );
    fastLane.__testInternals.parseFastLaneLine(
      JSON.stringify({ type: "result", is_error: false, result: "hello", ttft_ms: 123 }),
      state
    );
    expect(state.done).toBe(true);
    expect(state.ttftMs).toBe(123);
    expect((state.text as string[]).join("")).toBe("hello");
  });

  it("marks a provider error result as an error instead of a successful reply", () => {
    const state = fastLane.__testInternals.createParseState();
    fastLane.__testInternals.parseFastLaneLine(
      JSON.stringify({ type: "result", is_error: true, result: "boom" }),
      state
    );
    expect(state.isError).toBe(true);
    expect(state.errorMessage).toBe("boom");
  });

  it("ignores non-JSON / unrecognized lines without throwing", () => {
    const state = fastLane.__testInternals.createParseState();
    expect(() => fastLane.__testInternals.parseFastLaneLine("not json at all", state)).not.toThrow();
    expect(() => fastLane.__testInternals.parseFastLaneLine("", state)).not.toThrow();
  });
});

describe("session lifecycle — end-to-end against a scripted fake CLI (SN-247)", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-notes-fast-lane-test-"));

  beforeEach(() => {
    fastLane.__resetForTesting();
    process.env.SMART_NOTES_FAST_LANE_CLAUDE_CMD = FIXTURE_CMD;
    process.env.SMART_NOTES_STATE_DIR = stateDir;
  });

  afterEach(() => {
    delete process.env.SMART_NOTES_FAST_LANE_CLAUDE_CMD;
    delete process.env.SMART_NOTES_STATE_DIR;
    delete process.env.SMART_NOTES_FAST_LANE_IDLE_TIMEOUT_MS;
    delete process.env.SMART_NOTES_FAST_LANE_ABSOLUTE_TIMEOUT_MS;
    delete process.env.FAKE_CLAUDE_HANG;
    delete process.env.FAKE_CLAUDE_SLOW_PROGRESS;
    delete process.env.FAKE_CLAUDE_SPAWN_ERROR;
    delete process.env.FAKE_CLAUDE_ERROR;
    delete process.env.FAKE_CLAUDE_NO_SESSION;
  });

  afterAll(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("warms a session and resumes it on the next turn instead of re-sending the system prompt", async () => {
    const pagePath = `Notebook/Section/warm-resume-${crypto.randomUUID()}.html`;
    const warm = await fastLane.ensureWarm(pagePath);
    expect(warm.status).toBe("ready");
    expect(warm.sessionId).toBeTruthy();

    const send = await fastLane.sendMessage(pagePath, "hello");
    expect(send.text).toBe("echo:hello");
    // Same session id: the fake CLI only echoes back --resume's value, so this
    // proves the real turn actually passed --resume with the warmed session id.
    expect(send.sessionId).toBe(warm.sessionId);

    fastLane.closeSession(pagePath);
  });

  it("a request that arrives before warm-up still succeeds (lazily triggers warm-up itself)", async () => {
    const pagePath = `Notebook/Section/race-${crypto.randomUUID()}.html`;
    // No ensureWarm() call at all — sendMessage must still succeed.
    const send = await fastLane.sendMessage(pagePath, "first message");
    expect(send.text).toBe("echo:first message");
    expect(send.sessionId).toBeTruthy();
    fastLane.closeSession(pagePath);
  });

  it("a request racing an in-flight warm-up resumes the same session rather than duplicating a cold turn", async () => {
    const pagePath = `Notebook/Section/inflight-${crypto.randomUUID()}.html`;
    const warmPromise = fastLane.ensureWarm(pagePath);
    const sendPromise = fastLane.sendMessage(pagePath, "concurrent message");
    const [warm, send] = await Promise.all([warmPromise, sendPromise]);
    expect(send.sessionId).toBe(warm.sessionId);
    fastLane.closeSession(pagePath);
  });

  it("falls back to a cold turn and still succeeds when warm-up failed", async () => {
    const pagePath = `Notebook/Section/warm-failed-${crypto.randomUUID()}.html`;
    process.env.FAKE_CLAUDE_SPAWN_ERROR = "1";
    await expect(fastLane.ensureWarm(pagePath)).rejects.toBeTruthy();

    delete process.env.FAKE_CLAUDE_SPAWN_ERROR;
    const send = await fastLane.sendMessage(pagePath, "after failed warmup");
    expect(send.text).toBe("echo:after failed warmup");
    expect(send.sessionId).toBeTruthy();
    fastLane.closeSession(pagePath);
  });

  it("rejects a provider error result without leaving a stuck in-progress session", async () => {
    const pagePath = `Notebook/Section/provider-error-${crypto.randomUUID()}.html`;
    process.env.FAKE_CLAUDE_ERROR = "1";
    await expect(fastLane.sendMessage(pagePath, "trigger error")).rejects.toMatchObject({
      code: "FAST_LANE_PROVIDER_ERROR",
    });
    delete process.env.FAKE_CLAUDE_ERROR;

    // No orphaned/stuck turn: a subsequent send on the same page must still work.
    const recovered = await fastLane.sendMessage(pagePath, "retry after error");
    expect(recovered.text).toBe("echo:retry after error");
    fastLane.closeSession(pagePath);
  });

  it("rejects a spawn failure cleanly (no stuck session)", async () => {
    const pagePath = `Notebook/Section/spawn-error-${crypto.randomUUID()}.html`;
    process.env.FAKE_CLAUDE_SPAWN_ERROR = "1";
    await expect(fastLane.sendMessage(pagePath, "will fail to spawn")).rejects.toBeTruthy();
    delete process.env.FAKE_CLAUDE_SPAWN_ERROR;

    const recovered = await fastLane.sendMessage(pagePath, "retry after spawn error");
    expect(recovered.text).toBe("echo:retry after spawn error");
    fastLane.closeSession(pagePath);
  });

  it("rejects a second concurrent turn for the same page instead of double-spawning", async () => {
    const pagePath = `Notebook/Section/busy-${crypto.randomUUID()}.html`;
    await fastLane.ensureWarm(pagePath);
    const first = fastLane.sendMessage(pagePath, "first turn");
    await expect(fastLane.sendMessage(pagePath, "second turn")).rejects.toMatchObject({
      code: "FAST_LANE_BUSY",
    });
    await first;
    fastLane.closeSession(pagePath);
  });

  it("times out a hung turn, kills the child process, and leaves the session usable again", async () => {
    const pagePath = `Notebook/Section/timeout-${crypto.randomUUID()}.html`;
    expect(typeof fastLane.__testInternals.TURN_TIMEOUT_MS).toBe("number");
    expect(fastLane.__testInternals.turnIdleTimeoutMs()).toBe(20_000);
    expect(fastLane.__testInternals.turnAbsoluteTimeoutMs()).toBeGreaterThan(20_000);

    // Warm up first with the fake CLI behaving normally, so status is
    // "ready" and sessionId is set. Only THEN flip on the hang: sendMessage
    // skips its own ensureWarm() fallback once status !== "idle", so exactly
    // one turn hangs — not warm-up AND the send both hanging back-to-back.
    await fastLane.ensureWarm(pagePath);
    process.env.FAKE_CLAUDE_HANG = "1";
    await expect(fastLane.sendMessage(pagePath, "this will hang")).rejects.toMatchObject({
      code: "FAST_LANE_TIMEOUT",
    });
    delete process.env.FAKE_CLAUDE_HANG;

    // No orphaned process left running against this session: a fresh turn succeeds.
    const recovered = await fastLane.sendMessage(pagePath, "recovered after timeout");
    expect(recovered.text).toBe("echo:recovered after timeout");
    fastLane.closeSession(pagePath);
  }, 30_000);

  it("SN-255: keeps a slow-but-progressing turn alive past the idle budget and recovers after a later timeout", async () => {
    const pagePath = `Notebook/Section/slow-progress-${crypto.randomUUID()}.html`;
    process.env.SMART_NOTES_FAST_LANE_IDLE_TIMEOUT_MS = "2000";
    expect(fastLane.__testInternals.turnIdleTimeoutMs()).toBe(2000);

    await fastLane.ensureWarm(pagePath);
    process.env.FAKE_CLAUDE_SLOW_PROGRESS = "1";
    const started = Date.now();
    const result = await fastLane.sendMessage(pagePath, "write code slowly", {
      onText: () => undefined,
    });
    delete process.env.FAKE_CLAUDE_SLOW_PROGRESS;
    expect(Date.now() - started).toBeGreaterThan(2000);
    expect(result.text).toContain("slow:write code slowly");

    process.env.FAKE_CLAUDE_HANG = "1";
    await expect(fastLane.sendMessage(pagePath, "now hang")).rejects.toMatchObject({
      code: "FAST_LANE_TIMEOUT",
    });
    delete process.env.FAKE_CLAUDE_HANG;
    const recovered = await fastLane.sendMessage(pagePath, "after timeout");
    expect(recovered.text).toBe("echo:after timeout");
    fastLane.closeSession(pagePath);
    delete process.env.SMART_NOTES_FAST_LANE_IDLE_TIMEOUT_MS;
  }, 30_000);

  it("close kills an in-flight turn's child process and leaves nothing orphaned", async () => {
    const pagePath = `Notebook/Section/close-inflight-${crypto.randomUUID()}.html`;
    // Warm up first (hang off) so the hung send below is the ONLY hung turn —
    // see the timeout test above for why this ordering matters.
    await fastLane.ensureWarm(pagePath);
    process.env.FAKE_CLAUDE_HANG = "1";
    const hungSend = fastLane.sendMessage(pagePath, "hangs forever").catch((error) => error);

    // Give the child process a moment to actually spawn before closing.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const closed = fastLane.closeSession(pagePath);
    expect(closed.closed).toBe(true);

    const outcome = await hungSend;
    expect(outcome).toBeInstanceOf(Error);
    delete process.env.FAKE_CLAUDE_HANG;

    // The registry entry is gone; a new send starts a brand-new session cleanly.
    const fresh = await fastLane.sendMessage(pagePath, "fresh after close");
    expect(fresh.text).toBe("echo:fresh after close");
    fastLane.closeSession(pagePath);
  }, 15_000);

  it("SN-253: streams answer deltas to onText, and the concatenated deltas equal the final text exactly", async () => {
    const pagePath = `Notebook/Section/stream-${crypto.randomUUID()}.html`;
    await fastLane.ensureWarm(pagePath);

    const chunks: string[] = [];
    const result = await fastLane.sendMessage(pagePath, "answer this", {
      onText: (chunk) => chunks.push(chunk),
    });

    expect(chunks.length).toBeGreaterThan(1);
    // The exact invariant the notebook write depends on: what the overlay
    // showed while streaming is what finally lands in the cell — no doubling
    // from the assembled assistant message the CLI also emits.
    expect(chunks.join("")).toBe(result.text);
    expect(result.text).toBe("echo:answer this");

    fastLane.closeSession(pagePath);
  });

  it("SN-253: a turn without onText never receives deltas and still resolves the whole answer", async () => {
    const pagePath = `Notebook/Section/no-stream-${crypto.randomUUID()}.html`;
    await fastLane.ensureWarm(pagePath);
    const result = await fastLane.sendMessage(pagePath, "answer this");
    expect(result.text).toBe("echo:answer this");
    fastLane.closeSession(pagePath);
  });

  it("removes the isolated working directory on close", async () => {
    const pagePath = `Notebook/Section/cleanup-${crypto.randomUUID()}.html`;
    await fastLane.ensureWarm(pagePath);
    const dir = fastLane.resolveIsolatedWorkingDirectory(pagePath, stateDir);
    expect(fs.existsSync(dir)).toBe(true);

    fastLane.closeSession(pagePath);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("closeAllSessions tears down every open page's session", async () => {
    const pageA = `Notebook/Section/all-a-${crypto.randomUUID()}.html`;
    const pageB = `Notebook/Section/all-b-${crypto.randomUUID()}.html`;
    await fastLane.ensureWarm(pageA);
    await fastLane.ensureWarm(pageB);
    const result = fastLane.closeAllSessions();
    expect(result.closed).toBeGreaterThanOrEqual(2);
  });
});

describe("SN-253 — opt-in token streaming for the Answer comment overlay", () => {
  const { buildFastLaneClaudeArgs, parseFastLaneLine, createParseState } = fastLane.__testInternals;

  function streamEvent(inner: Record<string, unknown>) {
    return JSON.stringify({ type: "stream_event", event: inner, session_id: "sess-1" });
  }

  it("only asks the CLI for partial messages when the caller opted into streaming", () => {
    expect(buildFastLaneClaudeArgs({ model: "haiku", effort: "low" }))
      .not.toContain("--include-partial-messages");
    expect(buildFastLaneClaudeArgs({ model: "haiku", effort: "low", partialMessages: false }))
      .not.toContain("--include-partial-messages");
    expect(buildFastLaneClaudeArgs({ model: "haiku", effort: "low", partialMessages: true }))
      .toContain("--include-partial-messages");
  });

  it("accumulates text_delta chunks in order when streaming is enabled", () => {
    const state = createParseState();
    const opts = { partialMessages: true };
    parseFastLaneLine(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }), state, "claude", opts);
    parseFastLaneLine(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "mean = " } }), state, "claude", opts);
    parseFastLaneLine(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "sum(xs)" } }), state, "claude", opts);
    expect((state.text as string[]).join("")).toBe("mean = sum(xs)");
    expect(state.sawTextDelta).toBe(true);
  });

  it("never doubles the answer when the whole assistant message follows its own deltas", () => {
    const state = createParseState();
    const opts = { partialMessages: true };
    parseFastLaneLine(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x = 1" } }), state, "claude", opts);
    // The CLI emits the assembled message alongside the deltas; re-pushing it
    // here would write "x = 1x = 1" into the notebook cell.
    parseFastLaneLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x = 1" }] } }),
      state,
      "claude",
      opts
    );
    expect((state.text as string[]).join("")).toBe("x = 1");
  });

  it("ignores thinking deltas so only answer text reaches the notebook", () => {
    const state = createParseState();
    const opts = { partialMessages: true };
    parseFastLaneLine(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } }), state, "claude", opts);
    parseFastLaneLine(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "abc" } }), state, "claude", opts);
    parseFastLaneLine(streamEvent({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "x = 1" } }), state, "claude", opts);
    expect((state.text as string[]).join("")).toBe("x = 1");
  });

  it("leaves the non-streaming parse path untouched: stream_event lines are ignored, assistant text still lands", () => {
    const state = createParseState();
    parseFastLaneLine(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ignored" } }), state, "claude");
    expect((state.text as string[]).join("")).toBe("");
    parseFastLaneLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x = 1" }] } }),
      state,
      "claude"
    );
    expect((state.text as string[]).join("")).toBe("x = 1");
  });
});
