"use client";

import * as React from "react";
import { RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getPendingSwBuildId,
  initSwUpdateListener,
  subscribeSwUpdate,
  triggerForceReload,
} from "@/lib/sw-update";

/**
 * SN-85: dismissible "update available" banner. Shown when the controlling
 * service worker detects a newer deployed build. Tapping runs the FORCE_RELOAD
 * sequence (clear cached app shell -> reload) so the next fetch hits the network.
 */
export function SwUpdateBanner() {
  const [pendingBuildId, setPendingBuildId] = React.useState<string | null>(null);
  const [dismissedBuildId, setDismissedBuildId] = React.useState<string | null>(null);
  const [reloading, setReloading] = React.useState(false);

  React.useEffect(() => {
    setPendingBuildId(getPendingSwBuildId());
    const stopListener = initSwUpdateListener();
    const unsubscribe = subscribeSwUpdate((buildId) => setPendingBuildId(buildId));
    return () => {
      unsubscribe();
      stopListener();
    };
  }, []);

  const visible = Boolean(pendingBuildId) && pendingBuildId !== dismissedBuildId;

  const handleReload = React.useCallback(() => {
    setReloading(true);
    void triggerForceReload();
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-3"
      data-testid="sw-update-banner"
      role="status"
      aria-live="polite"
    >
      <div className="flex w-full max-w-md items-center gap-2 rounded-md border border-[color:var(--accent)] bg-background/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={handleReload}
          disabled={reloading}
          data-testid="sw-update-reload"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 text-left text-foreground",
            "hover:text-[color:var(--accent)] disabled:opacity-70"
          )}
        >
          <RotateCw className={cn("size-4 shrink-0", reloading && "animate-spin")} />
          <span className="truncate">
            {reloading ? "Reloading…" : "An update is available — tap to reload."}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setDismissedBuildId(pendingBuildId)}
          aria-label="Dismiss update notice"
          data-testid="sw-update-dismiss"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
