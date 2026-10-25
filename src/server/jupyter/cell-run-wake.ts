import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { getAppStateDir } from "@/server/app-state";
import {
  interruptJupyterCellRun,
  onJupyterCellRunSettled,
  type JupyterCellRunPayload,
  type RunJupyterCellDeps,
} from "@/server/jupyter/cell-run";
import { getVaultRoot } from "@/server/vault/config";
import { VaultError } from "@/server/vault/errors";
import { readCompanionSessions, saveCompanionSessions } from "@/server/vault/pages";
import { workspaceRequestFromValue } from "@/server/jupyter/workspace-request";
import { readWorkspaceCompanion, writeWorkspaceCompanion } from "@/server/jupyter/workspace-state";

// ---------------------------------------------------------------------------
// Companion Jupyter cell-run wake — detach → wait → resume (SN-377)
//
// When `jupyter_cell_run` (SN-376) hands off a still-running cell, the host
// parks a durable wake on the companion thread that started it, tells the
// provider to end its turn, and watches the run in the SN-376 run registry.
// When the run settles (completed / error / interrupted / failed), the wake
// times out, or the server restarted and lost the run, the host appends a
// bounded wake message to that thread's companion sidecar, writes the SN-132
// durable `activeTurn` pointer, and starts a new server-owned turn on the
// same `thread_key` through cli-chat. Browsers reattach to it through the
// normal durable-turn path; nothing here depends on a page being open.
// ---------------------------------------------------------------------------

export const WAKE_TIMEOUT_DEFAULT_MS = 30 * 60_000;
export const WAKE_TIMEOUT_MIN_MS = 60_000;
export const WAKE_TIMEOUT_MAX_MS = 6 * 60 * 60_000;

/** Bounded slices of the run that go into the wake message. */
const WAKE_STDOUT_CHARS = 2_000;
const WAKE_STDERR_CHARS = 1_000;
const WAKE_RESULT_CHARS = 1_000;
const WAKE_TRACEBACK_CHARS = 2_000;
const WAKE_HISTORY_MESSAGES = 6;
const WAKE_HISTORY_CHARS = 1_200;
const COMPANION_MAX_MESSAGES = 50;

/** Waiting for the thread to go idle before resuming (never supersede a live turn). */
const THREAD_IDLE_POLL_MS = 1_000;
const THREAD_IDLE_MAX_WAIT_MS = 30 * 60_000;
/** After the thread goes idle, let the browser's terminal transcript save land first. */
const THREAD_IDLE_GRACE_MS = 2_500;

const FINISHED_WAKE_TTL_MS = 60 * 60_000;
const WAKE_STORE_LIMIT = 100;
const STATE_KEY = "__smartNotesJupyterCellWakes__";
const HOST_KEY = "_smartNotesCompanionHost";
const WAKE_FILE_PREFIX = "jupyter-cell-wakes";

export type CellWakeStatus = "pending" | "resuming" | "resumed" | "cancelled" | "failed";
export type CellWakeOutcome = "completed" | "error" | "interrupted" | "failed" | "timed_out" | "lost";

/** The cli-chat surface server.js exposes as `global._smartNotesCompanionHost`. */
export interface CompanionTurnInfo {
  turnId: string;
  status: string;
  threadKey: string;
  provider: string;
  model: string;
  appContext: string;
  pageContext: string;
}

export interface CompanionWakeHost {
  getTurn(turnId: string): CompanionTurnInfo | null;
  listRunningTurns(): CompanionTurnInfo[];
  isThreadBusy(threadKey: string): boolean;
  startHostTurn(input: {
    turnId: string;
    threadKey: string;
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    provider: string;
    model: string;
    appContext: string;
    pageContext: string;
  }): Promise<{ ok: boolean; turnId?: string; error?: string }>;
}

interface CellWakeRecord {
  wakeId: string;
  runId: string;
  pagePath: string;
  cellId: string | null;
  index: number;
  kernelId: string;
  note: string | null;
  runStartedAt: string;
  registeredAt: number;
  timeoutAt: number;
  threadKey: string;
  storePath: string;
  scopeKey: string;
  sourceTurnId: string;
  provider: string;
  model: string;
  appContext: string;
  pageContext: string;
  status: CellWakeStatus;
  outcome: CellWakeOutcome | null;
  settledAt: number | null;
  resumeTurnId: string | null;
  resumeUserMessageId: string | null;
  resumeAssistantMessageId: string | null;
  error: string | null;
}

/** Client-safe projection (no provider context blobs). */
export interface CellWakeView {
  wakeId: string;
  runId: string;
  pagePath: string;
  cellId: string | null;
  index: number;
  note: string | null;
  status: CellWakeStatus;
  outcome: CellWakeOutcome | null;
  threadKey: string;
  storePath: string;
  scopeKey: string;
  sourceTurnId: string;
  runStartedAt: string;
  registeredAt: string;
  timeoutAt: string;
  settledAt: string | null;
  resumeTurnId: string | null;
  resumeUserMessageId: string | null;
  resumeAssistantMessageId: string | null;
  error: string | null;
}

interface WakeConfig {
  host: CompanionWakeHost | null;
  pollMs: number;
  graceMs: number;
  maxIdleWaitMs: number;
  resolveServer?: RunJupyterCellDeps["resolveServer"];
}

interface WakeState {
  loaded: Promise<void> | null;
  wakes: Map<string, CellWakeRecord>;
  timers: Map<string, NodeJS.Timeout>;
  unsubscribers: Map<string, () => void>;
  settling: Map<string, Promise<void>>;
  config: Partial<WakeConfig>;
  writeChain: Promise<void>;
}

function state(): WakeState {
  const g = globalThis as Record<string, unknown>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      loaded: null,
      wakes: new Map(),
      timers: new Map(),
      unsubscribers: new Map(),
      settling: new Map(),
      config: {},
      writeChain: Promise.resolve(),
    } satisfies WakeState;
  }
  return g[STATE_KEY] as WakeState;
}

function config(): WakeConfig {
  const overrides = state().config;
  const globalHost = (globalThis as Record<string, unknown>)[HOST_KEY] as CompanionWakeHost | undefined;
  return {
    host: overrides.host !== undefined ? overrides.host : globalHost ?? null,
    pollMs: overrides.pollMs ?? THREAD_IDLE_POLL_MS,
    graceMs: overrides.graceMs ?? THREAD_IDLE_GRACE_MS,
    maxIdleWaitMs: overrides.maxIdleWaitMs ?? THREAD_IDLE_MAX_WAIT_MS,
    resolveServer: overrides.resolveServer,
  };
}

export function clampWakeTimeoutMs(minutes: unknown): number {
  if (typeof minutes === "number" && Number.isFinite(minutes)) {
    return Math.min(Math.max(Math.round(minutes * 60_000), WAKE_TIMEOUT_MIN_MS), WAKE_TIMEOUT_MAX_MS);
  }
  const fromEnv = Number(process.env.SMART_NOTES_JUPYTER_WAKE_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? Math.min(Math.max(fromEnv, 1_000), WAKE_TIMEOUT_MAX_MS)
    : WAKE_TIMEOUT_DEFAULT_MS;
}

function isOpen(status: CellWakeStatus): boolean {
  return status === "pending" || status === "resuming";
}

function toView(record: CellWakeRecord): CellWakeView {
  return {
    wakeId: record.wakeId,
    runId: record.runId,
    pagePath: record.pagePath,
    cellId: record.cellId,
    index: record.index,
    note: record.note,
    status: record.status,
    outcome: record.outcome,
    threadKey: record.threadKey,
    storePath: record.storePath,
    scopeKey: record.scopeKey,
    sourceTurnId: record.sourceTurnId,
    runStartedAt: record.runStartedAt,
    registeredAt: new Date(record.registeredAt).toISOString(),
    timeoutAt: new Date(record.timeoutAt).toISOString(),
    settledAt: record.settledAt ? new Date(record.settledAt).toISOString() : null,
    resumeTurnId: record.resumeTurnId,
    resumeUserMessageId: record.resumeUserMessageId,
    resumeAssistantMessageId: record.resumeAssistantMessageId,
    error: record.error,
  };
}

/** Parse a cli-chat `thread_key` (`<storePath>::<scopeKey>`, SN-322). */
export function parseCompanionThreadKey(threadKey: string): { storePath: string; scopeKey: string } | null {
  const split = threadKey.lastIndexOf("::");
  if (split <= 0) return null;
  const storePath = threadKey.slice(0, split).replace(/\\/g, "/");
  const scopeKey = threadKey.slice(split + 2);
  if (!storePath || !scopeKey) return null;
  // Deep Work stores use an opaque issued capability. Never treat an absolute
  // disk root or a malformed capability as a vault path.
  if (/^dwc_[A-Za-z0-9_-]{43}$/.test(storePath)) return { storePath, scopeKey };
  if (
    /^[A-Za-z]:/.test(storePath) ||
    storePath.startsWith("/") ||
    storePath.startsWith("dwc_") ||
    storePath.split("/").includes("..")
  ) {
    return null;
  }
  return { storePath, scopeKey };
}

async function readThreadSessions(storePath: string): Promise<{ scopes: Record<string, unknown> }> {
  return storePath.startsWith("dwc_")
    ? readWorkspaceCompanion(workspaceRequestFromValue(storePath))
    : readCompanionSessions(storePath);
}

async function saveThreadSessions(storePath: string, scopes: Record<string, unknown>): Promise<void> {
  if (storePath.startsWith("dwc_")) {
    await writeWorkspaceCompanion(workspaceRequestFromValue(storePath), scopes);
  } else {
    await saveCompanionSessions(storePath, scopes);
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * One wake file per Smart Notes instance. Production and worktree previews
 * share the chat state dir, and a run only lives in the process that started
 * it, so instances must never load (and "lose") each other's wakes. The key is
 * vault root + bound listen port: stable across restarts of the same instance.
 */
export function cellWakeFileName(vaultRoot: string, port: unknown): string {
  const key = crypto.createHash("sha256").update(`${path.resolve(vaultRoot).toLowerCase()}|${String(port ?? "")}`).digest("hex").slice(0, 16);
  return `${WAKE_FILE_PREFIX}-${key}.json`;
}

function wakeFilePath(): string {
  const port = (globalThis as Record<string, unknown>)._smartNotesListenPort;
  return path.join(getAppStateDir(), cellWakeFileName(getVaultRoot(), port));
}

function prune(): void {
  const wakes = state().wakes;
  const now = Date.now();
  for (const [id, record] of wakes) {
    if (!isOpen(record.status) && record.settledAt && now - record.settledAt > FINISHED_WAKE_TTL_MS) wakes.delete(id);
  }
  if (wakes.size <= WAKE_STORE_LIMIT) return;
  const finished = [...wakes.values()].filter((record) => !isOpen(record.status)).sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
  while (wakes.size > WAKE_STORE_LIMIT && finished.length) wakes.delete(finished.shift()!.wakeId);
}

function persist(): Promise<void> {
  const s = state();
  prune();
  const snapshot = JSON.stringify({ version: 1, wakes: [...s.wakes.values()] });
  s.writeChain = s.writeChain
    .catch(() => undefined)
    .then(async () => {
      const file = wakeFilePath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temp, snapshot, "utf8");
      await fs.rename(temp, file);
    })
    .catch((error) => {
      console.warn("[smart-notes] could not persist Jupyter cell wakes:", error);
    });
  return s.writeChain;
}

function emit(record: CellWakeRecord): void {
  try {
    const io = (globalThis as Record<string, unknown>)._smartNotesIo as { emit?: (event: string, data: unknown) => void } | undefined;
    io?.emit?.("companion_cell_wake", toView(record));
  } catch {
    // Non-fatal: clients also list wakes on mount.
  }
}

function update(record: CellWakeRecord, patch: Partial<CellWakeRecord>): Promise<void> {
  Object.assign(record, patch);
  emit(record);
  return persist();
}

function clearWatch(wakeId: string): void {
  const s = state();
  const timer = s.timers.get(wakeId);
  if (timer) clearTimeout(timer);
  s.timers.delete(wakeId);
  s.unsubscribers.get(wakeId)?.();
  s.unsubscribers.delete(wakeId);
}

/** Load persisted wakes once per process; re-arm open wakes (a lost run resolves as `lost`). */
function ensureLoaded(): Promise<void> {
  const s = state();
  if (!s.loaded) {
    s.loaded = (async () => {
      let raw: string;
      try {
        raw = await fs.readFile(wakeFilePath(), "utf8");
      } catch {
        return;
      }
      let parsed: { wakes?: CellWakeRecord[] };
      try {
        parsed = JSON.parse(raw) as { wakes?: CellWakeRecord[] };
      } catch {
        return;
      }
      for (const record of Array.isArray(parsed.wakes) ? parsed.wakes : []) {
        if (!record || typeof record.wakeId !== "string" || s.wakes.has(record.wakeId)) continue;
        s.wakes.set(record.wakeId, record);
      }
      for (const record of s.wakes.values()) {
        if (record.status === "pending") arm(record);
        else if (record.status === "resuming") void settleWake(record.wakeId, record.outcome ?? "lost", null, { force: true });
      }
    })();
  }
  return s.loaded;
}

// ---------------------------------------------------------------------------
// Wake message
// ---------------------------------------------------------------------------

function tailText(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function fence(label: string, text: string, totalChars: number, max: number, mode: "head" | "tail" = "tail"): string[] {
  if (!text) return [];
  const clipped = text.length > max ? (mode === "tail" ? tailText(text, max) : text.slice(0, max)) : text;
  const shownNote = totalChars > clipped.length ? ` (${mode === "tail" ? "last" : "first"} ${clipped.length} of ${totalChars} chars)` : "";
  return ["", `${label}${shownNote}:`, "```text", clipped.replace(/```/g, "``​`"), "```"];
}

const OUTCOME_LABEL: Record<CellWakeOutcome, string> = {
  completed: "finished successfully",
  error: "raised an exception",
  interrupted: "was interrupted",
  failed: "failed",
  timed_out: "is still running — the wake timed out",
  lost: "outcome is unknown — Smart Notes restarted while waiting",
};

/** Bounded wake message appended to the thread and sent as the resume turn's prompt. */
export function buildCellWakeMessage(record: CellWakeRecord, outcome: CellWakeOutcome, run: JupyterCellRunPayload | null): string {
  const cell = `Cell ${record.index}${record.cellId ? ` (cellId ${record.cellId})` : ""}`;
  const elapsed = run?.durationMs ?? Date.now() - Date.parse(record.runStartedAt);
  const lines = [
    "[Jupyter cell wake — automatic resume]",
    `${cell} on ${record.pagePath} ${OUTCOME_LABEL[outcome]} after ${formatDuration(elapsed)} (runId ${record.runId}).`,
  ];
  if (record.note) lines.push(`Your note from before the wait: ${record.note}`);
  if (run?.failure) lines.push(`Run failure: ${run.failure.code} — ${run.failure.message}`);
  if (run) {
    lines.push(...fence("stdout", run.stdout.text, run.stdout.totalChars, WAKE_STDOUT_CHARS));
    lines.push(...fence("stderr", run.stderr.text, run.stderr.totalChars, WAKE_STDERR_CHARS));
    if (run.result) lines.push(...fence("result (text/plain)", run.result.text, run.result.text.length, WAKE_RESULT_CHARS, "head"));
    if (run.error) {
      lines.push("", `Exception: ${run.error.ename}: ${run.error.evalue}`);
      lines.push(...fence("traceback", run.error.traceback, run.error.traceback.length, WAKE_TRACEBACK_CHARS));
    }
    if (!run.stdout.text && !run.stderr.text && !run.result && !run.error) lines.push("", "The cell produced no output.");
  }
  lines.push("");
  if (outcome === "timed_out") {
    lines.push(
      "Smart Notes stopped waiting; the kernel may still be executing this cell. Tell the owner, and do not re-run it unless they ask."
    );
  } else if (outcome === "lost") {
    lines.push("Tell the owner the run's result was not captured. Do not re-run the cell unless they ask.");
  } else {
    lines.push(
      "Continue the task from your note using these outputs. The cell already ran on the live kernel — do not re-run it unless the owner asks. Outputs were not written to notebook.ipynb."
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function arm(record: CellWakeRecord): void {
  const s = state();
  clearWatch(record.wakeId);
  const remaining = Math.max(0, record.timeoutAt - Date.now());
  const timer = setTimeout(() => {
    s.timers.delete(record.wakeId);
    void settleWake(record.wakeId, "timed_out", null);
  }, remaining);
  timer.unref?.();
  s.timers.set(record.wakeId, timer);
  const unsubscribe = onJupyterCellRunSettled(record.runId, (payload) => {
    const outcome: CellWakeOutcome =
      payload.status === "completed" || payload.status === "error" || payload.status === "interrupted"
        ? payload.status
        : "failed";
    void settleWake(record.wakeId, outcome, payload);
  });
  if (!unsubscribe) {
    // The run is not in this process's registry (server restarted): nothing will ever settle it.
    queueMicrotask(() => void settleWake(record.wakeId, "lost", null));
    return;
  }
  s.unsubscribers.set(record.wakeId, unsubscribe);
}

async function waitForThreadIdle(record: CellWakeRecord, host: CompanionWakeHost, cfg: WakeConfig): Promise<void> {
  const deadline = Date.now() + cfg.maxIdleWaitMs;
  let sawBusy = false;
  while (Date.now() < deadline) {
    if (record.status !== "resuming") return;
    if (!host.isThreadBusy(record.threadKey)) break;
    sawBusy = true;
    await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
  }
  if (sawBusy && cfg.graceMs > 0) await new Promise((resolve) => setTimeout(resolve, cfg.graceMs));
}

function historyFrom(messages: unknown[]): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((entry): entry is { role: "user" | "assistant"; content: string } => {
      const message = entry as { role?: unknown; content?: unknown };
      return (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.trim().length > 0;
    })
    .slice(-WAKE_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.length > WAKE_HISTORY_CHARS ? `${message.content.slice(0, WAKE_HISTORY_CHARS)}…` : message.content,
    }));
}

/** Strip the cli-chat server-authoritative connection block so a resumed turn gets exactly one fresh copy. */
function stripConnectionBlock(appContext: string): string {
  const markers = ["\n\nHost-side companion connection (server-authoritative):", "\n\nHost-side Deep Work connection (server-authoritative):"];
  for (const marker of markers) {
    const index = appContext.lastIndexOf(marker);
    if (index >= 0) return appContext.slice(0, index);
  }
  return appContext;
}

async function settleWake(
  wakeId: string,
  outcome: CellWakeOutcome,
  run: JupyterCellRunPayload | null,
  options: { force?: boolean } = {}
): Promise<void> {
  const s = state();
  const record = s.wakes.get(wakeId);
  if (!record) return;
  if (s.settling.has(wakeId)) return s.settling.get(wakeId);
  if (record.status !== "pending" && !(options.force && record.status === "resuming")) return;

  const work = (async () => {
    clearWatch(wakeId);
    await update(record, { status: "resuming", outcome, settledAt: Date.now() });
    const cfg = config();
    const host = cfg.host;
    if (!host) {
      await update(record, { status: "failed", error: "The companion host is unavailable; cannot resume the thread." });
      return;
    }
    await waitForThreadIdle(record, host, cfg);
    if (record.status !== "resuming") return; // cancelled while waiting for the thread

    const message = buildCellWakeMessage(record, outcome, run);
    const turnId = crypto.randomUUID();
    const userMessageId = `wake-user-${crypto.randomUUID()}`;
    const assistantMessageId = `wake-assistant-${crypto.randomUUID()}`;

    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    try {
      const sidecar = await readThreadSessions(record.storePath);
      const scopes = { ...(sidecar.scopes ?? {}) } as Record<string, Record<string, unknown>>;
      const session = { ...(scopes[record.scopeKey] ?? {}) } as Record<string, unknown>;
      const messages = Array.isArray(session.messages) ? (session.messages as unknown[]) : [];
      history = historyFrom(messages);
      session.messages = [
        ...messages,
        { id: userMessageId, role: "user", content: message },
        { id: assistantMessageId, role: "assistant", content: "" },
      ].slice(-COMPANION_MAX_MESSAGES);
      session.activeTurn = { turnId, assistantMessageId, lastSeq: -1, startedAt: Date.now() };
      session.updatedAt = new Date().toISOString();
      scopes[record.scopeKey] = session;
      await saveThreadSessions(record.storePath, scopes);
    } catch (error) {
      await update(record, { status: "failed", error: `Could not write the wake to the companion thread: ${(error as Error).message}` });
      return;
    }

    let started: { ok: boolean; error?: string };
    try {
      started = await host.startHostTurn({
        turnId,
        threadKey: record.threadKey,
        message,
        history,
        provider: record.provider,
        model: record.model,
        appContext: stripConnectionBlock(record.appContext),
        pageContext: record.pageContext,
      });
    } catch (error) {
      started = { ok: false, error: (error as Error).message };
    }
    if (!started.ok) {
      const reason = started.error || "the companion turn could not start";
      await markResumeFailed(record, assistantMessageId, turnId, reason);
      await update(record, { status: "failed", error: `Cell finished but the companion could not resume: ${reason}` });
      return;
    }
    await update(record, {
      status: "resumed",
      resumeTurnId: turnId,
      resumeUserMessageId: userMessageId,
      resumeAssistantMessageId: assistantMessageId,
      error: null,
    });
  })().finally(() => {
    s.settling.delete(wakeId);
  });
  s.settling.set(wakeId, work);
  return work;
}

/** Undo the durable pointer and leave a visible failure note on the placeholder. */
async function markResumeFailed(record: CellWakeRecord, assistantMessageId: string, turnId: string, reason: string): Promise<void> {
  try {
    const sidecar = await readThreadSessions(record.storePath);
    const scopes = { ...(sidecar.scopes ?? {}) } as Record<string, Record<string, unknown>>;
    const session = scopes[record.scopeKey];
    if (!session) return;
    const messages = Array.isArray(session.messages) ? (session.messages as Array<Record<string, unknown>>) : [];
    session.messages = messages.map((message) =>
      message.id === assistantMessageId
        ? { ...message, content: `Could not resume after the cell finished: ${reason}`, errorMessage: reason }
        : message
    );
    if ((session.activeTurn as { turnId?: string } | undefined)?.turnId === turnId) session.activeTurn = null;
    await saveThreadSessions(record.storePath, scopes);
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RegisterCellRunWakeInput {
  handoff: { runId: string; cellId: string | null; index: number; pagePath: string; kernelId: string; note: string | null };
  runStartedAt: string;
  /** Companion turn that called the tool (SMART_NOTES_TURN_ID header); optional. */
  turnId?: string | null;
  timeoutMinutes?: number;
  workspaceCapability?: string;
}

export type RegisterCellRunWakeResult =
  | { wake: CellWakeView; reason?: undefined }
  | { wake: null; reason: string };

function resolveSourceTurn(host: CompanionWakeHost, pagePath: string, turnId?: string | null, workspaceCapability?: string): CompanionTurnInfo | string {
  const matchesWorkspace = (turn: CompanionTurnInfo) => !workspaceCapability || (
    parseCompanionThreadKey(turn.threadKey)?.storePath === workspaceCapability &&
    turn.appContext.includes(`- workspaceCapability: ${workspaceCapability}`)
  );
  if (turnId) {
    const turn = host.getTurn(turnId);
    if (turn && turn.status === "running" && turn.threadKey && matchesWorkspace(turn)) return turn;
    if (workspaceCapability) return "the calling turn does not own this Deep Work capability";
  }
  const running = host.listRunningTurns().filter((turn) => turn.status === "running" && turn.threadKey && matchesWorkspace(turn));
  const onPageThread = running.filter((turn) => parseCompanionThreadKey(turn.threadKey)?.storePath === pagePath);
  if (onPageThread.length === 1) return onPageThread[0];
  const mentioning = running.filter((turn) => turn.appContext.includes(pagePath) || turn.pageContext.includes(pagePath));
  if (mentioning.length === 1) return mentioning[0];
  return mentioning.length > 1 || onPageThread.length > 1
    ? "several companion turns are running for this page, so the calling thread is ambiguous"
    : "no running companion turn was found for this page";
}

/**
 * Park a durable wake for a still-running SN-376 handoff on the calling
 * companion thread. Never throws for "no thread" cases — the tool result
 * explains why no wake was registered instead.
 */
export async function registerCellRunWake(input: RegisterCellRunWakeInput): Promise<RegisterCellRunWakeResult> {
  await ensureLoaded();
  const s = state();
  for (const existing of s.wakes.values()) {
    if (existing.runId === input.handoff.runId && isOpen(existing.status)) return { wake: toView(existing) };
  }
  const host = config().host;
  if (!host) return { wake: null, reason: "the companion host is unavailable in this process" };
  if (input.workspaceCapability) workspaceRequestFromValue(input.workspaceCapability);
  const turn = resolveSourceTurn(host, input.handoff.pagePath, input.turnId, input.workspaceCapability);
  if (typeof turn === "string") return { wake: null, reason: turn };
  const address = parseCompanionThreadKey(turn.threadKey);
  if (!address) return { wake: null, reason: "the calling companion thread has no valid store address" };
  if (input.workspaceCapability && address.storePath !== input.workspaceCapability) {
    return { wake: null, reason: "the calling companion thread does not own this Deep Work workspace" };
  }

  const now = Date.now();
  const record: CellWakeRecord = {
    wakeId: `wake-${crypto.randomUUID()}`,
    runId: input.handoff.runId,
    pagePath: input.handoff.pagePath,
    cellId: input.handoff.cellId,
    index: input.handoff.index,
    kernelId: input.handoff.kernelId,
    note: input.handoff.note,
    runStartedAt: input.runStartedAt,
    registeredAt: now,
    timeoutAt: now + clampWakeTimeoutMs(input.timeoutMinutes),
    threadKey: turn.threadKey,
    storePath: address.storePath,
    scopeKey: address.scopeKey,
    sourceTurnId: turn.turnId,
    provider: turn.provider,
    model: turn.model,
    appContext: turn.appContext,
    pageContext: turn.pageContext,
    status: "pending",
    outcome: null,
    settledAt: null,
    resumeTurnId: null,
    resumeUserMessageId: null,
    resumeAssistantMessageId: null,
    error: null,
  };
  s.wakes.set(record.wakeId, record);
  arm(record);
  emit(record);
  await persist();
  return { wake: toView(record) };
}

export async function listCellRunWakes(): Promise<CellWakeView[]> {
  await ensureLoaded();
  prune();
  return [...state().wakes.values()].sort((a, b) => a.registeredAt - b.registeredAt).map(toView);
}

export async function getCellRunWake(wakeId: string): Promise<CellWakeView | null> {
  await ensureLoaded();
  const record = state().wakes.get(wakeId);
  return record ? toView(record) : null;
}

/**
 * Owner cancel: abandon the wait (no resume turn). With `interrupt`, also
 * interrupt the kernel running the cell. Clears only this wake.
 */
export async function cancelCellRunWake(wakeId: string, options: { interrupt?: boolean } = {}): Promise<CellWakeView> {
  await ensureLoaded();
  const record = state().wakes.get(wakeId);
  if (!record) throw new VaultError("WAKE_NOT_FOUND", `No Jupyter cell wake ${wakeId}.`, 404);
  if (!isOpen(record.status) || record.resumeTurnId) {
    throw new VaultError("WAKE_NOT_PENDING", `Wake ${wakeId} is already ${record.status}.`, 409);
  }
  clearWatch(wakeId);
  let error: string | null = null;
  if (options.interrupt) {
    try {
      await interruptJupyterCellRun(record.runId, { resolveServer: config().resolveServer });
    } catch (interruptError) {
      error = `Stopped waiting, but the kernel interrupt failed: ${(interruptError as Error).message}`;
    }
  }
  await update(record, { status: "cancelled", settledAt: Date.now(), error });
  return toView(record);
}

/** Test hook: inject the host / timings and clear all wake state. */
export function __configureCellRunWakesForTesting(overrides: Partial<WakeConfig> | null): void {
  const s = state();
  for (const wakeId of [...s.timers.keys(), ...s.unsubscribers.keys()]) clearWatch(wakeId);
  s.wakes.clear();
  s.settling.clear();
  s.loaded = null;
  s.config = overrides ?? {};
}

/** Test hook: wait for any in-flight settle work and pending writes. */
export async function __flushCellRunWakesForTesting(): Promise<void> {
  const s = state();
  await Promise.all([...s.settling.values()]);
  await s.writeChain;
}
