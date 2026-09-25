import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const { createChatModule } = require("../packages/cli-chat/index");

function postRequest(body: Record<string, unknown>) {
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
  let finish!: (value: { status: number; body: Record<string, unknown> }) => void;
  const result = new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
    finish = resolve;
  });
  let status = 200;
  return {
    response: {
      writeHead: jest.fn((value: number) => { status = value; }),
      end: jest.fn((body: string) => finish({ status, body: JSON.parse(body || "{}") })),
    },
    result,
  };
}

describe("SN-261 Deep Work Companion turn binding", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "sn261-companion-binding-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses the resolved workspace scope and discards a selected similarly named vault project", async () => {
    const appDirectory = path.join(root, "smart-notes-app");
    const vaultProject = path.join(root, "similarly-named-vault-project");
    const bridgeRoot = path.join(root, "bound-bridge");
    const stateDirectory = path.join(root, "state");
    const configPath = path.join(stateDirectory, "settings.json");
    for (const directory of [appDirectory, vaultProject, bridgeRoot, stateDirectory]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify({ projectId: "vault-lerobot" }), "utf8");
    const capability = `dwc_${"a".repeat(43)}`;
    const resolveDeepWorkTurn = jest.fn().mockResolvedValue({
      scopeKey: "deep-work:authoritative-root",
      workingDirectory: appDirectory,
      companionBridgeRoot: bridgeRoot,
    });
    const chat = createChatModule(null, { emit: jest.fn() }, {
      appId: "smart-notes",
      configPath,
      workingDirectory: appDirectory,
      stateDir: stateDirectory,
      recoverInterruptedOnStartup: false,
      uploadDir: path.join(root, "uploads"),
      projects: [{ id: "vault-lerobot", name: "LeRobot", repoRoot: vaultProject }],
      resolveDeepWorkTurn,
    });
    const { response, result } = responseCapture();
    chat.handleRequest(postRequest({
      message: "Inspect main.py",
      provider: "test-unknown-provider",
      app_context: [
        "Smart Notes Deep Work operating context:",
        "- Registered workspace root identity: C:\\Projects\\LeRobot",
        `- workspaceCapability: ${capability}`,
        "- Active repository-relative file: main.py",
      ].join("\n"),
    }), response);
    const sent = await result;

    expect(sent.status).toBe(200);
    expect(resolveDeepWorkTurn).toHaveBeenCalledWith(capability);
    const record = JSON.parse(fs.readFileSync(
      path.join(stateDirectory, "jobs", `${sent.body.turn_id}.json`),
      "utf8"
    ));
    expect(record.scope_key).toBe("deep-work:authoritative-root");
    expect(record.project_id).toBe("");
    expect(record.request.working_directory).toBe(appDirectory);
    expect(record.request.working_directory).not.toBe(vaultProject);
    expect(record.request.app_context).toContain("Vault page/tree/Jupyter-note tools are outside its authority");
  });

  it("rejects an unresolvable Deep Work capability before launching a provider", async () => {
    const chat = createChatModule(null, { emit: jest.fn() }, {
      workingDirectory: root,
      stateDir: root,
      recoverInterruptedOnStartup: false,
      uploadDir: path.join(root, "uploads"),
      resolveDeepWorkTurn: jest.fn().mockResolvedValue(null),
    });
    const { response, result } = responseCapture();
    chat.handleRequest(postRequest({
      message: "Inspect main.py",
      app_context: [
        "Smart Notes Deep Work operating context:",
        `- workspaceCapability: dwc_${"b".repeat(43)}`,
      ].join("\n"),
    }), response);

    await expect(result).resolves.toMatchObject({
      status: 403,
      body: { error: expect.stringContaining("invalid or expired") },
    });
  });
});
