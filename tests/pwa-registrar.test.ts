/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { PwaRegistrar } from "@/components/pwa-registrar";
import {
  clearDeferredInstallPrompt,
  getDeferredInstallPrompt,
} from "@/lib/pwa-install";

beforeEach(() => {
  clearDeferredInstallPrompt();
});

describe("PwaRegistrar", () => {
  it("registers the service worker on load", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const getRegistration = jest.fn().mockResolvedValue(undefined);
    const register = jest.fn().mockResolvedValue({ update });

    Object.defineProperty(window, "navigator", {
      value: {
        serviceWorker: {
          getRegistration,
          register,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
        },
      },
      configurable: true,
    });

    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true,
    });

    render(React.createElement(PwaRegistrar));

    await waitFor(() => {
      expect(getRegistration).toHaveBeenCalledWith("/");
      expect(register).toHaveBeenCalledWith("/service-worker.js", { scope: "/" });
      expect(update).toHaveBeenCalled();
    });
  });

  it("checks for service worker updates when a registration already exists", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const existingRegistration = { update };
    const getRegistration = jest.fn().mockResolvedValue(existingRegistration);
    const register = jest.fn().mockResolvedValue(undefined);

    Object.defineProperty(window, "navigator", {
      value: {
        serviceWorker: {
          getRegistration,
          register,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
        },
      },
      configurable: true,
    });

    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true,
    });

    render(React.createElement(PwaRegistrar));

    await waitFor(() => {
      expect(getRegistration).toHaveBeenCalledWith("/");
      expect(update).toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    });
  });

  it("captures Chrome install prompts for later in-app use", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const getRegistration = jest.fn().mockResolvedValue(undefined);
    const register = jest.fn().mockResolvedValue({ update });

    Object.defineProperty(window, "navigator", {
      value: {
        serviceWorker: {
          getRegistration,
          register,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
        },
      },
      configurable: true,
    });

    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true,
    });

    render(React.createElement(PwaRegistrar));

    const installEvent = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: jest.Mock;
      userChoice: Promise<{ outcome: "accepted"; platform: string }>;
    };
    installEvent.prompt = jest.fn().mockResolvedValue(undefined);
    installEvent.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });

    window.dispatchEvent(installEvent);

    await waitFor(() => {
      expect(installEvent.defaultPrevented).toBe(true);
      expect(getDeferredInstallPrompt()).toBe(installEvent);
    });
  });
});
