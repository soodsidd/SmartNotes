/**
 * SN-407: keyboard shortcut that toggles dictation (Ctrl+Shift+Space, ⌘⇧Space
 * on Mac). Checked against every existing editor / app shortcut — none uses
 * Space with Ctrl/⌘+Shift.
 *
 * - Start: only when focus is inside the dictation surface's scope (the note
 *   editor or the Companion composer) and dictation is available there.
 * - Stop: an active recording stops on the shortcut from anywhere, so the
 *   user never has to hunt for the focus that started it.
 */

export { DICTATION_SHORTCUT } from "@/lib/app-settings";

/** `aria-keyshortcuts` value for the dictation buttons. */
export const DICTATION_ARIA_KEYSHORTCUTS = "Control+Shift+Space Meta+Shift+Space";

export interface ShortcutKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
}

export function isDictationShortcut(event: ShortcutKeyEvent): boolean {
  if (event.repeat) return false;
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return false;
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

export type DictationShortcutAction = "stop" | "start" | "consume" | "ignore";

/**
 * Decide what a dictation surface does with a key event.
 * - "stop": this surface is recording → toggle it off.
 * - "start": focus is in scope and the surface is idle and enabled → toggle on.
 * - "consume": shortcut pressed in scope but nothing to do (busy, pending
 *   retry, disabled) → swallow it so it does not type a space.
 * - "ignore": not ours.
 */
export function dictationShortcutAction(
  event: ShortcutKeyEvent,
  state: { phase: string; hasPendingClip: boolean; inScope: boolean; enabled: boolean }
): DictationShortcutAction {
  if (!isDictationShortcut(event)) return "ignore";
  if (state.phase === "recording") return "stop";
  if (!state.inScope) return "ignore";
  if (state.enabled && state.phase === "idle" && !state.hasPendingClip) return "start";
  return "consume";
}
