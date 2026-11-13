/**
 * SN-406: server-side client for the local speech engine (sherpa-onnx offline
 * WebSocket server managed by OpenWhispr, Parakeet TDT 0.6B v3).
 *
 * The browser never talks to the engine directly (mixed content + no auth);
 * audio goes phone -> Smart Notes POST /api/speech/transcribe -> here.
 *
 * Protocol (per connection): one binary frame
 *   int32 LE sample rate | int32 LE payload byte length | float32 LE samples
 * -> engine replies with JSON `{ "text": ... }` -> client sends text "Done".
 */

import {
  DICTATION_SAMPLE_RATE,
  encodeEngineFrame,
  joinTranscripts,
  planChunks,
} from "@/lib/speech/pcm";
import {
  DEFAULT_SPEECH_ENGINE_URL,
  resolveSpeechEngineTargets,
  resolveSpeechEngineUrl,
} from "@/server/speech/engine-settings";

export { DEFAULT_SPEECH_ENGINE_URL, resolveSpeechEngineUrl };

/** Max bytes per WebSocket message (sherpa-onnx reference client uses 10240). */
export const ENGINE_MESSAGE_BYTES = 10_240;

export type SpeechEngineErrorCode = "engine_offline" | "engine_timeout" | "engine_protocol";

export class SpeechEngineError extends Error {
  constructor(public readonly code: SpeechEngineErrorCode, message: string) {
    super(message);
    this.name = "SpeechEngineError";
  }
}

type WebSocketLike = {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void;
};

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface EngineOptions {
  /** Single engine URL (no fallback). */
  url?: string;
  /**
   * Engine URLs in preference order (GPU first, CPU fallback). Used by
   * transcribeClip only; defaults to the GPU setting + env (engine-settings.ts).
   */
  urls?: string[];
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  createSocket?: WebSocketFactory;
}

function defaultFactory(url: string): WebSocketLike {
  const Impl = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!Impl) throw new SpeechEngineError("engine_offline", "WebSocket client is unavailable in this runtime.");
  return new Impl(url);
}

function parseEngineReply(data: unknown): string {
  const raw =
    typeof data === "string"
      ? data
      : data instanceof ArrayBuffer
        ? new TextDecoder().decode(new Uint8Array(data))
        : ArrayBuffer.isView(data)
          ? new TextDecoder().decode(data as Uint8Array)
          : String(data ?? "");
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new SpeechEngineError("engine_protocol", "Speech engine returned malformed JSON.");
    }
    const text = (parsed as { text?: unknown })?.text;
    if (typeof text !== "string") {
      throw new SpeechEngineError("engine_protocol", "Speech engine reply has no text field.");
    }
    return text;
  }
  // Older sherpa-onnx builds reply with the bare transcript.
  return raw;
}

/** Transcribe one chunk (<= 30 s) over a fresh engine connection. */
export function transcribeChunk(
  samples: Float32Array,
  sampleRate: number,
  options: EngineOptions = {}
): Promise<string> {
  const url = options.url ?? resolveSpeechEngineUrl();
  const connectTimeoutMs = options.connectTimeoutMs ?? 4_000;
  const responseTimeoutMs = options.responseTimeoutMs ?? 90_000;
  const factory = options.createSocket ?? defaultFactory;

  return new Promise<string>((resolve, reject) => {
    let socket: WebSocketLike;
    try {
      socket = factory(url);
    } catch (error) {
      reject(
        error instanceof SpeechEngineError
          ? error
          : new SpeechEngineError("engine_offline", "Speech engine is offline.")
      );
      return;
    }
    let opened = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (error: SpeechEngineError | null, text?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      if (error) reject(error);
      else resolve(text ?? "");
    };
    const arm = (ms: number, error: SpeechEngineError) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(error), ms);
    };

    socket.binaryType = "arraybuffer";
    arm(connectTimeoutMs, new SpeechEngineError("engine_offline", "Speech engine is offline (connect timed out)."));

    socket.addEventListener("open", () => {
      opened = true;
      arm(responseTimeoutMs, new SpeechEngineError("engine_timeout", "Speech engine did not answer in time."));
      try {
        // Mirror the sherpa-onnx reference client: stream the frame in small
        // messages; the server reassembles using the declared byte length.
        const frame = encodeEngineFrame(samples, sampleRate);
        for (let offset = 0; offset < frame.byteLength; offset += ENGINE_MESSAGE_BYTES) {
          socket.send(frame.subarray(offset, Math.min(frame.byteLength, offset + ENGINE_MESSAGE_BYTES)));
        }
      } catch {
        finish(new SpeechEngineError("engine_protocol", "Could not send audio to the speech engine."));
      }
    });
    socket.addEventListener("message", (event: { data: unknown }) => {
      let text: string;
      try {
        text = parseEngineReply(event.data);
      } catch (error) {
        finish(error as SpeechEngineError);
        return;
      }
      try {
        socket.send("Done");
      } catch {
        /* engine may close first; transcript already received */
      }
      finish(null, text);
    });
    socket.addEventListener("error", () => {
      finish(
        opened
          ? new SpeechEngineError("engine_protocol", "Speech engine connection failed mid-transcription.")
          : new SpeechEngineError("engine_offline", "Speech engine is offline.")
      );
    });
    socket.addEventListener("close", () => {
      finish(
        opened
          ? new SpeechEngineError("engine_protocol", "Speech engine closed before returning a transcript.")
          : new SpeechEngineError("engine_offline", "Speech engine is offline.")
      );
    });
  });
}

export interface TranscribeClipResult {
  text: string;
  chunks: number;
  durationSeconds: number;
}

/**
 * Transcribe a full clip. Clips longer than 30 s are split into contiguous,
 * silence-aligned chunks and transcribed sequentially (the engine is CPU
 * bound). Any chunk failure fails the whole clip, so callers never insert a
 * transcript with a missing middle.
 */
export async function transcribeClip(
  samples: Float32Array,
  sampleRate: number = DICTATION_SAMPLE_RATE,
  options: EngineOptions = {}
): Promise<TranscribeClipResult> {
  const ranges = planChunks(samples, sampleRate);
  const targets = options.url ? [options.url] : options.urls?.length ? options.urls : await resolveSpeechEngineTargets();
  let target = 0;
  const parts: string[] = [];
  for (const range of ranges) {
    const chunk = samples.subarray(range.start, range.end);
    for (;;) {
      try {
        parts.push(await transcribeChunk(chunk, sampleRate, { ...options, url: targets[target] }));
        break;
      } catch (error) {
        // GPU engine stopped/warming/crashed: fall back to the next engine and
        // stay there for the rest of the clip. Only "offline" falls back; a
        // timeout or protocol error from a live engine still fails the clip.
        const offline = error instanceof SpeechEngineError && error.code === "engine_offline";
        if (!offline || target >= targets.length - 1) throw error;
        target += 1;
      }
    }
  }
  return {
    text: joinTranscripts(parts),
    chunks: ranges.length,
    durationSeconds: samples.length / sampleRate,
  };
}
