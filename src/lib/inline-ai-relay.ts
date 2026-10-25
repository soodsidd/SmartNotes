import { describeTerminalTurnStatus, shouldApplyTurnEventSeq } from "@/lib/ai-sidebar";
import type { InlineAiRelayObserver } from "@/lib/inline-ai";

/** SN-362: the popup's read-only mirror of one shared Companion sidebar turn. */
export interface InlineAiRelayMirror {
  turnId: string;
  text: string;
  lastSeq: number;
  observer: InlineAiRelayObserver;
}

export function createInlineAiRelayMirror(turnId: string, observer: InlineAiRelayObserver): InlineAiRelayMirror {
  return { turnId, text: "", lastSeq: -1, observer };
}

/**
 * Applies one chat_event for the mirrored turn. Other turns and replayed
 * sequence numbers are ignored. Returns true once the turn is terminal, so the
 * caller can release the mirror.
 */
export function applyInlineAiRelayEvent(
  mirror: InlineAiRelayMirror,
  event: { turn_id?: string; type?: string; seq?: number; payload?: Record<string, unknown> }
): boolean {
  if (event.turn_id !== mirror.turnId || !shouldApplyTurnEventSeq(event.seq, mirror.lastSeq)) return false;
  if (typeof event.seq === "number") mirror.lastSeq = event.seq;
  const payload = event.payload ?? {};
  if (event.type === "token") {
    mirror.text += typeof payload.text === "string" ? payload.text : "";
    mirror.observer.onText(mirror.text);
    return false;
  }
  if (event.type === "error") {
    mirror.observer.onError(typeof payload.message === "string" ? payload.message : "Something went wrong.");
    return true;
  }
  if (event.type === "done") {
    const { isFailure, note } = describeTerminalTurnStatus(typeof payload.status === "string" ? payload.status : "completed");
    if (isFailure) mirror.observer.onError(note);
    else mirror.observer.onDone(mirror.text);
    return true;
  }
  return false;
}
