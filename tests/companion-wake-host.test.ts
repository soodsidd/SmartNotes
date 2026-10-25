/**
 * SN-377: cli-chat in-process host surface used by Jupyter cell wakes —
 * inspect live turns per thread and start a host-owned turn on a thread
 * through the same acceptance path as POST /api/chat/send.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const { createChatModule, buildCompanionProviderEnv } = require("../packages/cli-chat/index");

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

describe("SN-377 companion wake host", () => {
  let root = "";
  let chat: ReturnType<typeof createChatModule>;
  let immediate: jest.SpyInstance;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "sn377-wake-host-"));
    chat = createChatModule(null, { emit: jest.fn() }, {
      appId: "smart-notes",
      workingDirectory: root,
      stateDir: root,
      configPath: path.join(root, "settings.json"),
      recoverInterruptedOnStartup: false,
      uploadDir: path.join(root, "uploads"),
    });
    // Keep accepted jobs live without launching a real provider process.
    immediate = jest.spyOn(global, "setImmediate").mockImplementation(() => ({}) as NodeJS.Immediate);
  });

  afterEach(() => {
    immediate.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("describes running turns per thread from browser sends", async () => {
    const capture = responseCapture();
    chat.handleRequest(sendRequest({
      message: "Run the training cell",
      provider: "test-unknown-provider",
      model: "m1",
      thread_key: "Nb/Sec/page.html::whole",
      app_context: "- notePath: Nb/Sec/page.html",
      page_context: "body",
    }), capture.response);
    const { body } = await capture.result;

    const turn = chat.host.getTurn(body.turn_id);
    expect(turn).toMatchObject({
      turnId: body.turn_id,
      status: "running",
      threadKey: "Nb/Sec/page.html::whole",
      provider: "test-unknown-provider",
      model: "m1",
      pageContext: "body",
    });
    expect(turn.appContext).toContain("- notePath: Nb/Sec/page.html");
    expect(chat.host.listRunningTurns().map((entry: { turnId: string }) => entry.turnId)).toEqual([body.turn_id]);
    expect(chat.host.isThreadBusy("Nb/Sec/page.html::whole")).toBe(true);
    expect(chat.host.isThreadBusy("Nb/Sec/other.html::whole")).toBe(false);
  });

  it("starts a host turn on the thread with the caller's turn id and history", async () => {
    const turnId = crypto.randomUUID();
    const result = await chat.host.startHostTurn({
      turnId,
      threadKey: "Nb/Sec/page.html::whole",
      message: "[Jupyter cell wake — automatic resume]",
      history: [{ role: "user", content: "earlier" }],
      provider: "test-unknown-provider",
      model: "m1",
      appContext: "- notePath: Nb/Sec/page.html",
      pageContext: "body",
    });

    expect(result).toEqual({ ok: true, turnId });
    const record = JSON.parse(fs.readFileSync(path.join(root, "jobs", `${turnId}.json`), "utf8"));
    expect(record).toMatchObject({ status: "running", thread_key: "Nb/Sec/page.html::whole" });
    expect(record.request.message).toBe("[Jupyter cell wake — automatic resume]");
    // The server-authoritative connection block is appended once by acceptTurn.
    expect(record.request.app_context.match(/Host-side companion connection/g)).toHaveLength(1);
    expect(chat.host.isThreadBusy("Nb/Sec/page.html::whole")).toBe(true);

    // A reused turn id is rejected, never double-started.
    const again = await chat.host.startHostTurn({ turnId, threadKey: "Nb/Sec/page.html::whole", message: "x", history: [], provider: "test-unknown-provider", model: "", appContext: "", pageContext: "" });
    expect(again).toEqual({ ok: false, error: "turn_id already exists" });
  });

  it("exports the calling turn id to the provider child env", () => {
    expect(buildCompanionProviderEnv({}, 4321, "turn-1")).toEqual({ PORT: "4321", SMART_NOTES_PORT: "4321", SMART_NOTES_TURN_ID: "turn-1" });
    expect(buildCompanionProviderEnv({}, 4321)).toEqual({ PORT: "4321", SMART_NOTES_PORT: "4321" });
  });
});
