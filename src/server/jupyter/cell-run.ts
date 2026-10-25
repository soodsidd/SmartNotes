import crypto from "node:crypto";

import { resolveLiveNotebookServer, type LiveNotebookServer } from "@/server/jupyter/runtime";
import { VaultError } from "@/server/vault/errors";
import { readNotebookCellForRun } from "@/server/vault/jupyter-notebook";

// ---------------------------------------------------------------------------
// Companion cell execution — short await (SN-376)
//
// Host-owned execution of one saved code cell on the page's *live* kernel.
// Smart Notes does not run a second notebook runtime: it talks to the same
// Smart Notes–owned Jupyter Server the `/api/jupyter/proxy/<id>/` route fronts
// (loopback + session token, under the proxy base_url), finds the kernel the
// embedded Lab attached to notebook.ipynb, and sends a Jupyter
// `execute_request` over the kernel channels websocket. No Lab UI driving.
//
// The tool blocks for a bounded short-await window (default 45s, clamp
// 1–60s). A run that finishes inside the window returns bounded outputs; a run
// still going at the threshold returns a structured "still running" payload
// (runId + cellId + note) and keeps listening in a process-global run registry
// so the wake/detach story (SN-377) can pick it up. Outputs are reported in the
// tool result only — notebook.ipynb is never written by this path.
// ---------------------------------------------------------------------------

export const CELL_RUN_AWAIT_DEFAULT_MS = 45_000;
export const CELL_RUN_AWAIT_MIN_MS = 1_000;
export const CELL_RUN_AWAIT_MAX_MS = 60_000;

const HTTP_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** After execute_reply or idle arrives, wait this long for the other before finalizing. */
const FINISH_GRACE_MS = 1_500;
/** Detached runs keep listening for outputs this long, then give up (kernel keeps running). */
const RUN_WATCH_MAX_MS = 6 * 60 * 60_000;
const FINISHED_RUN_TTL_MS = 60 * 60_000;
const RUN_REGISTRY_LIMIT = 50;

const STREAM_BUFFER_CHARS = 64_000;
const STREAM_RESULT_CHARS = 4_000;
const RESULT_TEXT_CHARS = 2_000;
const TRACEBACK_CHARS = 3_000;
export const CELL_RUN_NOTE_MAX_CHARS = 2_000;

const RUNS_KEY = "__smartNotesJupyterCellRuns__";

export type CellRunStatus = "queued" | "running" | "completed" | "error" | "interrupted" | "failed";

interface CellRunRecord {
  runId: string;
  pagePath: string;
  index: number;
  cellId: string | null;
  note: string | null;
  kernelId: string;
  msgId: string;
  status: CellRunStatus;
  startedAt: number;
  finishedAt: number | null;
  executionCount: number | null;
  stdout: string;
  stdoutChars: number;
  stderr: string;
  stderrChars: number;
  resultText: string;
  error: { ename: string; evalue: string; traceback: string } | null;
  failure: { code: string; message: string } | null;
  replyStatus: "ok" | "error" | "aborted" | null;
  idle: boolean;
  socket: WebSocketLike | null;
  timers: Set<NodeJS.Timeout>;
  waiters: Set<() => void>;
}

/** Minimal surface of the WHATWG WebSocket we rely on (Node 22 global). */
interface WebSocketLike {
  readyState: number;
  binaryType: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

type WebSocketCtor = new (url: string) => WebSocketLike;

export interface RunJupyterCellInput {
  path: string;
  index?: number;
  cellId?: string;
  note?: string;
  awaitMs?: number;
}

export interface RunJupyterCellDeps {
  WebSocketImpl?: WebSocketCtor;
  resolveServer?: (pagePath: string) => Promise<LiveNotebookServer>;
}

function runs(): Map<string, CellRunRecord> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[RUNS_KEY] instanceof Map)) {
    g[RUNS_KEY] = new Map<string, CellRunRecord>();
  }
  return g[RUNS_KEY] as Map<string, CellRunRecord>;
}

export function clampAwaitMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    const fromEnv = Number(process.env.SMART_NOTES_JUPYTER_RUN_AWAIT_MS);
    return Number.isFinite(fromEnv) && fromEnv > 0
      ? Math.min(Math.max(fromEnv, CELL_RUN_AWAIT_MIN_MS), CELL_RUN_AWAIT_MAX_MS)
      : CELL_RUN_AWAIT_DEFAULT_MS;
  }
  return Math.min(Math.max(Math.round(value), CELL_RUN_AWAIT_MIN_MS), CELL_RUN_AWAIT_MAX_MS);
}

function isTerminal(status: CellRunStatus): boolean {
  return status !== "queued" && status !== "running";
}

// ---------------------------------------------------------------------------
// Output shaping
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function joinText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => (typeof entry === "string" ? entry : String(entry ?? ""))).join("");
  return "";
}

function tail(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(text.length - maxChars), truncated: true };
}

function head(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function textFromBundle(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const bundle = data as Record<string, unknown>;
  const plain = joinText(bundle["text/plain"]);
  if (plain) return plain;
  const mime = Object.keys(bundle).find((key) => key.startsWith("image/")) ?? Object.keys(bundle)[0];
  return mime ? `[${mime} output omitted]` : "";
}

function appendStream(record: CellRunRecord, name: string, text: string): void {
  const clean = stripAnsi(text);
  if (name === "stderr") {
    record.stderr = (record.stderr + clean).slice(-STREAM_BUFFER_CHARS);
    record.stderrChars += clean.length;
  } else {
    record.stdout = (record.stdout + clean).slice(-STREAM_BUFFER_CHARS);
    record.stdoutChars += clean.length;
  }
}

function toPayload(record: CellRunRecord, awaitMs?: number) {
  const now = Date.now();
  const stillRunning = !isTerminal(record.status);
  const stdout = tail(record.stdout, STREAM_RESULT_CHARS);
  const stderr = tail(record.stderr, STREAM_RESULT_CHARS);
  const result = record.resultText ? head(record.resultText, RESULT_TEXT_CHARS) : null;
  const traceback = record.error ? tail(record.error.traceback, TRACEBACK_CHARS) : null;
  return {
    runId: record.runId,
    status: record.status,
    stillRunning,
    pagePath: record.pagePath,
    cell: { index: record.index, cellId: record.cellId },
    note: record.note,
    kernelId: record.kernelId,
    executionCount: record.executionCount,
    startedAt: new Date(record.startedAt).toISOString(),
    finishedAt: record.finishedAt ? new Date(record.finishedAt).toISOString() : null,
    durationMs: (record.finishedAt ?? now) - record.startedAt,
    ...(awaitMs !== undefined ? { awaitMs } : {}),
    stdout: { text: stdout.text, truncated: stdout.truncated || record.stdoutChars > record.stdout.length, totalChars: record.stdoutChars },
    stderr: { text: stderr.text, truncated: stderr.truncated || record.stderrChars > record.stderr.length, totalChars: record.stderrChars },
    result: result ? { text: result.text, truncated: result.truncated } : null,
    error: record.error && traceback
      ? { ename: record.error.ename, evalue: record.error.evalue, traceback: traceback.text, truncated: traceback.truncated }
      : null,
    failure: record.failure,
  };
}

export type JupyterCellRunPayload = ReturnType<typeof toPayload>;

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function addTimer(record: CellRunRecord, ms: number, fn: () => void): void {
  const timer = setTimeout(() => {
    record.timers.delete(timer);
    fn();
  }, ms);
  timer.unref?.();
  record.timers.add(timer);
}

function finish(record: CellRunRecord, status: CellRunStatus, failure?: { code: string; message: string }): void {
  if (isTerminal(record.status)) return;
  record.status = status;
  record.failure = failure ?? null;
  record.finishedAt = Date.now();
  for (const timer of record.timers) clearTimeout(timer);
  record.timers.clear();
  const socket = record.socket;
  record.socket = null;
  try {
    socket?.close();
  } catch {
    // best-effort
  }
  for (const waiter of record.waiters) waiter();
  record.waiters.clear();
}

function finalizeFromReply(record: CellRunRecord): void {
  if (record.replyStatus === "ok") {
    finish(record, "completed");
  } else if (record.replyStatus === "aborted" || record.error?.ename === "KeyboardInterrupt") {
    finish(record, "interrupted", {
      code: "JUPYTER_RUN_INTERRUPTED",
      message: record.replyStatus === "aborted"
        ? "The kernel aborted this execution (an earlier cell failed or the queue was cleared)."
        : "The cell was interrupted (KeyboardInterrupt).",
    });
  } else {
    finish(record, "error");
  }
}

function maybeFinish(record: CellRunRecord): void {
  if (isTerminal(record.status)) return;
  if (record.replyStatus && record.idle) {
    finalizeFromReply(record);
    return;
  }
  if (record.replyStatus || record.idle) {
    // Some kernels reorder shell/iopub; don't hang if the twin message is lost.
    addTimer(record, FINISH_GRACE_MS, () => {
      if (!isTerminal(record.status) && record.replyStatus) finalizeFromReply(record);
      else if (!isTerminal(record.status) && record.idle) {
        record.replyStatus = record.error ? "error" : "ok";
        finalizeFromReply(record);
      }
    });
  }
}

interface JupyterMessage {
  channel?: string;
  msg_type?: string;
  header?: { msg_type?: string };
  parent_header?: { msg_id?: string };
  content?: Record<string, unknown>;
}

function handleMessage(record: CellRunRecord, raw: unknown): void {
  if (typeof raw !== "string" || isTerminal(record.status)) return;
  let msg: JupyterMessage;
  try {
    msg = JSON.parse(raw) as JupyterMessage;
  } catch {
    return;
  }
  const type = msg.msg_type ?? msg.header?.msg_type;
  const content = msg.content ?? {};

  if (msg.channel === "iopub" && type === "status") {
    const state = content.execution_state;
    if (state === "dead") {
      finish(record, "failed", { code: "JUPYTER_KERNEL_DEAD", message: "The kernel died while the cell was running. Restart the kernel in the Jupyter page, then retry." });
      return;
    }
    if (state === "restarting") {
      finish(record, "interrupted", { code: "JUPYTER_RUN_INTERRUPTED", message: "The kernel restarted while the cell was running; the run's state was lost." });
      return;
    }
  }

  if (msg.parent_header?.msg_id !== record.msgId) return;

  if (msg.channel === "shell" && type === "execute_reply") {
    const status = content.status;
    record.replyStatus = status === "ok" || status === "aborted" ? status : "error";
    if (typeof content.execution_count === "number") record.executionCount = content.execution_count;
    if (record.replyStatus === "error" && !record.error) {
      record.error = {
        ename: String(content.ename ?? "Error"),
        evalue: String(content.evalue ?? ""),
        traceback: stripAnsi(joinText(Array.isArray(content.traceback) ? (content.traceback as unknown[]).join("\n") : "")),
      };
    }
    maybeFinish(record);
    return;
  }

  if (msg.channel !== "iopub") return;
  switch (type) {
    case "status":
      if (content.execution_state === "busy" && record.status === "queued") record.status = "running";
      if (content.execution_state === "idle") {
        record.idle = true;
        maybeFinish(record);
      }
      break;
    case "execute_input":
      if (typeof content.execution_count === "number") record.executionCount = content.execution_count;
      if (record.status === "queued") record.status = "running";
      break;
    case "stream":
      appendStream(record, String(content.name ?? "stdout"), joinText(content.text));
      break;
    case "execute_result":
    case "display_data": {
      const text = stripAnsi(textFromBundle(content.data));
      if (text) record.resultText = record.resultText ? `${record.resultText}\n${text}`.slice(-STREAM_BUFFER_CHARS) : text;
      if (typeof content.execution_count === "number") record.executionCount = content.execution_count;
      break;
    }
    case "clear_output":
      record.stdout = "";
      record.stderr = "";
      record.resultText = "";
      break;
    case "error":
      record.error = {
        ename: String(content.ename ?? "Error"),
        evalue: String(content.evalue ?? ""),
        traceback: stripAnsi((Array.isArray(content.traceback) ? content.traceback : []).map(String).join("\n")),
      };
      break;
    default:
      break;
  }
}

function pruneRuns(): void {
  const registry = runs();
  const now = Date.now();
  for (const [id, record] of registry) {
    if (record.finishedAt && now - record.finishedAt > FINISHED_RUN_TTL_MS) registry.delete(id);
  }
  if (registry.size < RUN_REGISTRY_LIMIT) return;
  const finished = [...registry.values()]
    .filter((record) => record.finishedAt)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  while (registry.size >= RUN_REGISTRY_LIMIT && finished.length) {
    registry.delete(finished.shift()!.runId);
  }
}

// ---------------------------------------------------------------------------
// Jupyter Server REST + channels
// ---------------------------------------------------------------------------

function normalizeSessionPath(value: unknown): string {
  return typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\/+/, "") : "";
}

async function findNotebookKernel(server: LiveNotebookServer): Promise<string> {
  const url = `${server.baseUrl}${server.basePath}api/sessions?token=${encodeURIComponent(server.token)}`;
  let sessions: unknown;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    sessions = await response.json();
  } catch (error) {
    throw new VaultError(
      "JUPYTER_SESSION_UNAVAILABLE",
      `Could not list kernels on the page's Jupyter server (${(error as Error).message}). Reopen the Jupyter page, then retry.`,
      409
    );
  }
  const target = normalizeSessionPath(server.notebookFile);
  const match = Array.isArray(sessions)
    ? (sessions as Array<Record<string, unknown>>).find((entry) => {
        const notebook = entry.notebook as Record<string, unknown> | undefined;
        return normalizeSessionPath(entry.path ?? notebook?.path) === target;
      })
    : undefined;
  const kernel = match?.kernel as Record<string, unknown> | undefined;
  if (!kernel || typeof kernel.id !== "string") {
    throw new VaultError(
      "JUPYTER_KERNEL_UNAVAILABLE",
      `No kernel is attached to ${server.notebookFile}. Open the notebook in the Jupyter page (and select a kernel if prompted), then retry.`,
      409
    );
  }
  if (kernel.execution_state === "dead") {
    throw new VaultError(
      "JUPYTER_KERNEL_DEAD",
      "The notebook's kernel is dead. Restart the kernel in the Jupyter page, then retry.",
      409
    );
  }
  return kernel.id;
}

function openChannels(server: LiveNotebookServer, kernelId: string, clientSession: string, WebSocketImpl: WebSocketCtor): Promise<WebSocketLike> {
  const wsBase = server.baseUrl.replace(/^http/i, "ws");
  const url = `${wsBase}${server.basePath}api/kernels/${encodeURIComponent(kernelId)}/channels?session_id=${encodeURIComponent(clientSession)}&token=${encodeURIComponent(server.token)}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket: WebSocketLike;
    try {
      socket = new WebSocketImpl(url);
    } catch (error) {
      reject(new VaultError("JUPYTER_RUN_FAILED", `Could not connect to the kernel: ${(error as Error).message}`, 502));
      return;
    }
    socket.binaryType = "arraybuffer";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* best-effort */ }
      reject(new VaultError("JUPYTER_RUN_FAILED", "Timed out connecting to the kernel channels. Reopen the Jupyter page, then retry.", 504));
    }, CONNECT_TIMEOUT_MS);
    timer.unref?.();
    socket.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new VaultError("JUPYTER_RUN_FAILED", "The kernel channels connection was refused. Reopen the Jupyter page or restart the kernel, then retry.", 502));
    };
    socket.addEventListener("error", fail);
    socket.addEventListener("close", fail);
  });
}

function executeRequest(msgId: string, clientSession: string, code: string): string {
  return JSON.stringify({
    header: {
      msg_id: msgId,
      msg_type: "execute_request",
      username: "smart-notes-companion",
      session: clientSession,
      date: new Date().toISOString(),
      version: "5.3",
    },
    parent_header: {},
    metadata: {},
    content: {
      code,
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true,
    },
    buffers: [],
    channel: "shell",
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function stillRunningHint(payload: JupyterCellRunPayload, awaitMs: number): string {
  return [
    `Cell is still ${payload.status} after ${Math.round(awaitMs / 1000)}s; the kernel keeps executing it.`,
    `Do not re-run this cell. Report runId ${payload.runId} (cellId ${payload.cell.cellId ?? "none"}) to the owner;`,
    "wake/auto-resume for long runs is handled separately (SN-377).",
  ].join(" ");
}

/**
 * Execute one saved code cell on the page's live kernel and block for at most
 * the short-await window. Throws actionable VaultErrors for missing/dead
 * sessions, interrupted runs, and lost connections.
 */
export async function runJupyterCell(input: RunJupyterCellInput, deps: RunJupyterCellDeps = {}) {
  const awaitMs = clampAwaitMs(input.awaitMs);
  const note = typeof input.note === "string" && input.note.trim()
    ? input.note.trim().slice(0, CELL_RUN_NOTE_MAX_CHARS)
    : null;

  const cell = await readNotebookCellForRun({ path: input.path, index: input.index, cellId: input.cellId });

  for (const existing of runs().values()) {
    if (
      !isTerminal(existing.status) &&
      existing.pagePath === cell.path &&
      (existing.cellId && cell.cellId ? existing.cellId === cell.cellId : existing.index === cell.index)
    ) {
      throw new VaultError(
        "JUPYTER_RUN_IN_PROGRESS",
        `Cell ${cell.index} is already running as runId ${existing.runId} (started ${new Date(existing.startedAt).toISOString()}). Wait for it instead of re-running.`,
        409
      );
    }
  }

  const server = await (deps.resolveServer ?? resolveLiveNotebookServer)(cell.path);
  const kernelId = await findNotebookKernel(server);
  const WebSocketImpl = deps.WebSocketImpl ?? ((globalThis as Record<string, unknown>).WebSocket as WebSocketCtor | undefined);
  if (!WebSocketImpl) {
    throw new VaultError("JUPYTER_RUN_FAILED", "This server runtime has no WebSocket client (Node 22+ required).", 500);
  }

  const clientSession = crypto.randomUUID();
  const socket = await openChannels(server, kernelId, clientSession, WebSocketImpl);

  pruneRuns();
  const record: CellRunRecord = {
    runId: `run-${crypto.randomUUID()}`,
    pagePath: cell.path,
    index: cell.index,
    cellId: cell.cellId,
    note,
    kernelId,
    msgId: crypto.randomUUID(),
    status: "queued",
    startedAt: Date.now(),
    finishedAt: null,
    executionCount: null,
    stdout: "",
    stdoutChars: 0,
    stderr: "",
    stderrChars: 0,
    resultText: "",
    error: null,
    failure: null,
    replyStatus: null,
    idle: false,
    socket,
    timers: new Set(),
    waiters: new Set(),
  };
  runs().set(record.runId, record);

  socket.addEventListener("message", (event) => handleMessage(record, event.data));
  const lost = () =>
    finish(record, "failed", {
      code: "JUPYTER_RUN_DISCONNECTED",
      message: "Lost the kernel connection before the cell finished (kernel shut down/restarted or the Jupyter server stopped).",
    });
  socket.addEventListener("close", lost);
  socket.addEventListener("error", lost);
  addTimer(record, RUN_WATCH_MAX_MS, () =>
    finish(record, "failed", {
      code: "JUPYTER_RUN_WATCH_EXPIRED",
      message: "Stopped watching this run after the maximum watch window; the kernel may still be executing it.",
    })
  );

  try {
    socket.send(executeRequest(record.msgId, clientSession, cell.source));
  } catch (error) {
    finish(record, "failed", { code: "JUPYTER_RUN_FAILED", message: `Could not send the execute request: ${(error as Error).message}` });
  }

  if (!isTerminal(record.status)) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        record.waiters.delete(done);
        resolve();
      }, awaitMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      record.waiters.add(done);
    });
  }

  const payload = toPayload(record, awaitMs);
  if (record.status === "interrupted" || record.status === "failed") {
    const failure = record.failure ?? { code: "JUPYTER_RUN_FAILED", message: "The cell run failed." };
    const partial = payload.stdout.text ? ` Partial stdout tail: ${tail(payload.stdout.text, 300).text}` : "";
    throw new VaultError(
      failure.code,
      `${failure.message} (runId ${record.runId}, cell ${record.index}, after ${(payload.durationMs / 1000).toFixed(1)}s).${partial}`,
      409
    );
  }

  if (payload.stillRunning) {
    return {
      run: payload,
      handoff: {
        runId: payload.runId,
        cellId: payload.cell.cellId,
        index: payload.cell.index,
        pagePath: payload.pagePath,
        kernelId: payload.kernelId,
        note: payload.note,
      },
      hint: stillRunningHint(payload, awaitMs),
    };
  }

  return {
    run: payload,
    hint:
      payload.status === "error"
        ? "The cell raised an exception on the live kernel; see run.error. Outputs are reported here only — notebook.ipynb was not modified."
        : "Cell finished on the live kernel. Outputs are reported here only — notebook.ipynb was not modified; the open Lab view does not render them.",
  };
}

/** Look up a run (live or recently finished) — the hook SN-377 builds on. */
export function getJupyterCellRun(runId: string): JupyterCellRunPayload | null {
  const record = runs().get(runId);
  return record ? toPayload(record) : null;
}

/** Test hook: abandon all runs and clear the registry. */
export function __resetCellRunsForTesting(): void {
  for (const record of runs().values()) {
    finish(record, "failed", { code: "JUPYTER_RUN_FAILED", message: "reset" });
  }
  runs().clear();
}
