// SN-406 live smoke: POST a 16 kHz mono PCM16 WAV to a running Smart Notes
// /api/speech/transcribe and print the transcript, chunk count, and latency.
// Usage: node evidence/SN-406/engine-smoke.mjs <baseUrl> <file.wav>
import { readFileSync } from "node:fs";

const [baseUrl, wavPath] = process.argv.slice(2);
if (!baseUrl || !wavPath) {
  console.error("usage: node evidence/SN-406/engine-smoke.mjs <baseUrl> <file.wav>");
  process.exit(2);
}
const wav = readFileSync(wavPath);
let offset = 12;
let sampleRate = 16000;
let pcm = null;
while (offset + 8 <= wav.length) {
  const id = wav.toString("ascii", offset, offset + 4);
  const size = wav.readUInt32LE(offset + 4);
  if (id === "fmt ") {
    const channels = wav.readUInt16LE(offset + 10);
    sampleRate = wav.readUInt32LE(offset + 12);
    const bits = wav.readUInt16LE(offset + 22);
    if (channels !== 1 || bits !== 16) throw new Error(`need mono 16-bit WAV, got ${channels}ch ${bits}bit`);
  } else if (id === "data") {
    pcm = wav.subarray(offset + 8, offset + 8 + size);
  }
  offset += 8 + size + (size % 2);
}
if (!pcm) throw new Error("no data chunk");
const started = Date.now();
const res = await fetch(new URL("/api/speech/transcribe", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/octet-stream", "x-sample-rate": String(sampleRate) },
  body: pcm,
});
const json = await res.json();
console.log(JSON.stringify({ status: res.status, audioSeconds: pcm.length / 2 / sampleRate, latencyMs: Date.now() - started, ...json }, null, 2));
