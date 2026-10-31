/**
 * SN-406: auto-stop dictation after a stretch of silence.
 *
 * Time is measured on the audio sample clock (samples fed / sample rate), not
 * wall time, so a busy main thread cannot cause an early stop and the logic is
 * deterministic under test. The silence window starts at recording start, so a
 * recording where nobody speaks also stops after `silenceSeconds`.
 */

export const DICTATION_SILENCE_SECONDS = 10;

/** Frame RMS above this counts as voice (~ -38 dBFS). */
export const DICTATION_VOICE_RMS = 0.0125;

export function frameRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export class SilenceDetector {
  private elapsedSamples = 0;
  private lastVoiceSample = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly silenceSeconds: number = DICTATION_SILENCE_SECONDS,
    private readonly voiceRms: number = DICTATION_VOICE_RMS
  ) {}

  /** Feed one block of audio. Returns true once silence has lasted long enough. */
  push(block: Float32Array): boolean {
    this.elapsedSamples += block.length;
    if (frameRms(block) >= this.voiceRms) {
      this.lastVoiceSample = this.elapsedSamples;
    }
    return this.silentSeconds() >= this.silenceSeconds;
  }

  silentSeconds(): number {
    return (this.elapsedSamples - this.lastVoiceSample) / this.sampleRate;
  }

  elapsedSeconds(): number {
    return this.elapsedSamples / this.sampleRate;
  }
}
