"use client";

import { useEffect } from "react";
import {
  clearDeferredInstallPrompt,
  setDeferredInstallPrompt,
  type DeferredInstallPrompt,
} from "@/lib/pwa-install";

export function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let isReloadingForUpdate = false;

    const handleControllerChange = () => {
      if (process.env.NODE_ENV !== "production" || isReloadingForUpdate) {
        return;
      }

      isReloadingForUpdate = true;
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
