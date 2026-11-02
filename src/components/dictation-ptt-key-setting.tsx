"use client";

/**
 * SN-407: Settings control for the push-to-talk dictation key. "Change" arms a
 * one-shot key capture ("press a key to bind"); Esc cancels. Single keys only
 * (no chords). Keys that type / edit / navigate are rejected with a hint.
 */

import * as React from "react";

import { useDictationPttKey } from "@/hooks/use-dictation";
import {
  DICTATION_PTT_DEFAULT_KEY,
  DICTATION_PTT_OFF,
  writeDictationPttKey,
} from "@/lib/speech/dictation-settings";
import { dictationKeyLabel, validatePttKey } from "@/lib/speech/dictation-shortcut";
import { cn } from "@/lib/utils";

export function DictationPttKeySetting() {
  const boundKey = useDictationPttKey();
  const [capturing, setCapturing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!capturing) return;
    // Window capture runs before the dialog's Escape handler and every
    // dictation surface, so the captured key does nothing else.
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === "Escape") {
        setCapturing(false);
        setError(null);
        return;
      }
      const result = validatePttKey(event);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      writeDictationPttKey(result.code);
      setError(null);
      setCapturing(false);
    };
    const swallowKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const cancel = () => setCapturing(false);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", swallowKeyUp, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", swallowKeyUp, true);
      window.removeEventListener("blur", cancel);
    };
  }, [capturing]);

  const off = boundKey === DICTATION_PTT_OFF;
  const actionClass =
    "rounded border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <section data-testid="settings-dictation-ptt">
      <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Dictation push-to-talk key</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="settings-dictation-ptt-capture"
          aria-label={capturing ? "Press a key to bind push-to-talk, Escape to cancel" : "Change push-to-talk key"}
          onClick={() => {
            setError(null);
            setCapturing((value) => !value);
          }}
          className={cn(
            "min-w-[7.5rem] rounded border px-3 py-1.5 font-mono text-xs transition-colors",
            capturing
              ? "border-[color:var(--accent)] bg-[color:var(--accent)]/12 text-foreground"
              : "border-border text-foreground hover:bg-muted"
          )}
        >
          {capturing ? "Press a key…" : dictationKeyLabel(boundKey)}
        </button>
        {boundKey !== DICTATION_PTT_DEFAULT_KEY ? (
          <button
            type="button"
            className={actionClass}
            data-testid="settings-dictation-ptt-reset"
            onClick={() => {
              setCapturing(false);
              setError(null);
              writeDictationPttKey(DICTATION_PTT_DEFAULT_KEY);
            }}
          >
            Reset to Caps Lock
          </button>
        ) : null}
        {!off ? (
          <button
            type="button"
            className={actionClass}
            data-testid="settings-dictation-ptt-off"
            onClick={() => {
              setCapturing(false);
              setError(null);
              writeDictationPttKey(DICTATION_PTT_OFF);
            }}
          >
            Turn off
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert" data-testid="settings-dictation-ptt-error">
          {error}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        Hold the key in a note or the Companion box to dictate; release to insert. Saved on this device.
        {boundKey === "CapsLock"
          ? " On a Windows PC running Smart Notes locally, the desktop bridge suppresses the Caps Lock toggle only while this window is active. If that bridge is unavailable, Caps Lock works normally and does not start dictation; choose another key such as F8. On macOS, choose another key because browsers do not report a usable Caps Lock release."
          : ""}
      </p>
    </section>
  );
}
