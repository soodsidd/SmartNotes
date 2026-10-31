import { NextResponse } from "next/server";

import { DICTATION_SAMPLE_RATE, MAX_DICTATION_BYTES, pcm16BytesToFloat32 } from "@/lib/speech/pcm";
import { SpeechEngineError, transcribeClip } from "@/server/speech/engine-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SN-406: POST raw little-endian PCM16 mono audio (16 kHz) and receive
 * `{ text, chunks, durationSeconds }`. The engine is the local sherpa-onnx
 * server (OpenWhispr); when it is not running the route answers 503 with
 * `code: "engine_offline"` so the client keeps the recording for Retry.
 */
export async function POST(request: Request) {
  const sampleRate = Number(request.headers.get("x-sample-rate") ?? DICTATION_SAMPLE_RATE);
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) {
    return NextResponse.json({ error: "Unsupported sample rate.", code: "bad_audio" }, { status: 400 });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_DICTATION_BYTES) {
    return NextResponse.json({ error: "Recording is too long.", code: "too_large" }, { status: 413 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_DICTATION_BYTES) {
    return NextResponse.json({ error: "Recording is too long.", code: "too_large" }, { status: 413 });
  }
  if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
    return NextResponse.json({ error: "Audio payload is empty or malformed.", code: "bad_audio" }, { status: 400 });
  }

  try {
    const result = await transcribeClip(pcm16BytesToFloat32(bytes), sampleRate);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SpeechEngineError) {
      const status = error.code === "engine_offline" ? 503 : error.code === "engine_timeout" ? 504 : 502;
      const message = error.code === "engine_offline" ? "Speech engine offline." : error.message;
      return NextResponse.json({ error: message, code: error.code }, { status });
    }
    const message = error instanceof Error ? error.message : "Transcription failed.";
    return NextResponse.json({ error: message, code: "internal" }, { status: 500 });
  }
}
