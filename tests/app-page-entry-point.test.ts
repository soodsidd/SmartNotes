import fs from "node:fs";
import path from "node:path";

import { appManifestUrl, focusedAppUrl } from "@/lib/api/app";

describe("App focused-shell entry point (SN-187)", () => {
  it("builds an encoded focused-shell URL for the selected App page", () => {
    expect(focusedAppUrl("Notebook/Section/Blank App.html")).toBe(
      "/app?path=Notebook%2FSection%2FBlank%20App.html"
    );
  });

  it("builds an encoded per-page manifest URL for the selected App page", () => {
    expect(appManifestUrl("Notebook/Section/Blank App.html")).toBe(
      "/api/page/app/manifest?path=Notebook%2FSection%2FBlank%20App.html"
    );
  });

  it("exposes the Open-focused-app bridge from the notebook App view via the shared helper", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/components/app-page-view.tsx"),
      "utf8"
    );
    expect(source).toContain("focusedAppUrl(pagePath)");
    expect(source).toContain('data-testid="app-open-focused"');
    // The bridge lives in developer chrome, so it is not rendered in focus mode.
    const chromelessGuard = source.indexOf("chromeless ? (");
    const bridge = source.indexOf('data-testid="app-open-focused"');
    expect(chromelessGuard).toBeGreaterThanOrEqual(0);
    expect(chromelessGuard).toBeLessThan(bridge);
  });
});
