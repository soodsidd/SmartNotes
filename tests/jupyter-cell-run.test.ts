/**
 * SN-376: companion cell execution through the Smart Notes-owned Jupyter
 * session (short await). A fake Jupyter Server (REST + kernel channels
 * websocket) stands in for the live server registered behind the proxy.
 */
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";

import { __resetCellRunsForTesting, clampAwaitMs, getJupyterCellRun } from "@/server/jupyter/cell-run";
import { __resetForTesting } from "@/server/jupyter/runtime";
import { executeVaultTool } from "@/server/vault/agent-tools";
import { invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";
import { resolveVaultPath } from "@/server/vault/paths";

const PAGE_PATH = "Notebook/Section/analysis.html";
const BASE_PATH = "/api/jupyter/proxy/fakeproxy/";
const TOKEN = "test-token";
const KERNEL_ID = "kernel-1";

type Send = (msg: Record<string, unknown>) => void;
type KernelScript = (request: Record<string, any>, send: Send, socket: ServerSocket) => void;

interface FakeServer {
  baseUrl: string;
  requests: string[];
  executeRequests: Array<Record<string, any>>;
  sessions: unknown[];
  script: KernelScript;
  sockets: Set<ServerSocket>;
  close(): Promise<void>;
}

async function startFakeJupyter(): Promise<FakeServer> {
  const fake = {
    requests: [] as string[],
    executeRequests: [] as Array<Record<string, any>>,
    sessions: [{ id: "s1", path: "notebook.ipynb", kernel: { id: KERNEL_ID, execution_state: "idle" } }] as unknown[],
    script: (() => undefined) as KernelScript,
    sockets: new Set<ServerSocket>(),
  };
  const server = http.createServer((req, res) => {
    fake.requests.push(req.url ?? "");
    res.setHeader("Connection", "close"); // no keep-alive sockets left for Jest
    const url = new URL(req.url ?? "/", "http://x");
    if (url.searchParams.get("token") !== TOKEN) {
      res.statusCode = 403;
      res.end();
      return;
    }
    if (url.pathname === `${BASE_PATH}api/status`) {
      res.setHeader("Content-Type", "application/json");
      res.end("{}");
      return;
    }
    if (url.pathname === `${BASE_PATH}api/sessions`) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(fake.sessions));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    fake.requests.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== `${BASE_PATH}api/kernels/${KERNEL_ID}/channels` || url.searchParams.get("token") !== TOKEN) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      fake.sockets.add(ws);
      ws.on("close", () => fake.sockets.delete(ws));
      ws.on("message", (data) => {
        const request = JSON.parse(String(data));
        fake.executeRequests.push(request);
        const send: Send = (msg) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
        };
        fake.script(request, send, ws);
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      for (const ws of fake.sockets) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  });
}

function reply(request: Record<string, any>, channel: string, msgType: string, content: Record<string, unknown>) {
  return { channel, msg_type: msgType, header: { msg_type: msgType }, parent_header: request.header, content };
}

/** Kernel behaviour for a cell that runs, prints, and finishes immediately. */
const quickScript: KernelScript = (request, send) => {
  send(reply(request, "iopub", "status", { execution_state: "busy" }));
  send(reply(request, "iopub", "execute_input", { code: request.content.code, execution_count: 7 }));
  send(reply(request, "iopub", "stream", { name: "stdout", text: "hello\n" }));
  send(reply(request, "iopub", "stream", { name: "stderr", text: "warn\n" }));
  send(reply(request, "iopub", "execute_result", { execution_count: 7, data: { "text/plain": "42" } }));
  send(reply(request, "shell", "execute_reply", { status: "ok", execution_count: 7 }));
  send(reply(request, "iopub", "status", { execution_state: "idle" }));
};

let fake: FakeServer;
let vaultRoot: string;
let previousVault: string | undefined;

function registerLiveSession() {
  const { absolutePath } = resolveVaultPath(PAGE_PATH, "page");
  const folder = absolutePath.replace(/\.html$/i, ".jupyter");
  const registry = (globalThis as Record<string, unknown>).__smartNotesJupyterSessions__ as Map<string, unknown>;
  registry.set(path.resolve(folder).toLowerCase(), {
    key: path.resolve(folder).toLowerCase(),
    pagePath: PAGE_PATH,
    folder,
    notebookFile: "notebook.ipynb",
    proxyId: "fakeproxy",
    proxyBasePath: BASE_PATH,
    port: Number(new URL(fake.baseUrl).port),
    token: TOKEN,
    baseUrl: fake.baseUrl,
    frameOrigins: [],
    status: "ready",
    startedAt: new Date().toISOString(),
    logTail: "",
    kind: "note",
  });
}

const NOTEBOOK = {
  cells: [
    { id: "code-1", cell_type: "code", execution_count: null, metadata: {}, source: ["print('hello')\n", "6 * 7"], outputs: [] },
    { id: "md-1", cell_type: "markdown", metadata: {}, source: ["# Title"] },
    { id: "slow-1", cell_type: "code", execution_count: null, metadata: {}, source: ["import time; time.sleep(600)"], outputs: [] },
  ],
  metadata: { kernelspec: { name: "python3" } },
  nbformat: 4,
  nbformat_minor: 5,
};

function notebookPath() {
  return path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter", "notebook.ipynb");
}

beforeEach(async () => {
  previousVault = process.env.SMART_NOTES_VAULT;
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-cell-run-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  invalidateVaultTreeCacheForTesting();
  await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter"), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, PAGE_PATH), "---\ntitle: Analysis\nnote_type: jupyter\n---\n", "utf8");
  await fs.writeFile(notebookPath(), JSON.stringify(NOTEBOOK, null, 1), "utf8");
  __resetForTesting();
  __resetCellRunsForTesting();
  fake = await startFakeJupyter();
  registerLiveSession();
});

afterEach(async () => {
  __resetCellRunsForTesting();
  __resetForTesting();
  await fake.close();
  if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
  else delete process.env.SMART_NOTES_VAULT;
  invalidateVaultTreeCacheForTesting();
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

async function run(args: Record<string, unknown>) {
  return executeVaultTool("jupyter_cell_run", { path: PAGE_PATH, ...args });
}

describe("jupyter_cell_run (SN-376 short await)", () => {
  it("runs a quick cell on the live kernel and returns bounded outputs", async () => {
    fake.script = quickScript;
    const before = await fs.readFile(notebookPath(), "utf8");

    const outcome = await run({ cellId: "code-1", note: "check the answer" });

    expect(outcome.ok).toBe(true);
    const data = (outcome as any).result.data;
    expect(data.run).toMatchObject({
      status: "completed",
      stillRunning: false,
      cell: { index: 0, cellId: "code-1" },
      note: "check the answer",
      kernelId: KERNEL_ID,
      executionCount: 7,
      stdout: { text: "hello\n", truncated: false },
      stderr: { text: "warn\n", truncated: false },
      result: { text: "42", truncated: false },
      error: null,
    });
    expect(typeof data.run.durationMs).toBe("number");
    expect(data.run.runId).toMatch(/^run-/);
    expect(data.handoff).toBeUndefined();

    // Sent the saved cell source as a proper execute_request on the shell channel.
    expect(fake.executeRequests).toHaveLength(1);
    expect(fake.executeRequests[0]).toMatchObject({
      channel: "shell",
      header: { msg_type: "execute_request" },
      content: { code: "print('hello')\n6 * 7", silent: false, store_history: true, allow_stdin: false },
    });
    // Output is reported in the tool result only; notebook.ipynb is untouched.
    expect(await fs.readFile(notebookPath(), "utf8")).toBe(before);
    expect(getJupyterCellRun(data.run.runId)?.status).toBe("completed");
  });

  it("returns a still-running payload with runId + cellId + note at the threshold", async () => {
    let finishLater: (() => void) | null = null;
    fake.script = (request, send) => {
      send(reply(request, "iopub", "status", { execution_state: "busy" }));
      send(reply(request, "iopub", "stream", { name: "stdout", text: "epoch 1\n" }));
      finishLater = () => {
        send(reply(request, "shell", "execute_reply", { status: "ok", execution_count: 3 }));
        send(reply(request, "iopub", "status", { execution_state: "idle" }));
      };
    };

    const started = Date.now();
    const outcome = await run({ index: 2, note: "resume: summarize training loss", awaitSeconds: 1 });
    const elapsed = Date.now() - started;

    expect(outcome.ok).toBe(true);
    const data = (outcome as any).result.data;
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(5_000);
    expect(data.run).toMatchObject({
      status: "running",
      stillRunning: true,
      awaitMs: 1_000,
      cell: { index: 2, cellId: "slow-1" },
      note: "resume: summarize training loss",
      stdout: { text: "epoch 1\n" },
      finishedAt: null,
    });
    expect(data.handoff).toEqual({
      runId: data.run.runId,
      cellId: "slow-1",
      index: 2,
      pagePath: PAGE_PATH,
      kernelId: KERNEL_ID,
      note: "resume: summarize training loss",
    });
    expect(data.hint).toMatch(/Do not re-run/);

    // A second run of the same cell is refused while the first is live.
    const again = await run({ cellId: "slow-1", awaitSeconds: 1 });
    expect(again).toMatchObject({ ok: false, code: "JUPYTER_RUN_IN_PROGRESS" });
    expect((again as any).error).toContain(data.run.runId);
    expect(fake.executeRequests).toHaveLength(1);

    // The detached run keeps listening so SN-377 can pick up the result.
    finishLater!();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getJupyterCellRun(data.run.runId)).toMatchObject({ status: "completed", stillRunning: false, executionCount: 3 });
  });

  it("reports a cell exception as a completed tool call with an error summary", async () => {
    fake.script = (request, send) => {
      send(reply(request, "iopub", "status", { execution_state: "busy" }));
      send(reply(request, "iopub", "error", { ename: "ZeroDivisionError", evalue: "division by zero", traceback: ["\u001b[31mTraceback\u001b[0m", "ZeroDivisionError: division by zero"] }));
      send(reply(request, "shell", "execute_reply", { status: "error", ename: "ZeroDivisionError", evalue: "division by zero", execution_count: 2 }));
      send(reply(request, "iopub", "status", { execution_state: "idle" }));
    };
    const outcome = await run({ index: 0 });
    expect(outcome.ok).toBe(true);
    const data = (outcome as any).result.data;
    expect(data.run.status).toBe("error");
    expect(data.run.error).toMatchObject({ ename: "ZeroDivisionError", evalue: "division by zero" });
    expect(data.run.error.traceback).toBe("Traceback\nZeroDivisionError: division by zero");
  });

  it("fails with an actionable error when the run is interrupted", async () => {
    fake.script = (request, send) => {
      send(reply(request, "iopub", "status", { execution_state: "busy" }));
      send(reply(request, "iopub", "error", { ename: "KeyboardInterrupt", evalue: "", traceback: [] }));
      send(reply(request, "shell", "execute_reply", { status: "error", ename: "KeyboardInterrupt", evalue: "" }));
      send(reply(request, "iopub", "status", { execution_state: "idle" }));
    };
    const outcome = await run({ index: 0 });
    expect(outcome).toMatchObject({ ok: false, code: "JUPYTER_RUN_INTERRUPTED" });
    expect((outcome as any).error).toMatch(/interrupted.*runId run-/);
  });

  it("fails with an actionable error when the kernel dies mid-run", async () => {
    fake.script = (request, send) => {
      send(reply(request, "iopub", "status", { execution_state: "busy" }));
      send({ channel: "iopub", msg_type: "status", header: { msg_type: "status" }, parent_header: {}, content: { execution_state: "dead" } });
    };
    const outcome = await run({ index: 0, awaitSeconds: 5 });
    expect(outcome).toMatchObject({ ok: false, code: "JUPYTER_KERNEL_DEAD" });
  });

  it("fails fast when the kernel connection drops before the cell finishes", async () => {
    fake.script = (request, send, socket) => {
      send(reply(request, "iopub", "status", { execution_state: "busy" }));
      setTimeout(() => socket.terminate(), 20);
    };
    const started = Date.now();
    const outcome = await run({ index: 0, awaitSeconds: 30 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(outcome).toMatchObject({ ok: false, code: "JUPYTER_RUN_DISCONNECTED" });
  });

  it("fails with JUPYTER_SESSION_UNAVAILABLE when the page has no live session", async () => {
    __resetForTesting();
    const outcome = await run({ index: 0 });
    expect(outcome).toMatchObject({ ok: false, code: "JUPYTER_SESSION_UNAVAILABLE", status: 409 });
    expect((outcome as any).error).toMatch(/Open the Jupyter page/);
  });

  it("fails with JUPYTER_SESSION_UNAVAILABLE when the session's server is dead", async () => {
    await fake.close();
    const outcome = await run({ index: 0 });
    expect(outcome).toMatchObject({ ok: false, code: "JUPYTER_SESSION_UNAVAILABLE" });
    fake = await startFakeJupyter(); // afterEach closes it again
  });

  it("fails with JUPYTER_KERNEL_UNAVAILABLE when no kernel is attached to the notebook", async () => {
    fake.sessions = [{ id: "s2", path: "other.ipynb", kernel: { id: "k2" } }];
    const outcome = await run({ index: 0 });
    expect(outcome).toMatchObject({ ok: false, code: "JUPYTER_KERNEL_UNAVAILABLE" });
  });

  it("rejects non-code cells and missing selectors without touching the kernel", async () => {
    expect(await run({ cellId: "md-1" })).toMatchObject({ ok: false, code: "NOT_CODE_CELL" });
    expect(await run({})).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await run({ index: 0, cellId: "slow-1" })).toMatchObject({ ok: false, code: "CELL_SELECTOR_MISMATCH" });
    expect(fake.requests).toHaveLength(0);
  });

  it("never reaches the kernel from jupyter_notebook_context or jupyter_cell_* edit tools", async () => {
    expect((await executeVaultTool("jupyter_notebook_context", { path: PAGE_PATH })).ok).toBe(true);
    expect((await executeVaultTool("jupyter_cell_edit", { path: PAGE_PATH, index: 0, source: "print(1)" })).ok).toBe(true);
    expect((await executeVaultTool("jupyter_cell_create", { path: PAGE_PATH, source: "x = 1" })).ok).toBe(true);
    expect(fake.requests).toHaveLength(0);
    expect(fake.executeRequests).toHaveLength(0);
  });

  it("clamps the short-await window to 1-60s with a 45s default", () => {
    expect(clampAwaitMs(undefined)).toBe(45_000);
    expect(clampAwaitMs(500)).toBe(1_000);
    expect(clampAwaitMs(30_000)).toBe(30_000);
    expect(clampAwaitMs(600_000)).toBe(60_000);
  });
});
