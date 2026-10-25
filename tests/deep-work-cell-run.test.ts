import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";

import { POST as notebookPost } from "@/app/api/workspace/notebook/route";
import { __resetCellRunsForTesting } from "@/server/jupyter/cell-run";
import {
  __configureCellRunWakesForTesting,
  __flushCellRunWakesForTesting,
  cancelCellRunWake,
  listCellRunWakes,
  type CompanionTurnInfo,
  type CompanionWakeHost,
} from "@/server/jupyter/cell-run-wake";
import { issueWorkspaceCapability, resetWorkspaceCapabilitiesForTesting } from "@/server/jupyter/workspace-capability";
import { __resetForTesting } from "@/server/jupyter/runtime";
import { readWorkspaceCompanion, writeWorkspaceCompanion } from "@/server/jupyter/workspace-state";
import { resolveProjectWorkspace } from "@/server/jupyter/workspace-root";

const BASE = "/api/jupyter/proxy/project-test/";
const TOKEN = "project-token";
const KERNEL = "project-kernel";
const NOTEBOOK = {
  cells: [
    { id: "quick", cell_type: "code", source: ["print('quick')"], outputs: [], metadata: {}, execution_count: null },
    { id: "slow", cell_type: "code", source: ["train()"], outputs: [], metadata: {}, execution_count: null },
  ],
  metadata: {}, nbformat: 4, nbformat_minor: 5,
};

function reply(request: any, channel: string, type: string, content: Record<string, unknown>) {
  return { channel, msg_type: type, header: { msg_type: type }, parent_header: request.header, content };
}

async function fakeJupyter() {
  const sockets = new Set<ServerSocket>();
  const executions: string[] = [];
  const finishers = new Map<string, () => void>();
  let interrupts = 0;
  const server = http.createServer((req, res) => {
    res.setHeader("Connection", "close");
    const url = new URL(req.url ?? "/", "http://x");
    if (url.searchParams.get("token") !== TOKEN) return void res.writeHead(403).end();
    if (url.pathname === `${BASE}api/status`) return void res.end("{}");
    if (url.pathname === `${BASE}api/sessions`) {
      res.setHeader("Content-Type", "application/json");
      return void res.end(JSON.stringify([{ path: "analysis.ipynb", kernel: { id: KERNEL, execution_state: "idle" } }]));
    }
    if (url.pathname === `${BASE}api/kernels/${KERNEL}/interrupt` && req.method === "POST") {
      interrupts += 1;
      return void res.writeHead(204).end();
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== `${BASE}api/kernels/${KERNEL}/channels` || url.searchParams.get("token") !== TOKEN) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
      ws.on("message", (bytes) => {
        const request = JSON.parse(String(bytes));
        const source = request.content.code as string;
        executions.push(source);
        const send = (channel: string, type: string, content: Record<string, unknown>) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(reply(request, channel, type, content)));
        };
        send("iopub", "status", { execution_state: "busy" });
        const finish = () => {
          send("iopub", "stream", { name: "stdout", text: `${source} done\n` });
          send("shell", "execute_reply", { status: "ok", execution_count: 1 });
          send("iopub", "status", { execution_state: "idle" });
        };
        if (source === "train()") finishers.set(source, finish);
        else finish();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    executions,
    finishers,
    get interrupts() { return interrupts; },
    async close() {
      for (const socket of sockets) socket.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, timeout = 5_000): Promise<T> {
  const until = Date.now() + timeout;
  for (;;) {
    const result = await probe();
    if (result) return result;
    if (Date.now() > until) throw new Error("timed out waiting for cell wake");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("SN-378 Deep Work notebook execution", () => {
  let root: string;
  let state: string;
  let capability: string;
  let source: CompanionTurnInfo;
  let fake: Awaited<ReturnType<typeof fakeJupyter>>;
  let host: CompanionWakeHost & { started: Array<Parameters<CompanionWakeHost["startHostTurn"]>[0]> };
  const previousEnv = { ...process.env };

  async function post(pathname: string, cellId = "quick", extra: Record<string, unknown> = {}) {
    const response = await notebookPost(new Request("http://localhost/api/workspace/notebook", {
      method: "POST",
      body: JSON.stringify({ workspace: capability, path: pathname, operation: "cell_run", cellId, turnId: source.turnId, awaitSeconds: 1, ...extra }),
    }));
    return { status: response.status, body: await response.json() as any };
  }

  beforeEach(async () => {
    resetWorkspaceCapabilitiesForTesting();
    __resetForTesting();
    __resetCellRunsForTesting();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sn378-project-"));
    state = await fs.mkdtemp(path.join(os.tmpdir(), "sn378-state-"));
    process.env.SMART_NOTES_STATE_DIR = state;
    await fs.writeFile(path.join(root, "analysis.ipynb"), JSON.stringify(NOTEBOOK), "utf8");
    await fs.writeFile(path.join(root, "plain.py"), "print('plain')", "utf8");
    const request = { rootPath: root, requestedAccess: "editable" as const, branch: "av/sn-378" };
    const resolved = await resolveProjectWorkspace(request);
    capability = issueWorkspaceCapability(request, resolved).capability;
    fake = await fakeJupyter();
    const registry = (globalThis as Record<string, unknown>).__smartNotesJupyterSessions__ as Map<string, unknown>;
    registry.set(resolved.key, {
      key: resolved.key, kind: "project", pagePath: root, folder: root,
      proxyBasePath: BASE, token: TOKEN, baseUrl: fake.baseUrl,
      status: "ready", frameOrigins: [], startedAt: new Date().toISOString(),
    });
    source = {
      turnId: crypto.randomUUID(), status: "running", threadKey: `${capability}::whole`, provider: "codex", model: "test",
      appContext: `Smart Notes Deep Work operating context:\n- workspaceCapability: ${capability}\n- Active repository-relative file: analysis.ipynb\n- Deep Work notebook run: enabled.\n- companionTurnId: PLACEHOLDER\n\nHost-side Deep Work connection (server-authoritative):`,
      pageContext: "notebook context",
    };
    source.appContext = source.appContext.replace("PLACEHOLDER", source.turnId);
    const turns = new Map([[source.turnId, source]]);
    const started: Array<Parameters<CompanionWakeHost["startHostTurn"]>[0]> = [];
    host = {
      started,
      getTurn: (id) => turns.get(id) ?? null,
      listRunningTurns: () => [...turns.values()].filter((turn) => turn.status === "running"),
      isThreadBusy: (key) => [...turns.values()].some((turn) => turn.threadKey === key && turn.status === "running"),
      async startHostTurn(input) {
        started.push(input);
        return { ok: true, turnId: input.turnId };
      },
    };
    (globalThis as Record<string, unknown>)._smartNotesCompanionHost = host;
    __configureCellRunWakesForTesting({ host, pollMs: 10, graceMs: 0, maxIdleWaitMs: 5_000 });
  });

  afterEach(async () => {
    await __flushCellRunWakesForTesting();
    __configureCellRunWakesForTesting(null);
    __resetCellRunsForTesting();
    __resetForTesting();
    resetWorkspaceCapabilitiesForTesting();
    delete (globalThis as Record<string, unknown>)._smartNotesCompanionHost;
    await fake.close();
    process.env = { ...previousEnv };
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  });

  it("returns bounded outputs for the active notebook without writing the file or using a vault page", async () => {
    const before = await fs.readFile(path.join(root, "analysis.ipynb"), "utf8");
    const result = await post("analysis.ipynb");
    expect(result.status).toBe(200);
    expect(result.body.result.run).toMatchObject({ status: "completed", stillRunning: false, stdout: { text: "print('quick') done\n" } });
    expect(result.body.result.handoff).toBeUndefined();
    expect(fake.executions).toEqual(["print('quick')"]);
    expect(await fs.readFile(path.join(root, "analysis.ipynb"), "utf8")).toBe(before);
  });

  it("keeps non-notebook turns and other project paths fenced", async () => {
    source.appContext = source.appContext.replace("- Deep Work notebook run: enabled.", "- Notebook run unavailable.");
    expect((await post("analysis.ipynb")).body.code).toBe("WORKSPACE_NOTEBOOK_RUN_UNAVAILABLE");
    source.appContext += "\n- Deep Work notebook run: enabled.";
    expect((await post("plain.py")).body.code).toBe("WORKSPACE_NOTEBOOK_RUN_UNAVAILABLE");
    expect(fake.executions).toHaveLength(0);
  });

  it("rejects cell execution from a read-only Deep Work capability", async () => {
    const request = { rootPath: root, requestedAccess: "read-only" as const, branch: "av/sn-378" };
    capability = issueWorkspaceCapability(request, await resolveProjectWorkspace(request)).capability;
    source.threadKey = `${capability}::whole`;
    source.appContext = `Smart Notes Deep Work operating context:\n- workspaceCapability: ${capability}\n- Active repository-relative file: analysis.ipynb\n- Deep Work notebook run: enabled.\n- companionTurnId: ${source.turnId}`;
    const result = await post("analysis.ipynb");
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("WORKSPACE_READ_ONLY");
    expect(fake.executions).toHaveLength(0);
  });

  it("parks a durable wake on the Deep Work thread and resumes it with outputs and note", async () => {
    await writeWorkspaceCompanion({ rootPath: root, requestedAccess: "editable", branch: "av/sn-378" }, {
      whole: { messages: [{ id: "u1", role: "user", content: "Run the model" }] },
    });
    const result = await post("analysis.ipynb", "slow", { note: "summarize the model" });
    expect(result.body.result.run.stillRunning).toBe(true);
    expect(result.body.result.handoff.runId).toMatch(/^run-/);
    expect(result.body.result.wake).toMatchObject({ status: "pending", wakeId: expect.stringMatching(/^wake-/) });
    expect((await listCellRunWakes())[0]).toMatchObject({ storePath: capability, threadKey: `${capability}::whole` });
    fake.finishers.get("train()")!();
    source.status = "completed";
    await waitFor(async () => (await listCellRunWakes()).find((wake) => wake.status === "resumed"));
    expect(host.started).toHaveLength(1);
    expect(host.started[0]).toMatchObject({ threadKey: `${capability}::whole`, provider: "codex" });
    expect(host.started[0].message).toContain("train() done");
    expect(host.started[0].message).toContain("summarize the model");
    const sessions = await readWorkspaceCompanion({ rootPath: root, requestedAccess: "editable", branch: "av/sn-378" });
    expect((sessions.scopes.whole as any).activeTurn.turnId).toBe(host.started[0].turnId);
  });

  it("cancels a detached Deep Work wake without resuming its thread", async () => {
    await post("analysis.ipynb", "slow");
    const [wake] = await listCellRunWakes();
    expect((await cancelCellRunWake(wake.wakeId, { interrupt: true })).status).toBe("cancelled");
    expect(fake.interrupts).toBe(1);
    fake.finishers.get("train()")!();
    source.status = "completed";
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(host.started).toHaveLength(0);
  });

  it("times out a slow Deep Work cell and resumes with a do-not-rerun warning", async () => {
    process.env.SMART_NOTES_JUPYTER_WAKE_TIMEOUT_MS = "1000";
    const result = await post("analysis.ipynb", "slow");
    expect(result.body.result.wake?.status).toBe("pending");
    source.status = "completed";
    const wake = await waitFor(async () => (await listCellRunWakes()).find((entry) => entry.status === "resumed"));
    expect(wake.outcome).toBe("timed_out");
    expect(host.started[0].message).toContain("may still be executing");
    expect(fake.executions).toEqual(["train()"]);
  });
});
