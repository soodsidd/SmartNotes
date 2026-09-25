"use client";

/**
 * Reload-guard drain registry (SN-85 reviewer fix).
 *
 * Before the app executes a hard reload (SW update banner, Settings → Reload
 * app), it gives mounted editors a chance to flush any in-memory draft so no
 * changes are silently discarded.  Editors register a drain function via
 * {@link registerReloadDrain} on mount and deregister via the returned cleanup
 * when they unmount.
 *
 * {@link triggerForceReload} in sw-update.ts calls {@link drainBeforeReload}
 * before window.location.reload() so the guard runs at every reload site
 * automatically — callers never need to check dirty state themselves.
 */

export type ReloadDrainFn = () => Promise<void>;

const drains = new Set<ReloadDrainFn>();

/**
 * Register a drain that will be awaited before any forced reload.
 * Returns a cleanup function that deregisters the drain (call it on unmount).
 */
export function registerReloadDrain(fn: ReloadDrainFn): () => void {
  drains.add(fn);
  return () => {
    drains.delete(fn);
  };
}

export interface DrainResult {
  ok: boolean;
  errorMessage: string | null;
}

/**
 * Run every registered drain concurrently.
 *
 * - Resolves `{ ok: true }` when all drains complete without throwing.
 * - Resolves `{ ok: false, errorMessage }` when any drain throws (e.g. the
 *   network is down and the vault write could not reach the server).
 */
export async function drainBeforeReload(): Promise<DrainResult> {
  const fns = Array.from(drains);
  if (fns.length === 0) {
    return { ok: true, errorMessage: null };
  }

  const results = await Promise.allSettled(fns.map((fn) => fn()));
  const firstRejected = results.find(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );

  if (firstRejected) {
    const reason: unknown = firstRejected.reason;
    return {
      ok: false,
      errorMessage:
        reason instanceof Error ? reason.message : "Failed to save changes.",
    };
  }

  return { ok: true, errorMessage: null };
}

/** Test-only: empty the drain registry between tests. */
export function __resetReloadGuardForTests(): void {
  drains.clear();
}
