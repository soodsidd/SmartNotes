import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import {
  getStoredProviderEffort,
  resolveAiProviderSelection,
} from "../src/lib/ai-sidebar";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createChatModule, KNOWN_PROVIDER_MODELS } = require("../packages/cli-chat/index");

type ChatSettings = Record<string, unknown>;

function makeRes(): { res: { writeHead: jest.Mock; end: jest.Mock }; result: Promise<{ status: number; data: ChatSettings }> } {
  let resolveResult!: (v: { status: number; data: ChatSettings }) => void;
  const result = new Promise<{ status: number; data: ChatSettings }>((resolve) => {
    resolveResult = resolve;
  });
  let status = 200;
  return {
    res: {
      writeHead: jest.fn((code: number) => { status = code; }),
      end: jest.fn((body: string) => { resolveResult({ status, data: JSON.parse(body || "{}") }); }),
    },
    result,
  };
}

function makeGetReq(url = "/api/chat/settings"): { url: string; method: string; headers: Record<string, string> } {
  return { url, method: "GET", headers: {} };
}

function makePostReq(body: Record<string, unknown>): Readable & { url: string; method: string; headers: Record<string, string> } {
  const buf = Buffer.from(JSON.stringify(body));
  const req = Readable.from([buf]) as Readable & { url: string; method: string; headers: Record<string, string> };
  req.url = "/api/chat/settings";
  req.method = "POST";
  req.headers = { "content-type": "application/json" };
  return req;
}

describe("KNOWN_PROVIDER_MODELS — claude baseline", () => {
  it("claude entry includes sonnet and opus so they always appear in suggestions regardless of CLI discovery", () => {
    expect(Array.isArray(KNOWN_PROVIDER_MODELS.claude)).toBe(true);
    expect(KNOWN_PROVIDER_MODELS.claude).toContain("sonnet");
    expect(KNOWN_PROVIDER_MODELS.claude).toContain("opus");
    expect(KNOWN_PROVIDER_MODELS.claude).toContain("haiku");
  });
});

describe("chat settings — save/load round-trip", () => {
  let tempDir: string;
  let configPath: string;
  let chat: { handleRequest: (req: unknown, res: unknown) => void };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sn36-chat-settings-"));
    configPath = path.join(tempDir, "settings.json");
    chat = createChatModule(null, null, {
      configPath,
      workingDirectory: tempDir,
      stateDir: tempDir,
      recoverInterruptedOnStartup: false,
      uploadDir: path.join(tempDir, "uploads"),
    });
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("GET /settings returns an object when no config file exists yet", async () => {
    const { res, result } = makeRes();
    chat.handleRequest(makeGetReq(), res);
    const { status, data } = await result;
    expect(status).toBe(200);
    expect(data).toBeDefined();
    expect(typeof data).toBe("object");
  });

  it("POST /settings persists provider and model; GET /settings restores them", async () => {
    const { res: r1, result: p1 } = makeRes();
    chat.handleRequest(makePostReq({ defaultProvider: "codex", codexModel: "gpt-5-codex" }), r1);
    const { status: s1 } = await p1;
    expect(s1).toBe(200);

    const { res: r2, result: p2 } = makeRes();
    chat.handleRequest(makeGetReq(), r2);
    const { data } = await p2;
    expect(data.defaultProvider).toBe("codex");
    expect(data.codexModel).toBe("gpt-5-codex");
  });

  it("persists and restores effort for each effort-capable provider", async () => {
    const cases = [
      { provider: "ghcopilot", effortKey: "ghcopilotEffort", modelKey: "ghcopilotModel", model: "gpt-4.1" },
      { provider: "codex",     effortKey: "codexEffort",     modelKey: "codexModel",     model: "gpt-5-codex" },
      { provider: "cursor",    effortKey: "cursorEffort",    modelKey: "cursorModel",     model: "cursor-ultra" },
    ];

    for (const c of cases) {
      const { res: r1, result: p1 } = makeRes();
      chat.handleRequest(
        makePostReq({ defaultProvider: c.provider, [c.modelKey]: c.model, [c.effortKey]: "high" }),
        r1
      );
      await p1;

      const { res: r2, result: p2 } = makeRes();
      chat.handleRequest(makeGetReq(), r2);
      const { data } = await p2;
      expect(data[c.effortKey]).toBe("high");
      expect(data[c.modelKey]).toBe(c.model);
    }
  });

  it("persists verbose = false and survives reload", async () => {
    const { res: r1, result: p1 } = makeRes();
    chat.handleRequest(makePostReq({ verbose: false }), r1);
    await p1;

    const { res: r2, result: p2 } = makeRes();
    chat.handleRequest(makeGetReq(), r2);
    const { data } = await p2;
    expect(data.verbose).toBe(false);
  });

  it("toggling verbose back to true persists correctly", async () => {
    const { res: r1, result: p1 } = makeRes();
    chat.handleRequest(makePostReq({ verbose: false }), r1);
    await p1;

    const { res: r2, result: p2 } = makeRes();
    chat.handleRequest(makePostReq({ verbose: true }), r2);
    await p2;

    const { res: r3, result: p3 } = makeRes();
    chat.handleRequest(makeGetReq(), r3);
    const { data } = await p3;
    expect(data.verbose).toBe(true);
  });

  it("resolveAiProviderSelection restores per-provider model from saved settings", async () => {
    const { res: r1, result: p1 } = makeRes();
    chat.handleRequest(makePostReq({ claudeModel: "claude-opus-4-7" }), r1);
    await p1;

    const { res: r2, result: p2 } = makeRes();
    chat.handleRequest(makePostReq({ codexModel: "gpt-5-codex", defaultProvider: "codex" }), r2);
    await p2;

    const { res: r3, result: p3 } = makeRes();
    chat.handleRequest(makeGetReq(), r3);
    const { data } = await p3;

    const providers = [
      { id: "claude", name: "Claude", models: ["claude-sonnet-4-6", "claude-opus-4-7"] },
      { id: "codex",  name: "Codex",  models: ["gpt-5-codex", "gpt-5-mini"] },
    ];

    const claudeSelection = resolveAiProviderSelection(providers, data, "claude");
    expect(claudeSelection.model).toBe("claude-opus-4-7");

    const codexSelection = resolveAiProviderSelection(providers, data, "codex");
    expect(codexSelection.model).toBe("gpt-5-codex");
  });

  it("getStoredProviderEffort returns saved effort values; returns empty for non-effort providers", async () => {
    const { res, result } = makeRes();
    chat.handleRequest(makePostReq({ ghcopilotEffort: "low", codexEffort: "high", cursorEffort: "medium" }), res);
    await result;

    const { res: gr, result: gr2 } = makeRes();
    chat.handleRequest(makeGetReq(), gr);
    const { data } = await gr2;

    expect(getStoredProviderEffort(data, "ghcopilot")).toBe("low");
    expect(getStoredProviderEffort(data, "codex")).toBe("high");
    expect(getStoredProviderEffort(data, "cursor")).toBe("medium");
    expect(getStoredProviderEffort(data, "claude")).toBe("");
  });

  it("settings survive a simulated server restart (new module instance reads same config file)", async () => {
    const { res: r1, result: p1 } = makeRes();
    chat.handleRequest(makePostReq({ claudeModel: "claude-sonnet-4-6", verbose: false }), r1);
    await p1;

    // New module instance with same configPath simulates a server restart
    const chat2 = createChatModule(null, null, {
      configPath,
      workingDirectory: tempDir,
      stateDir: tempDir,
      recoverInterruptedOnStartup: false,
      uploadDir: path.join(tempDir, "uploads"),
    });

    const { res: r2, result: p2 } = makeRes();
    chat2.handleRequest(makeGetReq(), r2);
    const { data } = await p2;
    expect(data.claudeModel).toBe("claude-sonnet-4-6");
    expect(data.verbose).toBe(false);
  });

  it("discovers running turns outside the currently selected server scope when requested", async () => {
    const turnId = "123e4567-e89b-42d3-a456-426614174000";
    const jobsDir = path.join(tempDir, "jobs");
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobsDir, `${turnId}.json`),
      JSON.stringify({
        version: 2,
        turn_id: turnId,
        status: "running",
        created_at: Date.now(),
        updated_at: Date.now(),
        scope_key: "a-different-restored-scope",
        request: {},
        events: [],
      })
    );

    const { res, result } = makeRes();
    chat.handleRequest(makeGetReq("/api/chat/history?all_scopes=1"), res);
    const { status, data } = await result;

    expect(status).toBe(200);
    expect(data.active_turns).toEqual(
      expect.arrayContaining([expect.objectContaining({ turn_id: turnId })])
    );
  });
});
