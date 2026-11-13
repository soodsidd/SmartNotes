import { NextResponse } from "next/server";

import {
  readSpeechEngineSettings,
  resolveGpuSpeechEngineUrl,
  writeSpeechEngineSettings,
} from "@/server/speech/engine-settings";
import { probeGpuEngine, startGpuEngine, stopGpuEngine } from "@/server/speech/gpu-engine-control";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Dictation GPU acceleration (PC-wide). GET reports the setting and whether
 * the GPU engine is accepting connections; PUT `{ gpuAcceleration }` persists
 * the setting and starts or stops the GPU engine (stopping frees its VRAM).
 */
async function snapshot(extra: Record<string, unknown> = {}) {
  const gpuUrl = resolveGpuSpeechEngineUrl();
  const { gpuAcceleration } = await readSpeechEngineSettings();
  return {
    gpuAvailable: Boolean(gpuUrl),
    gpuAcceleration,
    gpuEngine: gpuUrl ? await probeGpuEngine(gpuUrl) : "stopped",
    ...extra,
  };
}

export async function GET() {
  return NextResponse.json(await snapshot());
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { gpuAcceleration?: unknown } | null;
  if (typeof body?.gpuAcceleration !== "boolean") {
    return NextResponse.json({ error: "gpuAcceleration must be a boolean." }, { status: 400 });
  }
  if (!resolveGpuSpeechEngineUrl()) {
    return NextResponse.json({ error: "No GPU speech engine is configured on this host." }, { status: 409 });
  }
  // Persist first so routing switches immediately, even if engine control fails.
  await writeSpeechEngineSettings({ gpuAcceleration: body.gpuAcceleration });
  let controlError: string | undefined;
  try {
    if (body.gpuAcceleration) await startGpuEngine();
    else await stopGpuEngine();
  } catch (error) {
    controlError = error instanceof Error ? error.message : "GPU engine control failed.";
  }
  return NextResponse.json(await snapshot(controlError ? { controlError } : {}));
}
