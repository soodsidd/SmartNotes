"use client";

/**
 * SN-406: tap-to-start / tap-to-stop dictation. Records on the device,
 * transcribes on the PC through POST /api/speech/transcribe (local
 * sherpa-onnx engine), then hands the transcript to `onTranscript`, which
 * appends / inserts at the caret. A failed transcription keeps the clip in
 * memory with Retry / Discard so a recording is never silently lost.
 */

import * as React from "react";

import {
  DictationCaptureError,
  DictationRecorder,
  type RecordedClip,
  type RecorderStopReason,
} from "@/lib/speech/recorder";
import {
  DICTATION_PTT_DEFAULT_KEY,
  DICTATION_SETTINGS_EVENT,
  DICTATION_SILENCE_DEFAULT_SECONDS,
  readDictationPttKey,
  readDictationSilenceSeconds,
} from "@/lib/speech/dictation-settings";
import { pushToTalkAction } from "@/lib/speech/dictation-shortcut";

export type DictationPhase = "idle" | "starting" | "recording" | "stopping" | "transcribing";

export interface DictationNotice {
  tone: "error" | "info";
  message: string;
  /** True when a recording is held and can be retried. */
  retryable: boolean;
}

export interface DictationController {
  phase: DictationPhase;
  seconds: number;
  /** SN-407: silence auto-stop window (seconds) of the current / last recording. */
  silenceSeconds: number;
  notice: DictationNotice | null;
  hasPendingClip: boolean;
  /** SN-407: the current recording was started by holding the push-to-talk key. */
  holding: boolean;
  toggle: () => void;
  /** SN-407 push-to-talk: key down -> start a hold recording (no silence auto-stop). */
  pressToTalk: () => void;
  /** SN-407 push-to-talk: key up / focus lost -> stop and transcribe/insert. */
  releaseToTalk: (options?: { capsLockOn?: boolean }) => void;
  /** True while this surface holds a push-to-talk press. */
  isHoldingKey: () => boolean;
  retry: () => void;
  discard: () => void;
  dismissNotice: () => void;
}

export const SPEECH_ENGINE_OFFLINE_MESSAGE =
  "Speech engine offline. Open OpenWhispr on the PC, then Retry. Your recording is kept.";

const MIN_CLIP_SECONDS = 0.3;

export const PTT_RELEASED_EARLY_MESSAGE = "Released before the microphone was ready. Hold the key while you speak.";
export const PTT_CAPS_LOCK_ON_MESSAGE =
  "Caps Lock is now on: the browser cannot stop the key toggling it. Press Caps Lock once to turn it off, or pick another push-to-talk key in Settings.";

export async function postDictationClip(clip: RecordedClip, fetchImpl: typeof fetch = fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl("/api/speech/transcribe", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-sample-rate": String(clip.sampleRate) },
      body: new Blob([clip.pcm16 as Int16Array<ArrayBuffer>], { type: "application/octet-stream" }),
    });
  } catch {
    throw new DictationRequestError("network", "Could not reach Smart Notes. Your recording is kept; Retry when you are back online.");
  }
  const payload = (await response.json().catch(() => ({}))) as { text?: unknown; error?: unknown; code?: unknown };
  if (!response.ok) {
    if (payload.code === "engine_offline") {
      throw new DictationRequestError("engine_offline", SPEECH_ENGINE_OFFLINE_MESSAGE);
    }
    const detail = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new DictationRequestError("failed", `Transcription failed (${detail}). Your recording is kept.`);
  }
  return typeof payload.text === "string" ? payload.text : "";
}

export class DictationRequestError extends Error {
  constructor(public readonly code: "engine_offline" | "network" | "failed", message: string) {
    super(message);
    this.name = "DictationRequestError";
  }
}

export function useDictation(onTranscript: (text: string) => void): DictationController {
  const [phase, setPhase] = React.useState<DictationPhase>("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [silenceSeconds, setSilenceSeconds] = React.useState(DICTATION_SILENCE_DEFAULT_SECONDS);
  const [notice, setNotice] = React.useState<DictationNotice | null>(null);
  const [hasPendingClip, setHasPendingClip] = React.useState(false);
  const [holding, setHolding] = React.useState(false);
  /** Push-to-talk key is physically held for this surface. */
  const keyHeldRef = React.useRef(false);
  /** The live recording is a hold (push-to-talk) recording. */
  const holdRecordingRef = React.useRef(false);
  /** Caps Lock was left on by the push-to-talk release (warn after insert). */
  const capsWarningRef = React.useRef(false);
  const recorderRef = React.useRef<DictationRecorder | null>(null);
  const pendingClipRef = React.useRef<RecordedClip | null>(null);
  const phaseRef = React.useRef<DictationPhase>("idle");
  const mountedRef = React.useRef(true);
  const onTranscriptRef = React.useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const updatePhase = React.useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  const transcribe = React.useCallback(
    async (clip: RecordedClip) => {
      updatePhase("transcribing");
      try {
        const text = await postDictationClip(clip);
        pendingClipRef.current = null;
        if (!mountedRef.current) return;
        setHasPendingClip(false);
        if (text.trim()) {
          setNotice(
            capsWarningRef.current ? { tone: "info", message: PTT_CAPS_LOCK_ON_MESSAGE, retryable: false } : null
          );
          onTranscriptRef.current(text.trim());
        } else {
          setNotice({ tone: "info", message: "No speech recognized.", retryable: false });
        }
      } catch (error) {
        pendingClipRef.current = clip;
        if (!mountedRef.current) return;
        setHasPendingClip(true);
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "Transcription failed. Your recording is kept.",
          retryable: true,
        });
      } finally {
        updatePhase("idle");
      }
    },
    [updatePhase]
  );

  const stop = React.useCallback(
    async (reason: RecorderStopReason) => {
      const recorder = recorderRef.current;
      if (!recorder || phaseRef.current !== "recording") return;
      recorderRef.current = null;
      updatePhase("stopping");
      let clip: RecordedClip;
      try {
        clip = await recorder.stop();
      } catch {
        updatePhase("idle");
        if (mountedRef.current) setNotice({ tone: "error", message: "Recording failed to finish.", retryable: false });
        return;
      }
      if (clip.durationSeconds < MIN_CLIP_SECONDS) {
        updatePhase("idle");
        // A quick tap of the push-to-talk key (e.g. Caps Lock meant as Caps
        // Lock) is discarded silently rather than flagged.
        if (mountedRef.current && !holdRecordingRef.current) {
          setNotice({ tone: "info", message: "Recording was too short.", retryable: false });
        }
        return;
      }
      if (reason === "max-length" && mountedRef.current) {
        setNotice({ tone: "info", message: "Stopped at the 10-minute limit; transcribing.", retryable: false });
      }
      await transcribe(clip);
    },
    [transcribe, updatePhase]
  );

  const start = React.useCallback(async (mode: "tap" | "hold" = "tap") => {
    const hold = mode === "hold";
    setNotice(null);
    setSeconds(0);
    holdRecordingRef.current = hold;
    capsWarningRef.current = false;
    if (mountedRef.current) setHolding(hold);
    updatePhase("starting");
    // SN-407: read the setting per recording so changes apply immediately.
    const windowSeconds = readDictationSilenceSeconds();
    setSilenceSeconds(windowSeconds);
    const recorder = new DictationRecorder({
      // Push-to-talk stops on key release, never on silence.
      silenceSeconds: hold ? Number.POSITIVE_INFINITY : windowSeconds,
      onAutoStop: (reason) => void stop(reason),
      onTick: (value) => {
        if (mountedRef.current) setSeconds(value);
      },
    });
    recorderRef.current = recorder;
    try {
      await recorder.start();
    } catch (error) {
      recorderRef.current = null;
      updatePhase("idle");
      if (mountedRef.current) {
        setNotice({
          tone: "error",
          message: error instanceof DictationCaptureError ? error.message : "Could not start the microphone.",
          retryable: false,
        });
      }
      return;
    }
    if (recorderRef.current !== recorder) return;
    if (hold && !keyHeldRef.current) {
      // Key released (or focus lost) while the microphone was still opening.
      recorderRef.current = null;
      await recorder.cancel();
      updatePhase("idle");
      if (mountedRef.current) setNotice({ tone: "info", message: PTT_RELEASED_EARLY_MESSAGE, retryable: false });
      return;
    }
    updatePhase("recording");
  }, [stop, updatePhase]);

  const toggle = React.useCallback(() => {
    const current = phaseRef.current;
    if (current === "recording") {
      void stop("user");
    } else if (current === "idle" && !pendingClipRef.current) {
      void start("tap");
    }
  }, [start, stop]);

  const pressToTalk = React.useCallback(() => {
    if (keyHeldRef.current || phaseRef.current !== "idle" || pendingClipRef.current) return;
    keyHeldRef.current = true;
    void start("hold");
  }, [start]);

  const releaseToTalk = React.useCallback(
    (options?: { capsLockOn?: boolean }) => {
      if (!keyHeldRef.current) return;
      keyHeldRef.current = false;
      capsWarningRef.current = Boolean(options?.capsLockOn);
      // "starting": start() sees the released key and cancels itself.
      if (phaseRef.current === "recording" && holdRecordingRef.current) void stop("user");
    },
    [stop]
  );

  const isHoldingKey = React.useCallback(() => keyHeldRef.current, []);

  const retry = React.useCallback(() => {
    const clip = pendingClipRef.current;
    if (!clip || phaseRef.current !== "idle") return;
    setNotice(null);
    void transcribe(clip);
  }, [transcribe]);

  const discard = React.useCallback(() => {
    pendingClipRef.current = null;
    setHasPendingClip(false);
    setNotice(null);
  }, []);

  const dismissNotice = React.useCallback(() => {
    if (!pendingClipRef.current) setNotice(null);
  }, []);

  return {
    phase,
    seconds,
    silenceSeconds,
    notice,
    hasPendingClip,
    holding,
    toggle,
    pressToTalk,
    releaseToTalk,
    isHoldingKey,
    retry,
    discard,
    dismissNotice,
  };
}

/** SN-407: current push-to-talk key code ("off" when disabled); SSR-safe. */
export function useDictationPttKey(): string {
  const [key, setKey] = React.useState(DICTATION_PTT_DEFAULT_KEY);
  React.useEffect(() => {
    const sync = () => setKey(readDictationPttKey());
    sync();
    window.addEventListener(DICTATION_SETTINGS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DICTATION_SETTINGS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return key;
}

/**
 * SN-407: wire push-to-talk to a controller. Holding the configured key
 * (default Caps Lock) while focus is inside this surface (`isInScope`) starts
 * listening; releasing it stops and inserts. `enabled` gates starting.
 *
 * Listeners run in the window capture phase so editor keymaps never see the
 * bound key first. Each surface only presses when focus is in its own scope
 * and only releases its own hold, so editor + composer never both fire.
 * Window blur and a hidden tab release the hold: a keyup lost to another
 * window can never leave the microphone open.
 */
export function useDictationPushToTalk(
  controller: DictationController,
  isInScope: (active: Element | null) => boolean,
  enabled = true
): void {
  const stateRef = React.useRef({ controller, isInScope, enabled });
  stateRef.current = { controller, isInScope, enabled };

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let boundKey = readDictationPttKey();
    const syncKey = () => {
      const next = readDictationPttKey();
      // Rebinding mid-hold: release the old key's hold rather than strand it.
      if (next !== boundKey) stateRef.current.controller.releaseToTalk();
      boundKey = next;
    };
    const decide = (type: "keydown" | "keyup", event: KeyboardEvent) => {
      const { controller: current, isInScope: inScope, enabled: canStart } = stateRef.current;
      return pushToTalkAction(type, event, {
        boundKey,
        phase: current.phase,
        hasPendingClip: current.hasPendingClip,
        holding: current.isHoldingKey(),
        inScope: inScope(document.activeElement),
        enabled: canStart,
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const action = decide("keydown", event);
      if (action === "ignore") return;
      event.preventDefault();
      if (action === "press") stateRef.current.controller.pressToTalk();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (decide("keyup", event) !== "release") return;
      event.preventDefault();
      const capsLockOn = event.code === "CapsLock" && Boolean(event.getModifierState?.("CapsLock"));
      stateRef.current.controller.releaseToTalk({ capsLockOn });
    };
    const releaseLost = () => stateRef.current.controller.releaseToTalk();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") releaseLost();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", releaseLost);
    window.addEventListener("pagehide", releaseLost);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(DICTATION_SETTINGS_EVENT, syncKey);
    window.addEventListener("storage", syncKey);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", releaseLost);
      window.removeEventListener("pagehide", releaseLost);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(DICTATION_SETTINGS_EVENT, syncKey);
      window.removeEventListener("storage", syncKey);
    };
  }, []);
}
