/** @jest-environment jsdom */

import {
  cookiesAvailable,
  jupyterFrameHostClassName,
  unsupportedBrowserReason,
} from "@/lib/jupyter-browser-support";

describe("jupyter browser support (SN-360)", () => {
  const originalCookieEnabled = Object.getOwnPropertyDescriptor(Navigator.prototype, "cookieEnabled")
    ?? Object.getOwnPropertyDescriptor(navigator, "cookieEnabled");

  afterEach(() => {
    if (originalCookieEnabled) {
      Object.defineProperty(navigator, "cookieEnabled", originalCookieEnabled);
    }
    document.cookie.split(";").forEach((part) => {
      const name = part.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
    });
  });

  it("accepts browsers with WebSocket and cookieEnabled", () => {
    Object.defineProperty(navigator, "cookieEnabled", { configurable: true, get: () => true });
    expect(unsupportedBrowserReason()).toBeNull();
  });

  it("does not hard-fail when cookieEnabled is false but a probe cookie sticks", () => {
    Object.defineProperty(navigator, "cookieEnabled", { configurable: true, get: () => false });
    // jsdom allows document.cookie writes; probe should succeed.
    expect(cookiesAvailable()).toBe(true);
    expect(unsupportedBrowserReason()).toBeNull();
  });

  it("reports unsupported when WebSocket is missing", () => {
    const ws = window.WebSocket;
    // @ts-expect-error deliberate delete for capability probe
    delete window.WebSocket;
    try {
      expect(unsupportedBrowserReason()).toMatch(/WebSocket support is unavailable/);
    } finally {
      window.WebSocket = ws;
    }
  });

  it("keeps inactive frame hosts laid out instead of display:none", () => {
    const active = jupyterFrameHostClassName(true);
    const inactive = jupyterFrameHostClassName(false);
    expect(active).toContain("flex-1");
    expect(active).toContain("relative");
    expect(inactive).toContain("invisible");
    expect(inactive).toContain("absolute");
    expect(inactive).toContain("inset-0");
    expect(inactive).not.toContain("hidden");
    expect(active.split(/\s+/)).not.toContain("hidden");
  });
});

describe("jupyter surface height contract (SN-360)", () => {
  it("gives a visible frame host non-zero height inside a flex shell", () => {
    // Mimic page-main → content → jupyter-surface → host (production classes).
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:640px;width:390px">
        <div style="display:flex;flex:1;min-height:0;flex-direction:column" data-testid="page-main">
          <div style="height:48px;flex-shrink:0">topbar</div>
          <div style="display:flex;flex:1;min-height:0;flex-direction:column">
            <div data-testid="jupyter-surface" class="relative flex min-h-0 flex-1 flex-col" style="display:flex;flex:1;min-height:0;flex-direction:column;position:relative">
              <div data-testid="jupyter-frame-host" class="${jupyterFrameHostClassName(true)}" style="display:flex;flex:1;min-height:0;flex-direction:column;position:relative">
                <div style="flex:1;min-height:0;height:100%;position:relative">
                  <iframe data-testid="jupyter-frame" style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    // jsdom does not compute flex layout; assert the contract classes that
    // restore height on real mobile WebKit instead of a pixel measurement.
    const surface = document.querySelector('[data-testid="jupyter-surface"]');
    const host = document.querySelector('[data-testid="jupyter-frame-host"]');
    expect(surface?.className).toMatch(/flex-1/);
    expect(surface?.className).toMatch(/min-h-0/);
    expect(host?.className).toMatch(/flex-1/);
    expect(host?.className).toMatch(/relative/);
    expect(host?.getAttribute("hidden")).toBeNull();
  });
});
