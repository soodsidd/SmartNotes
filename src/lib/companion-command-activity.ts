// SN-401: client model for the Deep Work "Companion commands" panel. The
// cli-chat `command` turn event (packages/cli-chat/command-activity.js) is the
// only source; this module validates, bounds, and merges those events.

export type CompanionCommandStatus = "running" | "completed" | "failed";

export interface CompanionCommandEntry {
  /** turnId + command id; stable across the running → finished update. */
  key: string;
  turnId: string;
  command: string;
  status: CompanionCommandStatus;
  provider: string | null;
  exitCode: number | null;
  output: string | null;
  outputTruncated: boolean;
  startedAt: number;
  finishedAt: number | null;
}

export const COMPANION_COMMAND_HISTORY_LIMIT = 100;
const MAX_COMMAND = 4_000;
const MAX_OUTPUT = 16_000;

export function parseCompanionCommandEvent(
  turnId: unknown,
  payload: Record<string, unknown> | null | undefined,
  now = Date.now()
): CompanionCommandEntry | null {
  if (typeof turnId !== "string" || !turnId || !payload) return null;
  const id = typeof payload.command_id === "string" ? payload.command_id.slice(0, 200) : "";
  const command = typeof payload.command === "string" ? payload.command.slice(0, MAX_COMMAND) : "";
  const status = payload.status === "running" || payload.status === "completed" || payload.status === "failed" ? payload.status : null;
  if (!id || !command.trim() || !status) return null;
  const output = typeof payload.output === "string" && payload.output ? payload.output.slice(-MAX_OUTPUT) : null;
  return {
    key: `${turnId}:${id}`,
    turnId,
    command,
    status,
    provider: typeof payload.provider === "string" ? payload.provider.slice(0, 40) : null,
    exitCode: typeof payload.exit_code === "number" && Number.isInteger(payload.exit_code) ? payload.exit_code : null,
    output,
    outputTruncated: payload.output_truncated === true,
    startedAt: now,
    finishedAt: status === "running" ? null : now,
  };
}

/** Insert or update by key, keeping first-seen order and the original start time. */
export function upsertCompanionCommand(
  list: readonly CompanionCommandEntry[],
  entry: CompanionCommandEntry,
  limit = COMPANION_COMMAND_HISTORY_LIMIT
): CompanionCommandEntry[] {
  const index = list.findIndex((item) => item.key === entry.key);
  if (index === -1) {
    const next = [...list, entry];
    return next.length > limit ? next.slice(next.length - limit) : next;
  }
  const previous = list[index];
  // A replayed "running" event must never regress a finished command.
  if (previous.status !== "running" && entry.status === "running") return list as CompanionCommandEntry[];
  const next = [...list];
  next[index] = { ...entry, startedAt: previous.startedAt };
  return next;
}

export function countRunningCompanionCommands(list: readonly CompanionCommandEntry[]): number {
  return list.reduce((total, item) => total + (item.status === "running" ? 1 : 0), 0);
}
