"use client";

import { useEffect } from "react";
import {
  clearDeferredInstallPrompt,
  setDeferredInstallPrompt,
  type DeferredInstallPrompt,
} from "@/lib/pwa-install";
import { logDrawEvent } from "@/lib/draw-mode-debug";
import { drainBeforeReload } from "@/lib/reload-guard";

export function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let isReloadingForUpdate = false;
    // SN-416: a first-install claim swaps in a worker for a page that was
    // already loaded from the network, so there is nothing stale to reload.
    const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);

    const handleControllerChange = async () => {
      if (process.env.NODE_ENV !== "production" || isReloadingForUpdate) {
        return;
      }

      if (!hadControllerAtLoad) {
        logDrawEvent("pwa.controllerchange", { action: "skip-first-claim" });
        return;
      }

      // SN-416: never hard-reload under the user. Unsaved ink strokes and text
      // drafts are flushed first; if that fails, keep the page rather than
      // silently discarding them (the update banner can still reload later).
      isReloadingForUpdate = true;
      const drain = await drainBeforeReload();
      logDrawEvent("pwa.controllerchange", {
        action: drain.ok ? "drained-reload" : "drain-failed-stay",
      });
      if (!drain.ok) {
        // Release the guard so a later controllerchange (next deploy) can retry.
        isReloadingForUpdate = false;
        return;
      }
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    const registerServiceWorker = () => {
      navigator.serviceWorker
        .getRegistration("/")
        .then((existingRegistration) => {
          const registrationPromise = existingRegistration
            ? Promise.resolve(existingRegistration)
            : navigator.serviceWorker.register("/service-worker.js", { scope: "/" });

          return registrationPromise.then((registration) => {
            void registration.update();
            return registration;
          });
        })
        .catch(() => {
          // Registration failures should not break the normal browser flow.
        });
    };

    if (document.readyState === "complete") {
      registerServiceWorker();
    } else {
      window.addEventListener("load", registerServiceWorker, { once: true });
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as DeferredInstallPrompt);
    };

    const handleAppInstalled = () => {
      clearDeferredInstallPrompt();
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("load", registerServiceWorker);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  return null;
}
