/**
 * SN-406: browser microphone capture for dictation.
 *
 * Captures mono float PCM at the device rate (AudioWorklet, ScriptProcessor
 * fallback), feeds the silence detector, and on stop flushes the worklet's
 * pending block before resampling to 16 kHz — so the tail of the recording is
 * never dropped. Output is PCM16 ready for POST /api/speech/transcribe.
 */

import {
  DICTATION_SAMPLE_RATE,
  MAX_RECORDING_SECONDS,
  float32ToPcm16,
  resampleLinear,
} from "@/lib/speech/pcm";
import { SilenceDetector } from "@/lib/speech/silence-detector";

export type RecorderStopReason = "user" | "silence" | "max-length";

export interface RecordedClip {
  pcm16: Int16Array;
  sampleRate: number;
  durationSeconds: number;
}

export class DictationCaptureError extends Error {
  constructor(public readonly code: "unsupported" | "insecure" | "denied" | "no-device" | "failed", message: string) {
    super(message);
    this.name = "DictationCaptureError";
  }
}

const WORKLET_SOURCE = `
class SnDictationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        if (this.filled > 0) this.port.postMessage(this.buffer.slice(0, this.filled));
        this.filled = 0;
        this.port.postMessage("flushed");
      }
    };
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(channel.length - offset, this.size - this.filled);
        this.buffer.set(channel.subarray(offset, offset + take), this.filled);
        this.filled += take;
        offset += take;
        if (this.filled === this.size) {
          this.port.postMessage(this.buffer.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("sn-dictation-capture", SnDictationCapture);
`;

async function resampleTo16k(samples: Float32Array, fromRate: number): Promise<Float32Array> {
  if (fromRate === DICTATION_SAMPLE_RATE || samples.length === 0) return samples;
  const OfflineCtx =
    typeof window !== "undefined"
      ? (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)
      : undefined;
  if (OfflineCtx) {
    try {
      const length = Math.max(1, Math.round((samples.length * DICTATION_SAMPLE_RATE) / fromRate));
      const offline = new OfflineCtx(1, length, DICTATION_SAMPLE_RATE);
      const buffer = offline.createBuffer(1, samples.length, fromRate);
      buffer.getChannelData(0).set(samples);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      return rendered.getChannelData(0).slice();
    } catch {
      /* fall through to the JS resampler */
    }
  }
  return resampleLinear(samples, fromRate, DICTATION_SAMPLE_RATE);
}

export interface DictationRecorderOptions {
  /** Called once when silence or the length cap ends the recording. */
  onAutoStop: (reason: RecorderStopReason) => void;
  /** Elapsed seconds, throttled to whole-second changes. */
  onTick?: (seconds: number) => void;
  /** SN-407: auto-stop after this many seconds of silence (user setting). */
  silenceSeconds?: number;
}

export class DictationRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private blocks: Float32Array[] = [];
  private detector: SilenceDetector | null = null;
  private autoStopped = false;
  private lastTick = -1;
  private flushWaiter: (() => void) | null = null;

  constructor(private readonly options: DictationRecorderOptions) {}

  /**
   * Must be called from a user gesture (tap). Creates the AudioContext first,
   * synchronously, so iOS Safari treats it as user-activated.
   */
  async start(): Promise<void> {
    if (typeof window === "undefined") throw new DictationCaptureError("unsupported", "Dictation needs a browser.");
    if (!window.isSecureContext) {
      throw new DictationCaptureError("insecure", "Microphone needs HTTPS (open Smart Notes via its Tailscale https address).");
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !Ctx) {
      throw new DictationCaptureError("unsupported", "This browser cannot record audio.");
    }
    const context = new Ctx();
    this.context = context;
    const resumed = context.resume().catch(() => undefined);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      await this.release();
      const name = (error as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new DictationCaptureError("denied", "Microphone permission was denied.");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new DictationCaptureError("no-device", "No microphone was found.");
      }
      throw new DictationCaptureError("failed", "Could not start the microphone.");
    }
    await resumed;
    this.detector = new SilenceDetector(context.sampleRate, this.options.silenceSeconds);
    this.source = context.createMediaStreamSource(this.stream);
    // Keep the graph pulling without making the mic audible.
    this.sink = context.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(context.destination);

    let usingWorklet = false;
    if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
        try {
          await context.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(context, "sn-dictation-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        node.port.onmessage = (event: MessageEvent) => {
          if (event.data === "flushed") {
            this.flushWaiter?.();
            this.flushWaiter = null;
            return;
          }
          if (event.data instanceof Float32Array) this.accept(event.data);
        };
        this.source.connect(node);
        node.connect(this.sink);
        this.worklet = node;
        usingWorklet = true;
      } catch {
        usingWorklet = false;
      }
    }
    if (!usingWorklet) {
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        this.accept(event.inputBuffer.getChannelData(0).slice());
      };
      this.source.connect(processor);
      processor.connect(this.sink);
      this.processor = processor;
    }
  }

  private accept(block: Float32Array) {
    if (!this.detector) return;
    this.blocks.push(block);
    const silent = this.detector.push(block);
    const elapsed = this.detector.elapsedSeconds();
    const whole = Math.floor(elapsed);
    if (whole !== this.lastTick) {
      this.lastTick = whole;
      this.options.onTick?.(whole);
    }
    if (this.autoStopped) return;
    if (silent) {
      this.autoStopped = true;
      this.options.onAutoStop("silence");
    } else if (elapsed >= MAX_RECORDING_SECONDS) {
      this.autoStopped = true;
      this.options.onAutoStop("max-length");
    }
  }

  /** Stop capture and return the whole clip as 16 kHz PCM16. */
  async stop(): Promise<RecordedClip> {
    const context = this.context;
    if (this.worklet) {
      // Drain the worklet's partially filled block before tearing down.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 750);
        this.flushWaiter = () => {
          clearTimeout(timer);
          resolve();
        };
        this.worklet?.port.postMessage("flush");
      });
    }
    const rate = context?.sampleRate ?? DICTATION_SAMPLE_RATE;
    const blocks = this.blocks;
    this.blocks = [];
    this.detector = null;
    await this.release();

    const total = blocks.reduce((sum, block) => sum + block.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const block of blocks) {
      merged.set(block, offset);
      offset += block.length;
    }
    const resampled = await resampleTo16k(merged, rate);
    return {
      pcm16: float32ToPcm16(resampled),
      sampleRate: DICTATION_SAMPLE_RATE,
      durationSeconds: resampled.length / DICTATION_SAMPLE_RATE,
    };
  }

  /** Abort without producing a clip (e.g. component unmount). */
  async cancel(): Promise<void> {
    this.blocks = [];
    this.detector = null;
    await this.release();
  }

  private async release() {
    try {
      this.source?.disconnect();
      this.worklet?.disconnect();
      this.processor?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* nodes may already be disconnected */
    }
    if (this.worklet) this.worklet.port.onmessage = null;
    if (this.processor) this.processor.onaudioprocess = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source = null;
    this.worklet = null;
    this.processor = null;
    this.sink = null;
    this.stream = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
  }
}
