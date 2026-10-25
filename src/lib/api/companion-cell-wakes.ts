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
