/**
 * SN-406: server transcription proxy — protocol framing, chunking, offline error.
 * A fake sherpa-onnx offline WebSocket server stands in for OpenWhispr's engine.
 */

import { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

import {
  DICTATION_SAMPLE_RATE,
  encodeEngineFrame,
  float32ToPcm16,
  pcm16BytesToFloat32,
  planChunks,
} from "@/lib/speech/pcm";
import {
  ENGINE_MESSAGE_BYTES,
  SpeechEngineError,
  transcribeChunk,
  transcribeClip,
} from "@/server/speech/engine-client";

type Received = { sampleRate: number; declaredBytes: number; samples: Float32Array; messageSizes: number[]; gotDone: boolean };

interface FakeEngine {
  url: string;
  received: Received[];
  close: () => Promise<void>;
}

function startFakeEngine(reply: (r: Received, index: number) => string | null = (r, i) => JSON.stringify({ text: `chunk${i}:${r.samples.length}` })): Promise<FakeEngine> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const received: Received[] = [];
    server.on("connection", (socket: WsSocket) => {
      let buffer = Buffer.alloc(0);
      const sizes: number[] = [];
      let entry: Received | null = null;
      socket.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          if (data.toString() === "Done" && entry) entry.gotDone = true;
          socket.close();
          return;
        }
        sizes.push(data.byteLength);
        buffer = Buffer.concat([buffer, data]);
        if (buffer.byteLength < 8) return;
        const declared = buffer.readInt32LE(4);
        if (buffer.byteLength < 8 + declared) return;
        const samples = new Float32Array(declared / 4);
        for (let i = 0; i < samples.length; i += 1) samples[i] = buffer.readFloatLE(8 + i * 4);
        entry = { sampleRate: buffer.readInt32LE(0), declaredBytes: declared, samples, messageSizes: sizes, gotDone: false };
        const index = received.length;
        received.push(entry);
        const text = reply(entry, index);
        if (text !== null) socket.send(text);
      });
    });
    server.on("listening", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        received,
        close: () => new Promise<void>((done) => {
          server.clients.forEach((client) => client.terminate());
          server.close(() => done());
        }),
      });
    });
  });
}

async function closedPortUrl(): Promise<string> {
  const engine = await startFakeEngine();
  await engine.close();
  return engine.url;
}

function tone(seconds: number, amplitude = 0.3, sampleRate = DICTATION_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("engine frame encoding", () => {
  it("writes int32 LE sample rate, int32 LE byte length, then float32 LE samples", () => {
    const samples = new Float32Array([0, 0.5, -0.25, 1]);
    const frame = encodeEngineFrame(samples, 16000);
    const view = new DataView(frame.buffer);
    expect(frame.byteLength).toBe(8 + 16);
    expect(view.getInt32(0, true)).toBe(16000);
    expect(view.getInt32(4, true)).toBe(16);
    expect([0, 1, 2, 3].map((i) => view.getFloat32(8 + i * 4, true))).toEqual([0, 0.5, -0.25, 1]);
  });

  it("round-trips PCM16 upload bytes to floats within one quantization step", () => {
    const original = new Float32Array([0, 0.123, -0.987, 1, -1, 0.5]);
    const pcm = float32ToPcm16(original);
    const decoded = pcm16BytesToFloat32(new Uint8Array(pcm.buffer));
    original.forEach((value, i) => expect(Math.abs(decoded[i] - value)).toBeLessThanOrEqual(1 / 0x7fff));
    expect(() => pcm16BytesToFloat32(new Uint8Array(3))).toThrow(/even byte length/);
  });
});

describe("planChunks", () => {
  it("returns one chunk for clips up to 30 s", () => {
    expect(planChunks(tone(30), DICTATION_SAMPLE_RATE)).toEqual([{ start: 0, end: 30 * DICTATION_SAMPLE_RATE }]);
    expect(planChunks(new Float32Array(0), DICTATION_SAMPLE_RATE)).toEqual([]);
  });

  it("partitions long clips into contiguous <=30 s ranges with no gap or overlap", () => {
    const clip = tone(127.3);
    const ranges = planChunks(clip, DICTATION_SAMPLE_RATE);
    expect(ranges.length).toBeGreaterThanOrEqual(5);
    expect(ranges[0].start).toBe(0);
    expect(ranges[ranges.length - 1].end).toBe(clip.length);
    for (let i = 0; i < ranges.length; i += 1) {
      expect(ranges[i].end - ranges[i].start).toBeLessThanOrEqual(30 * DICTATION_SAMPLE_RATE);
      if (i > 0) expect(ranges[i].start).toBe(ranges[i - 1].end);
    }
  });

  it("cuts inside pauses so words are not split", () => {
    // speech 24 s | pause 0.5 s | speech 24 s | pause 0.5 s | speech 10 s
    const clip = concat(tone(24), new Float32Array(8000), tone(24), new Float32Array(8000), tone(10));
    const ranges = planChunks(clip, DICTATION_SAMPLE_RATE);
    expect(ranges).toHaveLength(3);
    const firstPause = [24 * 16000, 24.5 * 16000];
    const secondPause = [48.5 * 16000, 49 * 16000];
    expect(ranges[0].end).toBeGreaterThanOrEqual(firstPause[0]);
    expect(ranges[0].end).toBeLessThanOrEqual(firstPause[1]);
    expect(ranges[1].end).toBeGreaterThanOrEqual(secondPause[0]);
    expect(ranges[1].end).toBeLessThanOrEqual(secondPause[1]);
  });
});

describe("transcribeChunk against a sherpa-onnx style engine", () => {
  let engine: FakeEngine;
  beforeEach(async () => {
    engine = await startFakeEngine();
  });
  afterEach(async () => {
    await engine.close();
  });

  it("streams the framed audio in <=10 KiB messages, reads JSON text, then sends Done", async () => {
    const samples = tone(2.5);
    const text = await transcribeChunk(samples, 16000, { url: engine.url });
    expect(text).toBe(`chunk0:${samples.length}`);
    const got = engine.received[0];
    expect(got.sampleRate).toBe(16000);
    expect(got.declaredBytes).toBe(samples.length * 4);
    expect(Array.from(got.samples)).toEqual(Array.from(samples));
    expect(got.messageSizes.length).toBeGreaterThan(1);
    expect(Math.max(...got.messageSizes)).toBeLessThanOrEqual(ENGINE_MESSAGE_BYTES);
    await new Promise((r) => setTimeout(r, 50));
    expect(got.gotDone).toBe(true);
  });
});

describe("transcribeClip chunking", () => {
  it("transcribes a 75 s clip as ordered <=30 s chunks with every sample delivered once", async () => {
    const engine = await startFakeEngine();
    try {
      const clip = tone(75);
      const result = await transcribeClip(clip, 16000, { url: engine.url });
      expect(result.chunks).toBeGreaterThanOrEqual(3);
      expect(engine.received).toHaveLength(result.chunks);
      const lengths = engine.received.map((r) => r.samples.length);
      lengths.forEach((n) => expect(n).toBeLessThanOrEqual(30 * 16000));
      expect(lengths.reduce((a, b) => a + b, 0)).toBe(clip.length);
      // Delivered audio, concatenated, equals the original (no drop / garble).
      const delivered = concat(...engine.received.map((r) => r.samples));
      expect(delivered).toEqual(clip);
      expect(result.text).toBe(lengths.map((n, i) => `chunk${i}:${n}`).join(" "));
      expect(result.durationSeconds).toBeCloseTo(75, 5);
    } finally {
      await engine.close();
    }
  });

  it("fails the whole clip when any chunk fails (no transcript with a missing middle)", async () => {
    const engine = await startFakeEngine((r, i) => (i === 1 ? "{not json" : JSON.stringify({ text: `ok${i}` })));
    try {
      await expect(transcribeClip(tone(65), 16000, { url: engine.url })).rejects.toMatchObject({ code: "engine_protocol" });
    } finally {
      await engine.close();
    }
  });

  it("times out when the engine never answers", async () => {
    const engine = await startFakeEngine(() => null);
    try {
      await expect(transcribeChunk(tone(1), 16000, { url: engine.url, responseTimeoutMs: 200 })).rejects.toMatchObject({ code: "engine_timeout" });
    } finally {
      await engine.close();
    }
  });
});

describe("engine offline", () => {
  it("reports engine_offline when nothing listens on the engine port", async () => {
    const url = await closedPortUrl();
    const error = await transcribeChunk(tone(1), 16000, { url }).catch((e) => e);
    expect(error).toBeInstanceOf(SpeechEngineError);
    expect(error.code).toBe("engine_offline");
  });
});

describe("POST /api/speech/transcribe", () => {
  const previous = process.env.SMART_NOTES_SPEECH_ENGINE_URL;
  afterEach(() => {
    if (previous === undefined) delete process.env.SMART_NOTES_SPEECH_ENGINE_URL;
    else process.env.SMART_NOTES_SPEECH_ENGINE_URL = previous;
  });

  function request(body: Uint8Array, headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/speech/transcribe", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-sample-rate": "16000", ...headers },
      body: body as unknown as BodyInit,
    });
  }

  it("proxies PCM16 audio to the engine and returns the joined transcript", async () => {
    const engine = await startFakeEngine();
    process.env.SMART_NOTES_SPEECH_ENGINE_URL = engine.url;
    try {
      const { POST } = await import("@/app/api/speech/transcribe/route");
      const pcm = float32ToPcm16(tone(31));
      const response = await POST(request(new Uint8Array(pcm.buffer)));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.chunks).toBe(2);
      expect(engine.received.reduce((n, r) => n + r.samples.length, 0)).toBe(pcm.length);
      expect(json.text).toMatch(/^chunk0:\d+ chunk1:\d+$/);
    } finally {
      await engine.close();
    }
  });

  it("answers 503 engine_offline when the engine is not running", async () => {
    process.env.SMART_NOTES_SPEECH_ENGINE_URL = await closedPortUrl();
    const { POST } = await import("@/app/api/speech/transcribe/route");
    const response = await POST(request(new Uint8Array(float32ToPcm16(tone(1)).buffer)));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Speech engine offline.", code: "engine_offline" });
  });

  it("rejects malformed audio", async () => {
    const { POST } = await import("@/app/api/speech/transcribe/route");
    expect((await POST(request(new Uint8Array(3)))).status).toBe(400);
    expect((await POST(request(new Uint8Array(0)))).status).toBe(400);
    expect((await POST(request(new Uint8Array(4), { "x-sample-rate": "999" }))).status).toBe(400);
  });
});
