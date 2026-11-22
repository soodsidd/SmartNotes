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
import { __resetReloadGuardForTests, registerReloadDrain } from "@/lib/reload-guard";

jest.mock("@/lib/draw-mode-debug", () => ({ logDrawEvent: jest.fn() }));

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

  describe("SN-416: worker swap in the installed PWA", () => {
    const originalEnv = process.env.NODE_ENV;
    let reload: jest.Mock;

    function mountWithController(controller: object | null) {
      const listeners: Record<string, () => unknown> = {};
      Object.defineProperty(window, "navigator", {
        value: {
          serviceWorker: {
            controller,
            getRegistration: jest.fn().mockResolvedValue({ update: jest.fn().mockResolvedValue(undefined) }),
            register: jest.fn(),
            addEventListener: (type: string, fn: () => unknown) => { listeners[type] = fn; },
            removeEventListener: jest.fn(),
          },
        },
        configurable: true,
      });
      Object.defineProperty(document, "readyState", { value: "complete", configurable: true });
      render(React.createElement(PwaRegistrar));
      return () => listeners.controllerchange();
    }

    beforeEach(() => {
      __resetReloadGuardForTests();
      (process.env as Record<string, string>).NODE_ENV = "production";
      // jsdom's location is unforgeable; reload() surfaces as a "Not implemented:
      // navigation" virtual-console error, which is the observable reload signal.
      reload = jest.fn();
      jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        if (String((args[0] as { message?: string })?.message ?? args[0]).includes("Not implemented: navigation")) {
          reload();
        }
      });
    });

    afterEach(() => {
      (process.env as Record<string, string>).NODE_ENV = originalEnv as string;
      jest.restoreAllMocks();
    });

    it("does not reload a freshly loaded page on the first-install claim", async () => {
      const fireControllerChange = mountWithController(null);
      await fireControllerChange();
      expect(reload).not.toHaveBeenCalled();
    });

    it("flushes pending ink/text saves before reloading for an update", async () => {
      const order: string[] = [];
      registerReloadDrain(async () => { order.push("drain"); });
      reload.mockImplementation(() => order.push("reload"));
      const fireControllerChange = mountWithController({});
      await fireControllerChange();
      expect(order).toEqual(["drain", "reload"]);
    });

    it("keeps the page instead of discarding strokes when the flush fails", async () => {
      registerReloadDrain(async () => { throw new Error("offline"); });
      const fireControllerChange = mountWithController({});
      await fireControllerChange();
      expect(reload).not.toHaveBeenCalled();
    });

    it("retries a later update after an earlier flush failed", async () => {
      let failNext = true;
      registerReloadDrain(async () => {
        if (failNext) {
          failNext = false;
          throw new Error("offline");
        }
      });
      const fireControllerChange = mountWithController({});
      await fireControllerChange();
      expect(reload).not.toHaveBeenCalled();
      await fireControllerChange();
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
