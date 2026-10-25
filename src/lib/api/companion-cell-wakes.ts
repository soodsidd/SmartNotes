// SN-377: client wrapper for Jupyter cell-run wakes (detach → wait → resume).

export type CompanionCellWakeStatus = "pending" | "resuming" | "resumed" | "cancelled" | "failed";

export interface CompanionCellWake {
  wakeId: string;
  runId: string;
  pagePath: string;
  cellId: string | null;
  index: number;
  note: string | null;
  status: CompanionCellWakeStatus;
  outcome: string | null;
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

export async function fetchCompanionCellWakes(): Promise<CompanionCellWake[]> {
  const response = await fetch("/api/companion/cell-wakes", { cache: "no-store" });
  if (!response.ok) return [];
  const data = (await response.json().catch(() => ({}))) as { wakes?: CompanionCellWake[] };
  return Array.isArray(data.wakes) ? data.wakes : [];
}

export async function cancelCompanionCellWake(wakeId: string, interrupt = false): Promise<CompanionCellWake> {
  const response = await fetch("/api/companion/cell-wakes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel", wakeId, interrupt }),
  });
  const data = (await response.json().catch(() => ({}))) as { wake?: CompanionCellWake; error?: string };
  if (!response.ok || !data.wake) throw new Error(data.error ?? "Could not cancel the cell wake.");
  return data.wake;
}

/** A wake the transcript should show as "Waiting for cell…". */
export function isCompanionCellWakeWaiting(wake: CompanionCellWake): boolean {
  return wake.status === "pending" || (wake.status === "resuming" && !wake.resumeTurnId);
}

/** Merge a socket/list update into the shell's wake list (latest wins by wakeId). */
export function upsertCompanionCellWake(list: CompanionCellWake[], wake: CompanionCellWake): CompanionCellWake[] {
  const index = list.findIndex((entry) => entry.wakeId === wake.wakeId);
  if (index < 0) return [...list, wake];
  const next = list.slice();
  next[index] = wake;
  return next;
}

/** Thread address (`storePath::scopeKey`) a wake belongs to, matching the shell's SN-322 thread key. */
export function companionCellWakeThread(wake: CompanionCellWake): { storePath: string; scopeKey: string } {
  return { storePath: wake.storePath, scopeKey: wake.scopeKey };
}

/** Transcript row model for a parked wake on the displayed thread. */
export interface CompanionCellWakeItem {
  wakeId: string;
  /** e.g. "Cell 2 (slow-1)" */
  cellLabel: string;
  note: string | null;
  startedAt: string;
  timeoutAt: string;
  /** True once the cell settled and the host is waiting to resume this thread. */
  resuming: boolean;
  cancelling?: boolean;
  error?: string | null;
}

function normalizeStorePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Waiting wakes for exactly one thread (SN-322 address), oldest first. Wakes on
 * other pages/sections/scopes never appear in this thread's transcript.
 */
export function selectThreadCellWakeItems(
  wakes: CompanionCellWake[],
  thread: { storePath: string; scopeKey: string },
  state: { cancelling?: readonly string[]; errors?: Readonly<Record<string, string>> } = {}
): CompanionCellWakeItem[] {
  if (!thread.storePath) return [];
  const storePath = normalizeStorePath(thread.storePath);
  return wakes
    .filter(
      (wake) =>
        isCompanionCellWakeWaiting(wake) &&
        normalizeStorePath(wake.storePath) === storePath &&
        wake.scopeKey === thread.scopeKey
    )
    .sort((a, b) => Date.parse(a.registeredAt) - Date.parse(b.registeredAt))
    .map((wake) => ({
      wakeId: wake.wakeId,
      cellLabel: `Cell ${wake.index}${wake.cellId ? ` (${wake.cellId})` : ""}`,
      note: wake.note,
      startedAt: wake.runStartedAt,
      timeoutAt: wake.timeoutAt,
      resuming: wake.status === "resuming",
      cancelling: state.cancelling?.includes(wake.wakeId) ?? false,
      error: state.errors?.[wake.wakeId] ?? null,
    }));
}

/** SN-373 indicator turn id for a parked wake (the thread pulses "working" while it waits). */
export function companionCellWakeIndicatorTurnId(wakeId: string): string {
  return `cell-wake:${wakeId}`;
}
