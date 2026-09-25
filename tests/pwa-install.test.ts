/**
 * @jest-environment jsdom
 */

import {
  clearDeferredInstallPrompt,
  getPwaInstallState,
  setDeferredInstallPrompt,
} from "@/lib/pwa-install";

function mockStandaloneDisplay(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    value: jest.fn().mockImplementation(() => ({
      matches,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
    configurable: true,
  });
}

describe("PWA install state", () => {
  beforeEach(() => {
    clearDeferredInstallPrompt();
    mockStandaloneDisplay(false);
    Object.defineProperty(window.navigator, "standalone", {
      value: undefined,
      configurable: true,
    });
  });

  it("reports installed when the app is already in standalone display mode", () => {
    mockStandaloneDisplay(true);

    expect(getPwaInstallState()).toBe("installed");
  });

  it("reports install available when Chrome has fired beforeinstallprompt", () => {
    const installEvent = new Event("beforeinstallprompt") as Event & {
      prompt: jest.Mock;
    };
    installEvent.prompt = jest.fn().mockResolvedValue(undefined);

    setDeferredInstallPrompt(installEvent);

    expect(getPwaInstallState()).toBe("available");
  });

  it("reports unavailable when the browser only supports shortcut creation", () => {
    expect(getPwaInstallState()).toBe("unavailable");
  });
});
