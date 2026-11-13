/**
 * Dictation GPU acceleration setting (PC-wide, server-persisted).
 *
 * The speech engine is a host resource shared by every device, so this lives
 * in the app state dir, not per-device localStorage like the other dictation
 * settings. When enabled and a GPU engine is configured, transcription goes
 * to the GPU engine first and falls back to the CPU (OpenWhispr) engine if the
 * GPU engine is offline. When disabled, only the CPU engine is used and the
 * GPU engine process is stopped (see gpu-engine-control.ts) to free VRAM.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { getAppStateDir } from "@/server/app-state";

export const DEFAULT_SPEECH_ENGINE_URL = "ws://127.0.0.1:6006";
export const SPEECH_ENGINE_SETTINGS_FILE = "speech-engine.json";

export interface SpeechEngineSettings {
  gpuAcceleration: boolean;
}

const DEFAULT_SETTINGS: SpeechEngineSettings = { gpuAcceleration: true };

function settingsPath(stateDir: string = getAppStateDir()) {
  return path.join(stateDir, SPEECH_ENGINE_SETTINGS_FILE);
}

/** CPU engine (OpenWhispr's sherpa-onnx server). */
export function resolveSpeechEngineUrl(): string {
  return process.env.SMART_NOTES_SPEECH_ENGINE_URL?.trim() || DEFAULT_SPEECH_ENGINE_URL;
}

/** GPU engine URL, or null when this host has no GPU engine configured. */
export function resolveGpuSpeechEngineUrl(): string | null {
  return process.env.SMART_NOTES_SPEECH_GPU_ENGINE_URL?.trim() || null;
}

export async function readSpeechEngineSettings(stateDir?: string): Promise<SpeechEngineSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(stateDir), "utf8")) as Partial<SpeechEngineSettings>;
    return {
      gpuAcceleration:
        typeof raw.gpuAcceleration === "boolean" ? raw.gpuAcceleration : DEFAULT_SETTINGS.gpuAcceleration,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSpeechEngineSettings(
  settings: SpeechEngineSettings,
  stateDir?: string
): Promise<SpeechEngineSettings> {
  const file = settingsPath(stateDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), "utf8");
  await fs.rename(tmp, file);
  return settings;
}

/**
 * Engine URLs to try, in order. GPU first when enabled and configured, then
 * the CPU engine as the fallback (GPU engine stopped, warming, or crashed).
 */
export async function resolveSpeechEngineTargets(stateDir?: string): Promise<string[]> {
  const cpu = resolveSpeechEngineUrl();
  const gpu = resolveGpuSpeechEngineUrl();
  if (!gpu || gpu === cpu) return [cpu];
  const { gpuAcceleration } = await readSpeechEngineSettings(stateDir);
  return gpuAcceleration ? [gpu, cpu] : [cpu];
}
