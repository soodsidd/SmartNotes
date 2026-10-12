/**
 * Companion transcript scroll-follow policy (SN-285).
 *
 * The transcript follows a streaming reply only while the reader is parked at
 * (or near) the live bottom. Scrolling up detaches; the viewport then stays put
 * as tokens arrive until the reader returns to the bottom or uses Jump to latest.
 * Opening/restoring a conversation and sending a new prompt always land at the
 * latest message.
 */

/** Distance from the bottom (px) still treated as "at the live bottom". */
export const COMPANION_FOLLOW_THRESHOLD_PX = 48;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function isNearBottom(
  metrics: ScrollMetrics,
  threshold: number = COMPANION_FOLLOW_THRESHOLD_PX
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}

export interface TranscriptSnapshot {
  length: number;
  firstId: string | null;
  lastUserId: string | null;
}

export function snapshotTranscript(
  messages: ReadonlyArray<{ id: string; role: string }>
): TranscriptSnapshot {
  let lastUserId: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserId = messages[index].id;
      break;
    }
  }
  return {
    length: messages.length,
    firstId: messages[0]?.id ?? null,
    lastUserId,
  };
}

/**
 * - `reset`: conversation opened, restored, replaced, or cleared → land at bottom and follow.
 * - `sent`: the reader appended a new prompt → land at bottom and follow.
 * - `update`: streaming/appended content in the same conversation → follow only if following.
 */
export type TranscriptChange = "reset" | "sent" | "update";

export function classifyTranscriptChange(
  previous: TranscriptSnapshot | null,
  next: TranscriptSnapshot
): TranscriptChange {
  if (!previous || previous.length === 0 || next.length < previous.length || previous.firstId !== next.firstId) {
    return "reset";
  }
  if (next.lastUserId !== null && next.lastUserId !== previous.lastUserId) {
    return "sent";
  }
  return "update";
}

export type CompanionScrollAction = "follow" | "preserve";

export function resolveCompanionScroll(change: TranscriptChange, following: boolean): CompanionScrollAction {
  if (change !== "update") {
    return "follow";
  }
  return following ? "follow" : "preserve";
}
