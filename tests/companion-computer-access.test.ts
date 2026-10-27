/**
 * SN-356: Companion opt-in Computer access (mid-session toggle).
 *
 * The Companion composer sends `computer_access: true` only on turns the owner
 * armed via the "Computer" checkbox. cli-chat overlays shell access onto the
 * per-turn sandbox and tells the agent the current grant state, so toggling
 * mid-session arms / disarms the very next turn without restarting the chat.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable, PassThrough } from "node:stream";
import { buildAiTurnRequest } from "@/lib/ai-sidebar";

jest.mock("child_process", () => {
  const actual = jest.requireActual("child_process");
  return {
    ...actual,
    execSync: jest.fn((command: string) => {
      if (/^where |^which /.test(command)) return "C:\\fake\\claude.cmd\n";
      if (/cursor-agent status/.test(command)) return "Logged in";
      if (/auth status/.test(command)) return JSON.stringify({ loggedIn: true });
      return "";
    }),
    spawn: jest.fn(),
  };
});

const childProcess = require("child_process") as { spawn: jest.Mock };
const {
  PROFILES,
  resolveSandbox,
  claudeSandboxArgs,
  codexExecArgs,
  cursorHeadlessArgs,
  applyComputerAccess,
  computerAccessSessionKey,
  buildComputerAccessGuidance,
} = require("../packages/cli-chat/sandbox");
const { createChatModule } = require("../packages/cli-chat/index");

function fakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    kill: jest.Mock;
    stdinText: string;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 4242;
  proc.kill = jest.fn();
  proc.stdinText = "";
  proc.stdin.on("data", (chunk) => {
    proc.stdinText += String(chunk);
  });
  return proc;
}

function argValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("SN-356 computer access sandbox overlay", () => {
  const editor = resolveSandbox("editor");

  it("hard-disables local computer tools while leaving the base profile untouched", () => {
    const disarmed = applyComputerAccess(editor, false);
    const args = claudeSandboxArgs(disarmed);
    expect(argValue(args, "--disallowedTools")?.split(",")).toEqual(expect.arrayContaining(["Bash", "PowerShell", "Computer"]));
    expect(argValue(args, "--allowedTools")).not.toMatch(/Bash|PowerShell/);
    expect(disarmed.ghcopilot.computerAccessDisabled).toBe(true);
    expect(codexExecArgs(disarmed)).toEqual(expect.arrayContaining(["--disable", "shell_tool", "unified_exec", "computer_use"]));
    // Editor profile keeps headlessAutoApprove so vault Write still works;
    // Computer OFF must not force Cursor Ask mode (that blocked page_write).
    expect(cursorHeadlessArgs(disarmed)).toEqual(["--force"]);
    expect(disarmed.cursor.headlessAutoApprove).toBe(true);
    expect(editor.claude.disallowedTools).toEqual(["Bash", "Computer"]);
  });

  it("adds a turn-scoped MCP server only to Computer-OFF Codex exec args", () => {
    const scoped = { script: "C:\\app\\companion-mcp.js", root: "C:\\app\\bridge", capability: `dwc_${"a".repeat(43)}` };
    const off = codexExecArgs(applyComputerAccess(editor, false), { companionMcp: scoped });
    expect(off).toEqual(expect.arrayContaining(["--sandbox", "read-only", "--ignore-user-config", "--disable", "shell_tool", "unified_exec", "computer_use", "browser_use"]));
    expect(off).toContain("mcp_servers.smart_notes_companion.command=node");
    expect(off).toContain("mcp_servers.smart_notes_companion.default_tools_approval_mode=approve");
    expect(off).toContain(`mcp_servers.smart_notes_companion.args=['C:/app/companion-mcp.js','C:/app/bridge','${scoped.capability}']`);
    const resumed = codexExecArgs(applyComputerAccess(editor, false), { companionMcp: scoped, resume: true });
    expect(resumed).toContain("mcp_servers.smart_notes_companion.command=node");
    expect(resumed).not.toContain("--sandbox");
    const on = codexExecArgs(applyComputerAccess(editor, true), { companionMcp: scoped });
    expect(on.join(" ")).not.toContain("mcp_servers.smart_notes_companion");
  });

  it("unlocks shell tools for an armed turn without mutating the shared profile", () => {
    const armed = applyComputerAccess(editor, true);
    const args = claudeSandboxArgs(armed);
    expect(argValue(args, "--allowedTools")?.split(",")).toEqual(expect.arrayContaining(["Bash", "PowerShell", "Read"]));
    expect(args).not.toContain("--disallowedTools");
    expect(codexExecArgs(armed)).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(armed.ghcopilot.autoApprove).toBe(true);
    // The module-level profile used by the next disarmed turn is unchanged.
    expect(PROFILES.editor.claude.disallowedTools).toEqual(["Bash", "Computer"]);
    expect(editor.codex.sandbox).toBe("workspace-write");
  });

  it("keeps armed turns on a separate resumable provider session", () => {
    expect(computerAccessSessionKey("k", false)).toBe("k#computer-off");
    expect(computerAccessSessionKey("k", true)).toBe("k#computer-access");
  });

  it("tells the agent the grant state each turn", () => {
    const off = buildComputerAccessGuidance(false);
    expect(off).toMatch(/Computer access: OFF/);
    expect(off).toMatch(/Do not claim or attempt desktop control/);
    expect(off).toMatch(/Vault edits still work/);
    expect(off).toMatch(/Never tell the owner to "switch to Agent mode"/);
    const on = buildComputerAccessGuidance(true, { platform: "win32", screenshotScript: "C:\\x\\desktop-screenshot.ps1" });
    expect(on).toMatch(/Computer access: ON/);
    expect(on).toContain("C:\\x\\desktop-screenshot.ps1");
    expect(on).toMatch(/Ask the owner before anything state-changing/);
  });

  it("ships the desktop screenshot helper referenced by the guidance", () => {
    const script = fs.readFileSync(path.join(__dirname, "../packages/cli-chat/desktop-screenshot.ps1"), "utf8");
    expect(script).toMatch(/CopyFromScreen/);
    expect(script).toMatch(/Write-Output \$OutPath/);
  });
});

describe("SN-356 buildAiTurnRequest", () => {
  const base = { message: "hi", history: [], pageContext: "" };
  it("always sends an explicit computer_access boolean, true only when armed", () => {
    expect(buildAiTurnRequest(base).computer_access).toBe(false);
    expect(buildAiTurnRequest({ ...base, computerAccess: false }).computer_access).toBe(false);
    expect(buildAiTurnRequest({ ...base, computerAccess: true }).computer_access).toBe(true);
  });
});

describe("SN-356 mid-session toggle through /api/chat/send", () => {
  let root = "";
  let chat: ReturnType<typeof createChatModule>;
  let immediate: jest.SpyInstance;
  let pendingRuns: Array<() => void>;
  let procs: ReturnType<typeof fakeProc>[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "sn356-computer-access-"));
    procs = [];
    childProcess.spawn.mockReset();
    childProcess.spawn.mockImplementation(() => {
      const proc = fakeProc();
      procs.push(proc);
      return proc;
    });
    chat = createChatModule(null, { emit: jest.fn() }, {
      appId: "smart-notes",
      workingDirectory: root,
      stateDir: root,
      configPath: path.join(root, "settings.json"),
      recoverInterruptedOnStartup: false,
      uploadDir: path.join(root, "uploads"),
      sandbox: "editor",
      resolveDeepWorkTurn: async () => ({
        scopeKey: "deep-work:sn356-root",
        workingDirectory: root,
        companionBridgeRoot: path.join(root, "dw-bridge"),
      }),
    });
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

  async function send(body: Record<string, unknown>) {
    const request = Readable.from([Buffer.from(JSON.stringify(body))]) as Readable & {
      url: string;
      method: string;
      headers: Record<string, string>;
    };
    request.url = "/api/chat/send";
    request.method = "POST";
    request.headers = { "content-type": "application/json" };
    const result = await new Promise<{ status: number; body: Record<string, string> }>((resolve) => {
      let status = 200;
      chat.handleRequest(request, {
        writeHead: (value: number) => { status = value; },
        end: (text: string) => resolve({ status, body: JSON.parse(text || "{}") }),
      });
    });
    expect(result.status).toBe(200);
    const turnId = result.body.turn_id;
    pendingRuns.shift()?.();
    const proc = procs[procs.length - 1];
    const [, args, spawnOptions] = childProcess.spawn.mock.calls[childProcess.spawn.mock.calls.length - 1] as [string, string[], { env: NodeJS.ProcessEnv }];
    const record = JSON.parse(fs.readFileSync(path.join(root, "jobs", `${turnId}.json`), "utf8"));
    // Finish the turn so the next same-thread send does not supersede it.
    proc.emit("close", 0);
    return { args, spawnOptions, stdin: proc.stdinText, record };
  }

  it("arms and disarms subsequent turns in the same thread without a restart", async () => {
    const thread = { provider: "claude", thread_key: "book/diag.html::whole" };

    const off = await send({ ...thread, message: "what is using my CPU?" });
    expect(argValue(off.args, "--disallowedTools")?.split(",")).toEqual(expect.arrayContaining(["Bash", "PowerShell", "Computer"]));
    expect(off.stdin).toMatch(/Computer access: OFF/);
    expect(off.record.request.computer_access).toBe(false);

    const on = await send({ ...thread, message: "check it now", computer_access: true });
    expect(on.args).not.toContain("--disallowedTools");
    expect(argValue(on.args, "--allowedTools")?.split(",")).toEqual(expect.arrayContaining(["Bash", "PowerShell"]));
    expect(on.stdin).toMatch(/Computer access: ON/);
    expect(on.stdin).toContain("desktop-screenshot.ps1");
    expect(on.record.request.computer_access).toBe(true);

    const offAgain = await send({ ...thread, message: "and again" });
    expect(argValue(offAgain.args, "--disallowedTools")?.split(",")).toEqual(expect.arrayContaining(["Bash", "PowerShell", "Computer"]));
    expect(argValue(offAgain.args, "--allowedTools")).not.toMatch(/Bash|PowerShell/);
    expect(offAgain.stdin).toMatch(/Computer access: OFF/);
    expect(offAgain.record.request.computer_access).toBe(false);
  });

  it("only treats a literal true as an opt-in", async () => {
    const turn = await send({ provider: "claude", message: "hi", computer_access: "yes" });
    expect(argValue(turn.args, "--disallowedTools")?.split(",")).toEqual(expect.arrayContaining(["Bash", "PowerShell", "Computer"]));
    expect(turn.record.request.computer_access).toBe(false);
  });

  it("overrides a permissive base profile when Computer is off", () => {
    const disarmed = applyComputerAccess(resolveSandbox("full"), false);
    const claudeArgs = claudeSandboxArgs(disarmed);
    expect(claudeArgs).not.toContain("--dangerously-skip-permissions");
    expect(argValue(claudeArgs, "--disallowedTools")?.split(",")).toEqual(expect.arrayContaining(["Bash", "PowerShell", "Computer"]));
    expect(disarmed.codex.sandbox).toBe("read-only");
    expect(disarmed.ghcopilot.autoApprove).toBe(false);
    expect(disarmed.cursor.autoApprove).toBe(false);
  });

  it("runs a Cursor on → off sequence with an isolated shell-deny config and no armed resume", async () => {
    const thread = { provider: "cursor", thread_key: "book/cameras.html::whole" };
    const on = await send({ ...thread, message: "Inspect cameras", computer_access: true });
    expect(on.args).toContain("--force");
    expect(on.args).not.toContain("--mode");
    expect(on.record.request.computer_access).toBe(true);

    const off = await send({ ...thread, message: "Try again" });
    expect(off.args).toContain("--force");
    expect(off.args).not.toContain("--mode");
    expect(off.args).not.toContain("--resume");
    const configDir = off.spawnOptions.env.CURSOR_CONFIG_DIR;
    expect(configDir).toBe(path.join(root, "cursor-computer-off"));
    const config = JSON.parse(fs.readFileSync(path.join(configDir!, "cli-config.json"), "utf8"));
    expect(config.permissions.deny).toEqual(["Shell(*)"]);
    expect(config.permissions.deny).not.toContain("Write(**)");
    expect(off.stdin).toMatch(/Computer access: OFF/);
    expect(off.stdin).toMatch(/Vault edits still work/);
    expect(off.record.request.computer_access).toBe(false);
  });

  it("arms a Deep Work turn when the box is checked (rework cycle 2: Off -> On -> Off)", async () => {
    const capability = `dwc_${"a".repeat(43)}`;
    const thread = {
      provider: "cursor",
      thread_key: `${capability}::whole`,
      app_context: ["Smart Notes Deep Work operating context:", `- workspaceCapability: ${capability}`].join("\n"),
    };
    const off = await send({ ...thread, message: "Inspect cameras" });
    expect(off.args).toContain("--force");
    expect(off.args).not.toContain("--mode");
    expect(off.stdin).toMatch(/Computer access: OFF/);
    expect(off.record.request.computer_access).toBe(false);

    const on = await send({ ...thread, message: "ok try again", computer_access: true });
    expect(on.record.request.computer_access).toBe(true);
    expect(on.args).toContain("--force");
    expect(on.args).not.toContain("--mode");
    expect(on.spawnOptions.env.CURSOR_CONFIG_DIR).toBeUndefined();
    expect(on.stdin).toMatch(/Computer access: ON/);
    expect(on.stdin).not.toMatch(/## Computer access: OFF/);
    // The Deep Work "do not probe processes" connection rule is explicitly superseded for PC inspection.
    expect(on.stdin).toMatch(/supersedes any connection-context rule against probing processes/);

    const offAgain = await send({ ...thread, message: "and now?" });
    expect(offAgain.record.request.computer_access).toBe(false);
    expect(offAgain.args).toContain("--force");
    expect(offAgain.args).not.toContain("--mode");
    expect(offAgain.args).not.toContain("--resume");
    expect(offAgain.stdin).toMatch(/Computer access: OFF/);
  });

  it("denies Copilot shell after an armed turn", async () => {
    const thread = { provider: "ghcopilot", thread_key: "book/cameras.html::whole" };
    const on = await send({ ...thread, message: "Inspect cameras", computer_access: true });
    expect(on.args).toContain("--yolo");

    const off = await send({ ...thread, message: "Try again" });
    expect(off.args).not.toContain("--yolo");
    expect(off.args).toContain("--deny-tool=shell");
    expect(off.args).not.toContain("--resume");
    expect(off.record.request.computer_access).toBe(false);
  });

  it("wires only a Computer-OFF Codex Deep Work turn to its capability bridge", async () => {
    const capability = `dwc_${"b".repeat(43)}`;
    const thread = {
      provider: "codex", thread_key: `${capability}::whole`,
      app_context: `Smart Notes Deep Work operating context:\n- workspaceCapability: ${capability}`,
    };
    const off = await send({ ...thread, message: "create a notebook" });
    expect(off.args).toContain("mcp_servers.smart_notes_companion.command=node");
    expect(off.args.join(" ")).toContain(capability);
    expect(off.stdin).toContain("call the smart_notes_companion MCP workspace_* tools");
    expect(off.stdin).not.toContain("Exact capability-bound bridge paths");
    const on = await send({ ...thread, message: "continue", computer_access: true });
    expect(on.args.join(" ")).not.toContain("mcp_servers.smart_notes_companion");
    const offAgain = await send({ ...thread, message: "continue" });
    expect(offAgain.args).toContain("mcp_servers.smart_notes_companion.command=node");
  });
});
