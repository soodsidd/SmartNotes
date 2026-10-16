import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const { createChatModule } = require("../packages/cli-chat/index");

function sendRequest(body: Record<string, unknown>) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]) as Readable & {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  request.url = "/api/chat/send";
  request.method = "POST";
  request.headers = { "content-type": "application/json" };
  return request;
}

function responseCapture() {
  let finish!: (value: { status: number; body: Record<string, string> }) => void;
  const result = new Promise<{ status: number; body: Record<string, string> }>((resolve) => {
    finish = resolve;
  });
  let status = 200;
  return {
    response: {
      writeHead: (value: number) => { status = value; },
      end: (body: string) => finish({ status, body: JSON.parse(body || "{}") }),
    },
    result,
  };
}

describe("SN-322 companion turn supersede", () => {
  let root = "";
  let chat: ReturnType<typeof createChatModule>;
  let immediate: jest.SpyInstance;
  let pendingRuns: Array<() => void>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "sn322-parallel-turns-"));
    chat = createChatModule(null, { emit: jest.fn() }, {
      appId: "smart-notes",
      workingDirectory: root,
      stateDir: root,
      configPath: path.join(root, "settings.json"),
      recoverInterruptedOnStartup: false,
      uploadDir: path.join(root, "uploads"),
    });
    // Keep accepted jobs live without launching a real provider process.
    pendingRuns = [];
    immediate = jest.spyOn(global, "setImmediate").mockImplementation((callback) => {
      pendingRuns.push(callback as () => void);
      return {} as NodeJS.Immediate;
    });
  });

  afterEach(() => {
    immediate.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function send(threadKey?: string) {
    const capture = responseCapture();
    chat.handleRequest(sendRequest({
      message: "Continue this page",
      provider: "test-unknown-provider",
      ...(threadKey ? { thread_key: threadKey } : {}),
    }), capture.response);
    const result = await capture.result;
    expect(result.status).toBe(200);
    return result.body.turn_id;
  }

  function record(turnId: string) {
    return JSON.parse(fs.readFileSync(path.join(root, "jobs", `${turnId}.json`), "utf8"));
  }

  it("keeps page A alive when page B starts in the same Smart Notes instance", async () => {
    const a = await send("book/a.html::whole");
    const b = await send("book/b.html::whole");

    expect(record(a)).toMatchObject({ status: "running", thread_key: "book/a.html::whole" });
    expect(record(b)).toMatchObject({ status: "running", thread_key: "book/b.html::whole" });
    expect(record(a).scope_key).toBe(record(b).scope_key);
  });

  it("cancels only the prior turn in the same shared thread", async () => {
    const a = await send("book/a.html::whole");
    const b = await send("book/b.html::whole");
    const newerA = await send("book/a.html::whole");

    expect(record(a).status).toBe("cancelled");
    expect(record(b).status).toBe("running");
    expect(record(newerA).status).toBe("running");
    pendingRuns[0]();
    expect(record(a).status).toBe("cancelled");
  });

  it("preserves legacy CLI-chat scope supersede for clients without a thread key", async () => {
    const first = await send();
    const second = await send();

    expect(record(first).status).toBe("cancelled");
    expect(record(second).status).toBe("running");
  });

  it("resets provider continuity for one thread without clearing another", async () => {
    const a = JSON.stringify(["thread", "book/a.html::whole"]);
    const b = JSON.stringify(["thread", "book/b.html::whole"]);
    fs.writeFileSync(path.join(root, "copilot-sessions.json"), JSON.stringify({
      ghcopilot: { [a]: "session-a", [b]: "session-b" },
      codex: {},
      cursor: {},
    }));
    const scopedChat = createChatModule(null, { emit: jest.fn() }, {
      appId: "smart-notes",
      workingDirectory: root,
      stateDir: root,
      configPath: path.join(root, "settings.json"),
      recoverInterruptedOnStartup: false,
      uploadDir: path.join(root, "uploads"),
    });
    const request = sendRequest({ thread_key: "book/a.html::whole" });
    request.url = "/api/chat/reset-session";
    const capture = responseCapture();
    scopedChat.handleRequest(request, capture.response);
    expect((await capture.result).status).toBe(200);
    const sessions = JSON.parse(fs.readFileSync(path.join(root, "copilot-sessions.json"), "utf8"));
    expect(sessions.ghcopilot[a]).toBeUndefined();
    expect(sessions.ghcopilot[b]).toBe("session-b");
  });
});
