/**
 * SN-406: pure PCM helpers shared by the browser recorder and the server
 * speech proxy. No DOM or Node APIs; safe to import from either side.
 */

/** Sample rate the browser uploads and the engine receives. */
export const DICTATION_SAMPLE_RATE = 16_000;

/** Recorder hard cap; the recorder auto-stops here. */
export const MAX_RECORDING_SECONDS = 600;

/** Upload cap: 15 minutes of 16 kHz PCM16, above the 10-minute recorder cap. */
export const MAX_DICTATION_BYTES = DICTATION_SAMPLE_RATE * 2 * 60 * 15;

/** Engine limit: no single engine message may exceed this many seconds. */
export const MAX_CHUNK_SECONDS = 30;

/** Earliest point (seconds into a chunk) at which a long clip may be split. */
export const MIN_CHUNK_SECONDS = 20;

/** Frame used to find the quietest split point inside the split window. */
const SPLIT_FRAME_SECONDS = 0.1;

export function float32ToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
    out[i] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
  }
  return out;
}

/** Decode little-endian signed 16-bit PCM bytes into [-1, 1] floats. */
export function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 2 !== 0) {
    throw new Error("PCM16 payload must have an even byte length.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i += 1) {
    const value = view.getInt16(i * 2, true);
    out[i] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return out;
}

/**
 * sherpa-onnx offline WebSocket frame: int32 LE sample rate, int32 LE byte
 * length of the sample payload, then float32 LE mono samples.
 */
export function encodeEngineFrame(samples: Float32Array, sampleRate: number): Uint8Array {
  const payloadBytes = samples.length * 4;
  const frame = new Uint8Array(8 + payloadBytes);
  const view = new DataView(frame.buffer);
  view.setInt32(0, sampleRate, true);
  view.setInt32(4, payloadBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    view.setFloat32(8 + i * 4, samples[i], true);
  }
  return frame;
}

export interface ChunkRange {
  /** Inclusive sample index. */
  start: number;
  /** Exclusive sample index. */
  end: number;
}

function frameEnergy(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
  return sum / Math.max(1, end - start);
}

/**
 * Partition a clip into contiguous ranges of at most `maxSeconds`. Every
 * sample belongs to exactly one range (no gaps, no overlap), so nothing is
 * dropped or duplicated. Long clips are cut at the quietest 100 ms frame
 * between `minSeconds` and `maxSeconds` so words are not split mid-syllable.
 */
export function planChunks(
  samples: Float32Array,
  sampleRate: number,
  options: { maxSeconds?: number; minSeconds?: number } = {}
): ChunkRange[] {
  const maxSamples = Math.floor((options.maxSeconds ?? MAX_CHUNK_SECONDS) * sampleRate);
  const minSamples = Math.min(maxSamples, Math.floor((options.minSeconds ?? MIN_CHUNK_SECONDS) * sampleRate));
  const frame = Math.max(1, Math.floor(SPLIT_FRAME_SECONDS * sampleRate));
  const ranges: ChunkRange[] = [];
  if (samples.length === 0) return ranges;

  let start = 0;
  while (samples.length - start > maxSamples) {
    let bestCut = start + maxSamples;
    let bestEnergy = Number.POSITIVE_INFINITY;
    for (let frameStart = start + minSamples; frameStart + frame <= start + maxSamples; frameStart += frame) {
      const energy = frameEnergy(samples, frameStart, frameStart + frame);
      if (energy < bestEnergy) {
        bestEnergy = energy;
        bestCut = frameStart + Math.floor(frame / 2);
      }
    }
    ranges.push({ start, end: bestCut });
    start = bestCut;
  }
  ranges.push({ start, end: samples.length });
  return ranges;
}

/** Linear-interpolation resampler (fallback when OfflineAudioContext is unavailable). */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input.slice();
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  // Box-average when downsampling to limit aliasing.
  const span = Math.max(1, Math.floor(ratio));
  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    if (span > 1) {
      let sum = 0;
      let count = 0;
      for (let j = index; j < Math.min(input.length, index + span); j += 1) {
        sum += input[j];
        count += 1;
      }
      out[i] = count ? sum / count : 0;
    } else {
      const next = Math.min(input.length - 1, index + 1);
      const frac = position - index;
      out[i] = input[Math.min(index, input.length - 1)] * (1 - frac) + input[next] * frac;
    }
  }
  return out;
}

/** Join per-chunk transcripts in order. */
export function joinTranscripts(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}
