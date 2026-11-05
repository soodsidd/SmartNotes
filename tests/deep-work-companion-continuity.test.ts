/**
 * Deep Work Companion continuity across a reissued workspace capability.
 *
 * Smart Notes issues a fresh dwc_ capability whenever the owner reopens a
 * Deep Work page, and addresses the Companion thread by it. Provider session
 * resume and the live-turn lookup must use the workspace's stable root scope,
 * or returning to the page loses the conversation and the running turn.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const { createChatModule } = require("../packages/cli-chat/index");

function request(url: string, method: string, body?: Record<string, unknown>) {
  const stream = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []) as Readable & {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  stream.url = url;
  stream.method = method;
  stream.headers = { "content-type": "application/json" };
  return stream;
}

function capture() {
  let finish!: (value: { status: number; body: Record<string, any> }) => void;
  const result = new Promise<{ status: number; body: Record<string, any> }>((resolve) => {
    finish = resolve;
  });
  let status = 200;
  return {
    response: {
      writeHead: (value: number) => { status = value; },
      setHeader: () => undefined,
      end: (body: string) => finish({ status, body: JSON.parse(body || "{}") }),
    },
    result,
  };
}

const CAP_OLD = `dwc_${"a".repeat(43)}`;
const CAP_NEW = `dwc_${"b".repeat(43)}`;
const CAP_OTHER_ROOT = `dwc_${"c".repeat(43)}`;
const SCOPES: Record<string, string> = {
  [CAP_OLD]: "deep-work:lerobot-root",
  [CAP_NEW]: "deep-work:lerobot-root",
  [CAP_OTHER_ROOT]: "deep-work:other-root",
};

function deepWorkContext(capability: string) {
  return [
    "Smart Notes Deep Work operating context:",
    "- Registered workspace root identity: C:\Projects\LeRobot",
    `- workspaceCapability: ${capability}`,
  ].join("\n");
}

describe("Deep Work Companion continuity across capability reissue", () => {
  let root = "";
  let stateDir = "";
  let chat: ReturnType<typeof createChatModule>;
  let immediate: jest.SpyInstance;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "deep-work-continuity-"));
    stateDir = path.join(root, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(path.join(root, "bridge"), { recursive: true });
    chat = createChatModule(null, { emit: jest.fn() }, {
      appId: "smart-notes",
      workingDirectory: root,
      stateDir,
      configPath: path.join(stateDir, "settings.json"),
      recoverInterruptedOnStartup: false,
      uploadDir: path.join(root, "uploads"),
      resolveDeepWorkTurn: jest.fn(async (capability: string) => SCOPES[capability]
        ? { scopeKey: SCOPES[capability], workingDirectory: root, companionBridgeRoot: path.join(root, "bridge") }
        : null),
      resolveDeepWorkScopeKey: (capability: string) => SCOPES[capability] ?? null,
    });
    // Keep accepted turns running without launching a provider process.
    immediate = jest.spyOn(global, "setImmediate").mockImplementation(() => ({}) as NodeJS.Immediate);
  });

  afterEach(() => {
    immediate.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function send(capability: string, message: string) {
    const { response, result } = capture();
    chat.handleRequest(request("/api/chat/send", "POST", {
      message,
      provider: "test-unknown-provider",
      thread_key: `${capability}::whole`,
      app_context: deepWorkContext(capability),
    }), response);
    const sent = await result;
    expect(sent.status).toBe(200);
    return JSON.parse(fs.readFileSync(path.join(stateDir, "jobs", `${sent.body.turn_id}.json`), "utf8"));
  }

  it("resumes one provider session per workspace root, not per capability", async () => {
    const before = await send(CAP_OLD, "Push the LeRobot work");
    const after = await send(CAP_NEW, "did you lose the chat");

    // Tools still authorize by the capability thread key...
    expect(before.thread_key).toBe(`${CAP_OLD}::whole`);
    expect(after.thread_key).toBe(`${CAP_NEW}::whole`);
    // ...but provider continuity is keyed by the stable root scope.
    expect(before.session_thread_key).toBe("deep-work:lerobot-root::whole");
    expect(after.session_thread_key).toBe(before.session_thread_key);
  });

  it("finds a turn started under the old capability from the reopened thread", async () => {
    const running = await send(CAP_OLD, "Run the long detector review");
    await send(CAP_OTHER_ROOT, "unrelated workspace");

    const { response, result } = capture();
    chat.handleRequest(
      request(`/api/chat/history?all_scopes=1&thread_key=${encodeURIComponent(`${CAP_NEW}::whole`)}`, "GET"),
      response
    );
    const { status, body } = await result;

    expect(status).toBe(200);
    expect(body.thread_session_key).toBe("deep-work:lerobot-root::whole");
    expect(body.thread_active_turns).toHaveLength(1);
    expect(body.thread_active_turns[0]).toMatchObject({
      turn_id: running.turn_id,
      thread_key: `${CAP_OLD}::whole`,
      request_message: "Run the long detector review",
    });
  });

  it("keeps vault-page thread keys unchanged", async () => {
    const { response, result } = capture();
    chat.handleRequest(request("/api/chat/send", "POST", {
      message: "Summarize this page",
      provider: "test-unknown-provider",
      thread_key: "AI/Robotic Arm/master-repo.html::whole",
    }), response);
    const sent = await result;
    const record = JSON.parse(fs.readFileSync(path.join(stateDir, "jobs", `${sent.body.turn_id}.json`), "utf8"));
    expect(record.session_thread_key).toBe("AI/Robotic Arm/master-repo.html::whole");
  });
});
