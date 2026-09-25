/**
 * SN-247 — thin, typed wrapper around packages/cli-chat/fast-lane.js.
 *
 * See that module's header comment for the full design. This file exists so
 * Next.js API routes (src/app/api/companion/fast-lane/**) get typed function
 * signatures instead of requiring the CJS module directly, mirroring how
 * src/server/jupyter/runtime.ts wraps the Jupyter session registry. Session
 * state itself lives in fast-lane.js's own globalThis registry (not here) so
 * it survives Next.js route-module reloads exactly like the Jupyter runtime.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import type { JupyterFocusState } from "@/lib/jupyter-focus";
import {
  clearAllJupyterInlineContext,
  clearJupyterInlineContext,
  prepareJupyterInlinePrompt,
} from "@/server/ai/jupyter-inline-context";

const fastLane = require("../../../packages/cli-chat/fast-lane") as {
  ensureWarm: (pagePath: string) => Promise<{ status: string; sessionId: string | null; ttftMs?: number | null }>;
  sendMessage: (
    pagePath: string,
    message: string,
    options?: { signal?: AbortSignal; onText?: (chunk: string) => void }
  ) => Promise<{ text: string; sessionId: string | null; ttftMs: number | null; durationMs: number }>;
  closeSession: (pagePath: string) => { closed: boolean };
  closeAllSessions: () => { closed: number };
  getFastLaneSettings: () => FastLaneSettings;
  updateFastLaneSettings: (data: Partial<FastLaneSettings>) => FastLaneSettings;
};

export interface FastLaneSettings {
  fastLaneProvider: string;
  fastLaneModel: string;
  fastLaneEffort: string;
}

export interface FastLaneWarmResult {
  status: string;
  sessionId: string | null;
  ttftMs?: number | null;
}

export interface FastLaneSendResult {
  text: string;
  sessionId: string | null;
  ttftMs: number | null;
  durationMs: number;
}

/** Warm the fast-lane session for an open Jupyter page (call on page open). */
export async function ensureJupyterFastLaneWarm(pagePath: string): Promise<FastLaneWarmResult> {
  return fastLane.ensureWarm(pagePath);
}

/**
 * Send a prompt through the warmed (or falling-back-to-cold) fast lane.
 *
 * SN-253: pass `onText` to receive live answer deltas as the model produces
 * them. Each call carries only newly appended text; the resolved `text` is
 * still the complete answer, so callers may ignore the stream entirely.
 */
export async function sendJupyterFastLaneMessage(
  pagePath: string,
  message: string,
  options?: {
    signal?: AbortSignal;
    context?: JupyterFocusState | null;
    onText?: (chunk: string) => void;
  }
): Promise<FastLaneSendResult> {
  const prepared = prepareJupyterInlinePrompt(pagePath, message, options?.context ?? null);
  const result = await fastLane.sendMessage(pagePath, prepared.prompt, {
    signal: options?.signal,
    onText: options?.onText,
  });
  prepared.commit();
  return result;
}

/** Tear down the fast-lane session for one page (call on page close). */
export function closeJupyterFastLaneSession(pagePath: string): { closed: boolean } {
  const result = fastLane.closeSession(pagePath);
  clearJupyterInlineContext(pagePath);
  return result;
}

/** Tear down every fast-lane session owned by this app process. */
export function closeAllJupyterFastLaneSessions(): { closed: number } {
  const result = fastLane.closeAllSessions();
  clearAllJupyterInlineContext();
  return result;
}

export function getJupyterFastLaneSettings(): FastLaneSettings {
  return fastLane.getFastLaneSettings();
}

export function updateJupyterFastLaneSettings(data: Partial<FastLaneSettings>): FastLaneSettings {
  const result = fastLane.updateFastLaneSettings(data);
  clearAllJupyterInlineContext();
  return result;
}
