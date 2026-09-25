"use client";

/**
 * Service-worker update detection + manual escape hatch (SN-85).
 *
 * The controlling service worker polls /api/version on every navigation and,
 * when the deployed build id differs from its own baked-in BUILD_ID, posts a
 * `SW_UPDATE_AVAILABLE` message to its window clients. {@link initSwUpdateListener}
 * surfaces that as a dismissible "update available" banner.
 *
 * {@link triggerForceReload} is the manual escape hatch used by both the banner
 * and the Settings → Reload app button: it asks the SW to drop the cached app
 * shell entry for "/" and then reloads the page so the next navigation hits the
 * network and picks up the new build.
 *
 * Before reloading, {@link triggerForceReload} calls {@link drainBeforeReload}
 * so any mounted editor can flush its in-memory draft to the vault.  If the
 * flush fails (e.g. the server is unreachable), the user is prompted to confirm
 * before their unsaved changes are discarded — the stale-shell recovery path
 * must not create a new data-loss path.
 */

import { drainBeforeReload } from "@/lib/reload-guard";

export const SW_UPDATE_AVAILABLE = "SW_UPDATE_AVAILABLE";
export const SW_FORCE_RELOAD = "FORCE_RELOAD";

export type SwUpdateListener = (buildId: string) => void;

let pendingBuildId: string | null = null;
const listeners = new Set<SwUpdateListener>();

export function getPendingSwBuildId(): string | null {
  return pendingBuildId;
}

export function subscribeSwUpdate(listener: SwUpdateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(buildId: string) {
  pendingBuildId = buildId;
  for (const listener of listeners) {
    listener(buildId);
  }
}

/**
 * Begin listening for SW_UPDATE_AVAILABLE messages from the controlling worker.
 * Returns an unsubscribe function. Safe to call when service workers are
 * unavailable (returns a no-op cleanup).
 */
export function initSwUpdateListener(): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; buildId?: unknown } | null;
    if (data && data.type === SW_UPDATE_AVAILABLE && typeof data.buildId === "string") {
      notify(data.buildId);
    }
  };

  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

/**
 * Ask the service worker to clear the cached app shell for "/" and then reload.
 * Falls back to a plain reload when no controller is present (no SW, or first
 * load before the SW takes control).
 *
 * Before reloading, all registered reload-guard drains are awaited so mounted
 * editors can flush in-memory drafts.  If any drain fails the user is shown a
 * confirm dialog before their unsaved changes are discarded.
 */
export async function triggerForceReload(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  // Flush in-memory edits before the hard reload so no unsaved work is lost.
  // If the drain fails (e.g. the network is down and the vault write could not
  // reach the server), ask the user before discarding.
  const drain = await drainBeforeReload();
  if (!drain.ok) {
    const detail = drain.errorMessage ? ` (${drain.errorMessage})` : "";
    // eslint-disable-next-line no-alert
    const proceed = window.confirm(
      `Could not save all changes before reloading${detail}. Reload anyway and discard unsaved changes?`
    );
    if (!proceed) {
      return;
    }
  }

  const controller =
    typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker.controller
      : null;

  // Keep vault PDF Cache Storage across Reload app. Clearing it forced a full
  // re-download of large books (~34MB) on every update and made reopen ~1 min
  // (SN-151). Corrupt entries are rejected by isCompletePdfBuffer; use
  // clearPdfVaultCaches() only for an explicit recovery action.

  if (!controller) {
    window.location.reload();
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = finish;
      controller.postMessage({ type: SW_FORCE_RELOAD }, [channel.port2]);
    } catch {
      finish();
    }

    // Reload even if the worker never acknowledges, so the escape hatch never hangs.
    window.setTimeout(finish, 1500);
  });

  window.location.reload();
}
