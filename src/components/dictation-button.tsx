"use client";

/**
 * SN-406: mic button + status line for dictation via the local speech engine.
 *
 * Variants:
 * - `composer`: Companion composer control (44px on phone, 28px desktop).
 * - `toolbar`: editor format bar (`.toolbar-btn`), desktop and phone. With
 *   `showLabel` it renders a visible "Dictate" text label (desktop) so it is
 *   never mistaken for part of the Insert "+" menu next to it.
 * - `fab`: editor phone floating button, bottom-right thumb zone, 56px.
 *
 * Recording state is unmistakable: `--destructive` fill, stop-square icon,
 * pulsing ring, and a live elapsed timer in the status line.
 */

import * as React from "react";
import { Loader2, Mic, Square } from "lucide-react";

import type { DictationController } from "@/hooks/use-dictation";
import { cn } from "@/lib/utils";

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function dictationButtonLabel(controller: DictationController): string {
  switch (controller.phase) {
    case "recording":
      return "Stop dictation";
    case "starting":
      return "Starting microphone";
    case "stopping":
    case "transcribing":
      return "Transcribing dictation";
    default:
      return controller.hasPendingClip ? "Dictation recording waiting for retry" : "Dictate";
  }
}

/** Short visible label for the labeled toolbar variant. */
export function dictationButtonText(controller: DictationController): string {
  switch (controller.phase) {
    case "recording":
      return "Stop";
    case "starting":
      return "Starting…";
    case "stopping":
    case "transcribing":
      return "Transcribing…";
    default:
      return "Dictate";
  }
}

export function DictationButton({
  controller,
  variant,
  showLabel = false,
  disabled = false,
  className,
  testId,
}: {
  controller: DictationController;
  variant: "composer" | "composer-mobile" | "toolbar" | "fab";
  /** Toolbar only: show a visible text label next to the icon. */
  showLabel?: boolean;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const { phase } = controller;
  const recording = phase === "recording";
  const busy = phase === "starting" || phase === "stopping" || phase === "transcribing";
  const blocked = disabled || busy || (!recording && controller.hasPendingClip);
  const label = dictationButtonLabel(controller);
  const iconClass = variant === "fab" ? "size-6" : variant === "composer-mobile" ? "size-5" : "size-4";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={recording}
      data-testid={testId}
      data-dictation-phase={phase}
      disabled={blocked}
      // Keep editor focus / caret on desktop (same contract as ToolbarBtn).
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => controller.toggle()}
      className={cn(
        "dictation-btn",
        `dictation-btn--${variant}`,
        recording && "dictation-btn--recording",
        busy && "dictation-btn--busy",
        variant === "toolbar" && "toolbar-btn",
        variant === "toolbar" && showLabel && "toolbar-btn--wide dictation-btn--labeled",
        className
      )}
    >
      {busy ? (
        <Loader2 className={cn(iconClass, "animate-spin")} aria-hidden="true" />
      ) : recording ? (
        <Square className={cn(iconClass, "fill-current")} aria-hidden="true" />
      ) : (
        <Mic className={iconClass} aria-hidden="true" />
      )}
      {variant === "toolbar" && showLabel ? (
        <span className="dictation-btn__label">{dictationButtonText(controller)}</span>
      ) : null}
    </button>
  );
}

/** Live recording timer / transcribing state / offline notice with Retry + Discard. */
export function DictationStatus({
  controller,
  className,
  testId,
}: {
  controller: DictationController;
  className?: string;
  testId?: string;
}) {
  const { phase, seconds, notice } = controller;
  if (phase === "recording") {
    return (
      <div className={cn("dictation-status", className)} role="status" aria-live="polite" data-testid={testId}>
        <span className="dictation-status__dot" aria-hidden="true" />
        <span className="dictation-status__text">
          Listening {formatElapsed(seconds)} · stops after 10 s of silence
        </span>
      </div>
    );
  }
  if (phase === "starting" || phase === "stopping" || phase === "transcribing") {
    return (
      <div className={cn("dictation-status", className)} role="status" aria-live="polite" data-testid={testId}>
        <span className="dictation-status__text">{phase === "starting" ? "Starting microphone…" : "Transcribing…"}</span>
      </div>
    );
  }
  if (!notice) return null;
  return (
    <div
      className={cn("dictation-status", notice.tone === "error" && "dictation-status--error", className)}
      role={notice.tone === "error" ? "alert" : "status"}
      data-testid={testId}
    >
      <span className="dictation-status__text">{notice.message}</span>
      {notice.retryable ? (
        <>
          <button type="button" className="dictation-status__action" onClick={controller.retry} data-testid="dictation-retry">
            Retry
          </button>
          <button type="button" className="dictation-status__action" onClick={controller.discard} data-testid="dictation-discard">
            Discard
          </button>
        </>
      ) : (
        <button type="button" className="dictation-status__action" onClick={controller.dismissNotice} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
