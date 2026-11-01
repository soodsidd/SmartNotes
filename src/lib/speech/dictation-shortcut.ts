/**
 * SN-407: push-to-talk dictation key (OpenWhispr / WhisperFlow style).
 *
 * Holding the bound key starts listening; releasing it stops and inserts the
 * transcript into the surface that had focus (note editor or Companion
 * composer). Not a toggle. The key is a single physical `KeyboardEvent.code`
 * chosen in Settings (default Caps Lock, see dictation-settings.ts).
 *
 * - Press: only when focus is inside the surface's scope and it is idle with
 *   no clip waiting for Retry. Busy / pending-retry → the key is swallowed.
 * - Hold: browser auto-repeat keydowns (`event.repeat`) are swallowed.
 * - Release: keyup of the bound key stops the hold recording from anywhere;
 *   window blur / hidden tab also release so a lost keyup cannot leave the
 *   microphone stuck open.
 */

import { DICTATION_PTT_DEFAULT_KEY, DICTATION_PTT_OFF } from "@/lib/speech/dictation-settings";

export { DICTATION_SHORTCUT } from "@/lib/app-settings";

export interface ShortcutKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
}

const KEY_LABELS: Record<string, string> = {
  CapsLock: "Caps Lock",
  ScrollLock: "Scroll Lock",
  NumLock: "Num Lock",
  Pause: "Pause",
  Insert: "Insert",
  ContextMenu: "Menu",
  ControlRight: "Right Ctrl",
  AltRight: "Right Alt",
  MetaRight: "Right ⌘/Win",
  ShiftRight: "Right Shift",
};

/** Human label for a bound key code ("CapsLock" → "Caps Lock"). */
export function dictationKeyLabel(code: string): string {
  if (code === DICTATION_PTT_OFF) return "Off";
  return KEY_LABELS[code] ?? code.replace(/^Key/, "").replace(/^Digit/, "");
}

/** Keys that type, edit, navigate, or are left-hand chord modifiers. */
const BLOCKED_CODES = new Set([
  "Escape",
  "Tab",
  "Enter",
  "NumpadEnter",
  "Backspace",
  "Delete",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ShiftLeft",
  "ControlLeft",
  "AltLeft",
  "MetaLeft",
  "OSLeft",
  "Unidentified",
]);

export type PttKeyValidation = { ok: true; code: string } | { ok: false; reason: string };

/**
 * Can this key be bound for push-to-talk? Keys that produce text or move the
 * caret would break typing, so only "spare" keys are allowed: Caps Lock,
 * function keys, Scroll Lock, Pause, Insert, Menu, right-hand modifiers.
 */
export function validatePttKey(event: Pick<ShortcutKeyEvent, "key" | "code">): PttKeyValidation {
  const code = event.code;
  if (!code || BLOCKED_CODES.has(code) || !/^[A-Za-z0-9]+$/.test(code)) {
    return { ok: false, reason: "That key types, edits or moves the cursor. Pick e.g. Caps Lock, F8, Right Ctrl or Scroll Lock." };
  }
  if (event.key.length === 1) {
    return { ok: false, reason: "That key types text. Pick e.g. Caps Lock, F8, Right Ctrl or Scroll Lock." };
  }
  return { ok: true, code };
}

/** Which modifier flag the bound key itself sets (Right Ctrl sets ctrlKey). */
function ownModifier(code: string): "ctrlKey" | "altKey" | "metaKey" | null {
  if (code === "ControlRight") return "ctrlKey";
  if (code === "AltRight") return "altKey";
  if (code === "MetaRight" || code === "OSRight") return "metaKey";
  return null;
}

export type PushToTalkAction = "press" | "release" | "consume" | "ignore";

export interface PushToTalkState {
  /** Bound key code, or "off". */
  boundKey: string;
  phase: string;
  hasPendingClip: boolean;
  /** This surface currently holds a push-to-talk press. */
  holding: boolean;
  inScope: boolean;
  enabled: boolean;
}

/**
 * Decide what a dictation surface does with a keydown / keyup.
 * - "press": start a hold recording.
 * - "release": stop the hold recording and transcribe/insert.
 * - "consume": the bound key, ours, but nothing to do (auto-repeat while held,
 *   busy, pending retry, disabled) → preventDefault, no state change.
 * - "ignore": not ours.
 */
export function pushToTalkAction(
  type: "keydown" | "keyup",
  event: ShortcutKeyEvent,
  state: PushToTalkState
): PushToTalkAction {
  const boundKey = state.boundKey || DICTATION_PTT_DEFAULT_KEY;
  if (boundKey === DICTATION_PTT_OFF || event.code !== boundKey) return "ignore";
  if (type === "keyup") return state.holding ? "release" : "ignore";
  if (state.holding) return "consume";
  if (!state.inScope) return "ignore";
  if (event.repeat) return "consume";
  const own = ownModifier(boundKey);
  const chord = (["ctrlKey", "altKey", "metaKey"] as const).some((flag) => flag !== own && event[flag]);
  if (chord) return "ignore";
  if (state.enabled && state.phase === "idle" && !state.hasPendingClip) return "press";
  return "consume";
}
