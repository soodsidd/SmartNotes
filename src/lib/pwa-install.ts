"use client";

export type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export const PWA_INSTALL_PROMPT_EVENT = "smart-notes:pwa-install-prompt-change";

declare global {
  interface Window {
    __smartNotesDeferredInstallPrompt?: DeferredInstallPrompt | null;
  }

  interface Navigator {
    standalone?: boolean;
  }
}

export function getDeferredInstallPrompt() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.__smartNotesDeferredInstallPrompt ?? null;
}

export function setDeferredInstallPrompt(promptEvent: DeferredInstallPrompt | null) {
  if (typeof window === "undefined") {
    return;
  }

  window.__smartNotesDeferredInstallPrompt = promptEvent;
  window.dispatchEvent(
    new CustomEvent(PWA_INSTALL_PROMPT_EVENT, {
      detail: { available: Boolean(promptEvent) },
    })
  );
}

export function clearDeferredInstallPrompt() {
  setDeferredInstallPrompt(null);
}

export function isStandaloneDisplay() {
  if (typeof window === "undefined") {
    return false;
  }

  const mediaMatch =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;

  return Boolean(mediaMatch || navigator.standalone);
}

export function getPwaInstallState() {
  if (isStandaloneDisplay()) {
    return "installed" as const;
  }

  if (getDeferredInstallPrompt()) {
    return "available" as const;
  }

  return "unavailable" as const;
}
