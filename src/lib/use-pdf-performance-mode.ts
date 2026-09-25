"use client";

import * as React from "react";

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
}

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

export interface PdfPerformanceMode {
  enabled: boolean;
  setEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  disable: () => void;
}

export type PdfReaderEscapeAction = "performance" | "annotate" | "outline" | "close";

/** Explicit Escape precedence shared by the reader handler and its tests. */
export function resolvePdfReaderEscapeAction(
  performanceMode: boolean,
  annotateMode: boolean,
  outlineOpen: boolean
): PdfReaderEscapeAction {
  if (performanceMode) return "performance";
  if (annotateMode) return "annotate";
  if (outlineOpen) return "outline";
  return "close";
}

/**
 * Entering performance mode hides the reader bar for an immersive page;
 * leaving restores it. Center-tap still toggles while performance mode is on.
 */
export function controlsVisibleAfterPerformanceChange(enabled: boolean): boolean {
  return !enabled;
}

/** Couple chrome hiding with independently optional fullscreen and wake lock. */
export function usePdfPerformanceMode(
  readerRootRef: React.RefObject<HTMLElement>,
  active: boolean
): PdfPerformanceMode {
  const [enabled, setEnabled] = React.useState(false);
  const wakeLockRef = React.useRef<WakeLockSentinelLike | null>(null);
  const requestedFullscreenRef = React.useRef(false);

  const releaseCapabilities = React.useCallback(async () => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && !lock.released) {
      try {
        await lock.release();
      } catch {
        // Best-effort teardown must never trap the reader.
      }
    }
    const root = readerRootRef.current;
    if (
      typeof document !== "undefined" &&
      document.fullscreenElement &&
      root?.contains(document.fullscreenElement) &&
      typeof document.exitFullscreen === "function"
    ) {
      try {
        await document.exitFullscreen();
      } catch {
        // Native Escape may already be completing fullscreen teardown.
      }
    }
    requestedFullscreenRef.current = false;
  }, [readerRootRef]);

  const disable = React.useCallback(() => setEnabled(false), []);

  React.useEffect(() => {
    if (!active && enabled) setEnabled(false);
  }, [active, enabled]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (enabled && active) document.documentElement.dataset.pdfPerformanceMode = "true";
    else delete document.documentElement.dataset.pdfPerformanceMode;
    return () => {
      delete document.documentElement.dataset.pdfPerformanceMode;
    };
  }, [active, enabled]);

  React.useEffect(() => {
    if (!enabled || !active) {
      void releaseCapabilities();
      return;
    }
    let cancelled = false;
    const root = readerRootRef.current;
    if (root && typeof root.requestFullscreen === "function") {
      requestedFullscreenRef.current = true;
      void root.requestFullscreen().catch(() => {
        requestedFullscreenRef.current = false;
      });
    }
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (wakeLock?.request) {
      void wakeLock.request("screen").then((lock) => {
        if (cancelled) void lock.release().catch(() => undefined);
        else wakeLockRef.current = lock;
      }).catch(() => undefined);
    }
    return () => {
      cancelled = true;
      void releaseCapabilities();
    };
  }, [active, enabled, readerRootRef, releaseCapabilities]);

  React.useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") setEnabled(false);
    };
    const onFullscreenChange = () => {
      if (requestedFullscreenRef.current && !document.fullscreenElement) setEnabled(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [enabled]);

  return { enabled, setEnabled, disable };
}
