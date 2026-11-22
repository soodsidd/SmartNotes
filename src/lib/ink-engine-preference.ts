import type { InkEngineId } from "@/lib/ink-engine";

export const DEFAULT_INK_ENGINE = "tldraw";
export const INK_ENGINE_STORAGE_KEY = "smart-notes:ink-engine";
export const INK_ENGINE_OPTIONS = [
  { id: "tldraw", label: "tldraw" },
  { id: "smart-notes", label: "Smart Notes ink" },
] as const;

export type AvailableInkEngineId = InkEngineId;

export function isInkEngineAvailable(value: unknown): value is AvailableInkEngineId {
  return INK_ENGINE_OPTIONS.some(({ id }) => id === value);
}

export function readInkEngine(): AvailableInkEngineId {
  try {
    const stored = window.localStorage.getItem(INK_ENGINE_STORAGE_KEY);
    if (isInkEngineAvailable(stored)) return stored;
  } catch {
    // Storage can be unavailable during SSR or in restricted browser contexts.
  }
  return DEFAULT_INK_ENGINE;
}

/** Keep the current surface mounted if its pending ink cannot be saved. */
export async function changeInkEngine(
  current: InkEngineId,
  requested: InkEngineId,
  flush: () => Promise<void>
): Promise<AvailableInkEngineId> {
  if (!isInkEngineAvailable(requested) || requested === current) {
    return isInkEngineAvailable(current) ? current : DEFAULT_INK_ENGINE;
  }
  await flush();
  window.localStorage.setItem(INK_ENGINE_STORAGE_KEY, requested);
  return requested;
}
