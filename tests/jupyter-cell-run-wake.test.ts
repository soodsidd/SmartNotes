/**
 * SN-377: Jupyter cell-run wake — detach, wait for complete, auto-resume.
 * A fake Jupyter Server (REST + kernel channels websocket) stands in for the
 * page's live server and a fake cli-chat host records resume turns.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";

import { __resetCellRunsForTesting } from "@/server/jupyter/cell-run";
import {
  __configureCellRunWakesForTesting,
  __flushCellRunWakesForTesting,
  cancelCellRunWake,
  listCellRunWakes,
  parseCompanionThreadKey,
  type CompanionTurnInfo,
  type CompanionWakeHost,
} from "@/server/jupyter/cell-run-wake";
import { __resetForTesting } from "@/server/jupyter/runtime";
import { executeVaultTool } from "@/server/vault/agent-tools";
import { invalidateVaultTreeCacheForTesting, readCompanionSessions, saveCompanionSessions } from "@/server/vault/pages";
import { resolveVaultPath } from "@/server/vault/paths";

const PAGE_PATH = "Notebook/Section/analysis.html";
const OTHER_PAGE = "Notebook/Section/other.html";
const BASE_PATH = "/api/jupyter/proxy/fakeproxy/";
const TOKEN = "test-token";
const KERNEL_ID = "kernel-1";
const THREAD_A = `${PAGE_PATH}::whole`;
const THREAD_B = `${OTHER_PAGE}::whole`;

type Send = (msg: Record<string, unknown>) => void;

interface FakeServer {
  baseUrl: string;
  interrupts: number;
  executeRequests: Array<Record<string, any>>;
  finishers: Map<string, (status?: "ok" | "error") => void>;
  close(): Promise<void>;
}

function reply(request: Record<string, any>, channel: string, msgType: string, content: Record<string, unknown>) {
  return { channel, msg_type: msgType, header: { msg_type: msgType }, parent_header: request.header, content };
}

/** Every cell starts, prints, and waits for the test to finish it by cell source. */
async function startFakeJupyter(): Promise<FakeServer> {
  const fake = {
    interrupts: 0,
    executeRequests: [] as Array<Record<string, any>>,
    finishers: new Map<string, (status?: "ok" | "error") => void>(),
    sockets: new Set<ServerSocket>(),
  };
  const server = http.createServer((req, res) => {
    res.setHeader("Connection", "close");
    const url = new URL(req.url ?? "/", "http://x");
    if (url.searchParams.get("token") !== TOKEN) {
      res.statusCode = 403;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === `${BASE_PATH}api/status`) return void res.end("{}");
    if (url.pathname === `${BASE_PATH}api/sessions`) {
      return void res.end(JSON.stringify([{ id: "s1", path: "notebook.ipynb", kernel: { id: KERNEL_ID, execution_state: "busy" } }]));
    }
    if (url.pathname === `${BASE_PATH}api/kernels/${KERNEL_ID}/interrupt` && req.method === "POST") {
      fake.interrupts += 1;
      for (const finish of fake.finishers.values()) finish("error");
      res.statusCode = 204;
      return void res.end();
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      fake.sockets.add(ws);
      ws.on("close", () => fake.sockets.delete(ws));
      ws.on("message", (data) => {
        const request = JSON.parse(String(data));
        fake.executeRequests.push(request);
        const send: Send = (msg) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
        };
        send(reply(request, "iopub", "status", { execution_state: "busy" }));
        send(reply(request, "iopub", "stream", { name: "stdout", text: `start ${request.content.code}\n` }));
        fake.finishers.set(request.content.code, (status = "ok") => {
          fake.finishers.delete(request.content.code);
          if (status === "ok") {
            send(reply(request, "iopub", "stream", { name: "stdout", text: "loss=0.12\n" }));
            send(reply(request, "iopub", "execute_result", { execution_count: 4, data: { "text/plain": "'done'" } }));
            send(reply(request, "shell", "execute_reply", { status: "ok", execution_count: 4 }));
          } else {
            send(reply(request, "iopub", "error", { ename: "KeyboardInterrupt", evalue: "", traceback: ["KeyboardInterrupt"] }));
            send(reply(request, "shell", "execute_reply", { status: "error", ename: "KeyboardInterrupt", evalue: "" }));
          }
          send(reply(request, "iopub", "status", { execution_state: "idle" }));
        });
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

interface FakeHost extends CompanionWakeHost {
  turns: Map<string, CompanionTurnInfo>;
  started: Array<Parameters<CompanionWakeHost["startHostTurn"]>[0]>;
  addTurn(threadKey: string, extra?: Partial<CompanionTurnInfo>): CompanionTurnInfo;
}

function createFakeHost(): FakeHost {
  const turns = new Map<string, CompanionTurnInfo>();
  const started: FakeHost["started"] = [];
  return {
    turns,
    started,
    addTurn(threadKey, extra = {}) {
      const turn: CompanionTurnInfo = {
        turnId: crypto.randomUUID(),
        status: "running",
        threadKey,
        provider: "claude",
        model: "sonnet",
        appContext: `- notePath: ${threadKey.split("::")[0]}\n\nHost-side companion connection (server-authoritative):\n- apiBaseUrl: http://127.0.0.1:1`,
        pageContext: "page body",
        ...extra,
      };
      turns.set(turn.turnId, turn);
      return turn;
    },
    getTurn: (turnId) => turns.get(turnId) ?? null,
    listRunningTurns: () => [...turns.values()].filter((turn) => turn.status === "running"),
    isThreadBusy: (threadKey) => [...turns.values()].some((turn) => turn.status === "running" && turn.threadKey === threadKey),
    async startHostTurn(input) {
      started.push(input);
      turns.set(input.turnId, { turnId: input.turnId, status: "running", threadKey: input.threadKey, provider: input.provider, model: input.model, appContext: input.appContext, pageContext: input.pageContext });
      return { ok: true, turnId: input.turnId };
    },
  };
}

const NOTEBOOK = {
  cells: [
    { id: "slow-1", cell_type: "code", execution_count: null, metadata: {}, source: ["train()"], outputs: [] },
    { id: "slow-2", cell_type: "code", execution_count: null, metadata: {}, source: ["evaluate()"], outputs: [] },
  ],
  metadata: { kernelspec: { name: "python3" } },
  nbformat: 4,
  nbformat_minor: 5,
};

let fake: FakeServer;
let host: FakeHost;
let vaultRoot: string;
let stateDir: string;
let emitted: Array<Record<string, any>>;
const previousEnv = { ...process.env };

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

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 4_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function runSlow(args: Record<string, unknown>) {
  const outcome = await executeVaultTool("jupyter_cell_run", { path: PAGE_PATH, awaitSeconds: 1, ...args });
  expect(outcome.ok).toBe(true);
  return (outcome as any).result.data;
}

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-cell-wake-"));
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-cell-wake-state-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  invalidateVaultTreeCacheForTesting();
  await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter"), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, PAGE_PATH), "---\ntitle: Analysis\nnote_type: jupyter\n---\n", "utf8");
  await fs.writeFile(path.join(vaultRoot, OTHER_PAGE), "---\ntitle: Other\n---\n", "utf8");
  await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter", "notebook.ipynb"), JSON.stringify(NOTEBOOK), "utf8");
  __resetForTesting();
  __resetCellRunsForTesting();
  fake = await startFakeJupyter();
  registerLiveSession();
  host = createFakeHost();
  __configureCellRunWakesForTesting({ host, pollMs: 10, graceMs: 0, maxIdleWaitMs: 5_000 });
  emitted = [];
  (globalThis as Record<string, unknown>)._smartNotesIo = {
    emit: (event: string, data: Record<string, any>) => {
      if (event === "companion_cell_wake") emitted.push(data);
    },
  };
});

afterEach(async () => {
  await __flushCellRunWakesForTesting();
  __configureCellRunWakesForTesting(null);
  __resetCellRunsForTesting();
  __resetForTesting();
  await fake.close();
  delete (globalThis as Record<string, unknown>)._smartNotesIo;
  process.env = { ...previousEnv };
  invalidateVaultTreeCacheForTesting();
  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe("Jupyter cell-run wake (SN-377)", () => {
  it("registers a durable per-thread wake on still-running handoff and tells the provider to end its turn", async () => {
    const source = host.addTurn(THREAD_A);

    const data = await runSlow({ cellId: "slow-1", note: "summarize the loss", _companionTurnId: source.turnId });

    expect(data.run.stillRunning).toBe(true);
    expect(data.wake).toMatchObject({ status: "pending", wakeId: expect.stringMatching(/^wake-/) });
    expect(data.hint).toMatch(/END YOUR TURN NOW/);
    expect(data.hint).toMatch(/Do not poll/);

    const [wake] = await listCellRunWakes();
    expect(wake).toMatchObject({
      runId: data.run.runId,
      cellId: "slow-1",
      note: "summarize the loss",
      status: "pending",
      threadKey: THREAD_A,
      storePath: PAGE_PATH,
      scopeKey: "whole",
      sourceTurnId: source.turnId,
    });
    // Durable: written to the app state dir, and the client view omits provider context.
    await __flushCellRunWakesForTesting();
    const persisted = JSON.parse(await fs.readFile(path.join(stateDir, "jupyter-cell-wakes.json"), "utf8"));
    expect(persisted.wakes).toHaveLength(1);
    expect(persisted.wakes[0]).toMatchObject({ wakeId: wake.wakeId, status: "pending", appContext: expect.any(String) });
    expect((wake as any).appContext).toBeUndefined();
    expect(emitted.at(-1)).toMatchObject({ wakeId: wake.wakeId, status: "pending" });
  });

  it("on complete waits for the parked turn to finish, then appends a bounded wake and resumes the same thread", async () => {
    const source = host.addTurn(THREAD_A);
    await saveCompanionSessions(PAGE_PATH, {
      whole: {
        messages: [
          { id: "u1", role: "user", content: "Train the model and tell me the loss" },
          { id: "a1", role: "assistant", content: "Started training; it is still running." },
        ],
        activeTurn: { turnId: source.turnId, assistantMessageId: "a1", lastSeq: 3, startedAt: Date.now() },
      },
    });
    const data = await runSlow({ cellId: "slow-1", note: "summarize the loss", _companionTurnId: source.turnId });

    fake.finishers.get("train()")!();
    // The provider turn is still running: the wake must not supersede it.
    await waitFor(async () => (await listCellRunWakes())[0]?.status === "resuming");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(host.started).toHaveLength(0);

    host.turns.get(source.turnId)!.status = "completed";
    const wake = await waitFor(async () => (await listCellRunWakes()).find((entry) => entry.status === "resumed"));

    expect(host.started).toHaveLength(1);
    const resume = host.started[0];
    expect(resume).toMatchObject({ threadKey: THREAD_A, provider: "claude", model: "sonnet", pageContext: "page body" });
    expect(resume.turnId).toBe(wake.resumeTurnId);
    expect(resume.message).toContain("[Jupyter cell wake — automatic resume]");
    expect(resume.message).toContain("finished successfully");
    expect(resume.message).toContain(data.run.runId);
    expect(resume.message).toContain("Your note from before the wait: summarize the loss");
    expect(resume.message).toContain("loss=0.12");
    expect(resume.message).toContain("'done'");
    expect(resume.message.length).toBeLessThan(10_000);
    expect(resume.history.map((entry) => entry.content)).toEqual([
      "Train the model and tell me the loss",
      "Started training; it is still running.",
    ]);
    // The connection block is stripped so cli-chat appends exactly one fresh copy.
    expect(resume.appContext).not.toContain("Host-side companion connection");

    // The thread's sidecar holds the wake message, placeholder, and the SN-132 durable pointer.
    const { scopes } = await readCompanionSessions(PAGE_PATH);
    const session = scopes.whole as any;
    expect(session.messages.slice(-2)).toEqual([
      { id: wake.resumeUserMessageId, role: "user", content: resume.message },
      { id: wake.resumeAssistantMessageId, role: "assistant", content: "" },
    ]);
    expect(session.activeTurn).toMatchObject({ turnId: wake.resumeTurnId, assistantMessageId: wake.resumeAssistantMessageId, lastSeq: -1 });
    expect(emitted.map((entry) => entry.status)).toEqual(["pending", "resuming", "resumed"]);
  });

  it("reports an interrupted run in the wake message", async () => {
    const source = host.addTurn(THREAD_A, { status: "running" });
    await runSlow({ cellId: "slow-1", _companionTurnId: source.turnId });
    source.status = "completed";
    fake.finishers.get("train()")!("error");
    await waitFor(async () => (await listCellRunWakes())[0]?.status === "resumed");
    expect(host.started[0].message).toContain("was interrupted");
    expect(host.started[0].message).toContain("JUPYTER_RUN_INTERRUPTED");
  });

  it("owner cancel abandons the wait: no resume turn when the cell later finishes", async () => {
    const source = host.addTurn(THREAD_A);
    await runSlow({ cellId: "slow-1", _companionTurnId: source.turnId });
    source.status = "completed";
    const [wake] = await listCellRunWakes();

    const cancelled = await cancelCellRunWake(wake.wakeId);
    expect(cancelled).toMatchObject({ status: "cancelled", error: null });
    expect(fake.interrupts).toBe(0);

    fake.finishers.get("train()")!();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await __flushCellRunWakesForTesting();
    expect(host.started).toHaveLength(0);
    expect((await listCellRunWakes())[0].status).toBe("cancelled");
    await expect(cancelCellRunWake(wake.wakeId)).rejects.toMatchObject({ code: "WAKE_NOT_PENDING" });
  });

  it("owner cancel with interrupt interrupts the kernel and clears the wake", async () => {
    const source = host.addTurn(THREAD_A);
    await runSlow({ cellId: "slow-1", _companionTurnId: source.turnId });
    source.status = "completed";
    const [wake] = await listCellRunWakes();

    const cancelled = await cancelCellRunWake(wake.wakeId, { interrupt: true });

    expect(fake.interrupts).toBe(1);
    expect(cancelled.status).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(host.started).toHaveLength(0);
  });

  it("enforces the wake timeout and resumes with a timed-out message (no infinite wait)", async () => {
    process.env.SMART_NOTES_JUPYTER_WAKE_TIMEOUT_MS = "1000";
    const source = host.addTurn(THREAD_A);
    await runSlow({ cellId: "slow-1", note: "check results", _companionTurnId: source.turnId });
    source.status = "completed";

    const wake = await waitFor(async () => (await listCellRunWakes()).find((entry) => entry.status === "resumed"), 5_000);

    expect(wake.outcome).toBe("timed_out");
    expect(host.started[0].message).toContain("the wake timed out");
    expect(host.started[0].message).toContain("may still be executing");
    // The kernel keeps running; finishing later starts nothing new.
    fake.finishers.get("train()")!();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(host.started).toHaveLength(1);
  });

  it("parallel companions: a wake on page A neither waits on page B's busy thread nor clears B's wake", async () => {
    const turnA = host.addTurn(THREAD_A);
    const turnB = host.addTurn(THREAD_B, { appContext: `- notePath: ${OTHER_PAGE}` });
    await runSlow({ cellId: "slow-1", _companionTurnId: turnA.turnId });
    await runSlow({ cellId: "slow-2", _companionTurnId: turnB.turnId });
    turnA.status = "completed";
    // A newer, still-running turn on B's thread keeps B busy throughout.
    host.addTurn(THREAD_B);
    const wakes = await listCellRunWakes();
    const wakeA = wakes.find((entry) => entry.threadKey === THREAD_A)!;
    const wakeB = wakes.find((entry) => entry.threadKey === THREAD_B)!;

    fake.finishers.get("train()")!();
    await waitFor(async () => (await listCellRunWakes()).find((entry) => entry.wakeId === wakeA.wakeId)?.status === "resumed");
    expect(host.started.map((turn) => turn.threadKey)).toEqual([THREAD_A]);
    expect((await listCellRunWakes()).find((entry) => entry.wakeId === wakeB.wakeId)?.status).toBe("pending");

    await cancelCellRunWake(wakeB.wakeId);
    expect((await listCellRunWakes()).find((entry) => entry.wakeId === wakeA.wakeId)?.status).toBe("resumed");
  });

  it("falls back to the single running turn on the page when no turn id is forwarded", async () => {
    host.addTurn(THREAD_A);
    const data = await runSlow({ cellId: "slow-1" });
    expect(data.wake).toMatchObject({ status: "pending" });
    expect((await listCellRunWakes())[0].threadKey).toBe(THREAD_A);
  });

  it("registers no wake (and says so) when the calling thread is ambiguous", async () => {
    host.addTurn(THREAD_A);
    host.addTurn(`${PAGE_PATH}::parent_context`);
    const data = await runSlow({ cellId: "slow-1" });
    expect(data.wake).toBeNull();
    expect(data.hint).toMatch(/No auto-resume wake was registered \(several companion turns/);
    expect(await listCellRunWakes()).toHaveLength(0);
  });

  it("resolves a persisted wake whose run was lost to a server restart and still resumes the thread", async () => {
    const source = host.addTurn(THREAD_A);
    await runSlow({ cellId: "slow-1", _companionTurnId: source.turnId });
    source.status = "completed";
    await __flushCellRunWakesForTesting();
    // Simulate a restart: in-memory runs and wakes are gone, the wake file remains.
    __configureCellRunWakesForTesting({ host, pollMs: 10, graceMs: 0, maxIdleWaitMs: 5_000 });
    __resetCellRunsForTesting();

    await listCellRunWakes();
    const wake = await waitFor(async () => (await listCellRunWakes()).find((entry) => entry.status === "resumed"));
    expect(wake.outcome).toBe("lost");
    expect(host.started[0].message).toContain("Smart Notes restarted while waiting");
  });

  it("only parses vault page/section thread keys", () => {
    expect(parseCompanionThreadKey(`${PAGE_PATH}::whole`)).toEqual({ storePath: PAGE_PATH, scopeKey: "whole" });
    expect(parseCompanionThreadKey("Notebook/Section::section")).toEqual({ storePath: "Notebook/Section", scopeKey: "section" });
    expect(parseCompanionThreadKey("dwc_abc::whole")).toBeNull();
    expect(parseCompanionThreadKey("C:/Projects/x::whole")).toBeNull();
    expect(parseCompanionThreadKey("../escape.html::whole")).toBeNull();
    expect(parseCompanionThreadKey("no-separator")).toBeNull();
  });
});
