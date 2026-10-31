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
  notice: DictationNotice | null;
  hasPendingClip: boolean;
  toggle: () => void;
  retry: () => void;
  discard: () => void;
  dismissNotice: () => void;
}

export const SPEECH_ENGINE_OFFLINE_MESSAGE =
  "Speech engine offline. Open OpenWhispr on the PC, then Retry. Your recording is kept.";

const MIN_CLIP_SECONDS = 0.3;

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
  const [notice, setNotice] = React.useState<DictationNotice | null>(null);
  const [hasPendingClip, setHasPendingClip] = React.useState(false);
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
          setNotice(null);
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
        if (mountedRef.current) setNotice({ tone: "info", message: "Recording was too short.", retryable: false });
        return;
      }
      if (reason === "max-length" && mountedRef.current) {
        setNotice({ tone: "info", message: "Stopped at the 10-minute limit; transcribing.", retryable: false });
      }
      await transcribe(clip);
    },
    [transcribe, updatePhase]
  );

  const start = React.useCallback(async () => {
    setNotice(null);
    setSeconds(0);
    updatePhase("starting");
    const recorder = new DictationRecorder({
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
    updatePhase("recording");
  }, [stop, updatePhase]);

  const toggle = React.useCallback(() => {
    const current = phaseRef.current;
    if (current === "recording") {
      void stop("user");
    } else if (current === "idle" && !pendingClipRef.current) {
      void start();
    }
  }, [start, stop]);

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

  return { phase, seconds, notice, hasPendingClip, toggle, retry, discard, dismissNotice };
}
