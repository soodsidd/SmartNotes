/**
 * @jest-environment jsdom
 *
 * SN-37: Reading density themes — preference persistence integration tests.
 */

import { resolveInitialDensity, applyDensity } from "@/components/density-provider";

const STORAGE_KEY = "smart-notes-density";

beforeEach(() => {
  document.documentElement.removeAttribute("data-density");
  localStorage.clear();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-density");
  localStorage.clear();
});

describe("reading density preference (SN-37)", () => {
  test("defaults to 'normal' when no stored value", () => {
    expect(resolveInitialDensity()).toBe("normal");
  });

  test("reads stored 'compact' from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "compact");
    expect(resolveInitialDensity()).toBe("compact");
  });

  test("reads stored 'comfortable' from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "comfortable");
    expect(resolveInitialDensity()).toBe("comfortable");
  });

  test("reads stored 'normal' from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "normal");
    expect(resolveInitialDensity()).toBe("normal");
  });

  test("ignores unknown stored values and returns normal", () => {
    localStorage.setItem(STORAGE_KEY, "huge");
    expect(resolveInitialDensity()).toBe("normal");
  });

  test("applyDensity sets data-density='compact' on documentElement", () => {
    applyDensity("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  test("applyDensity sets data-density='comfortable' on documentElement", () => {
    applyDensity("comfortable");
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  test("applyDensity sets data-density='normal' on documentElement", () => {
    applyDensity("normal");
    expect(document.documentElement.dataset.density).toBe("normal");
  });

  test("density provider source exports DensityProvider and useDensity", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src: string = fs.readFileSync(
      path.resolve(__dirname, "../src/components/density-provider.tsx"),
      "utf8"
    );
    expect(src).toContain("export function DensityProvider");
    expect(src).toContain("export function useDensity");
    expect(src).toContain(STORAGE_KEY);
  });

  test("settings dialog exposes font size controls backed by density provider", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src: string = fs.readFileSync(
      path.resolve(__dirname, "../src/components/app-settings-dialog.tsx"),
      "utf8"
    );
    expect(src).toContain("useDensity");
    expect(src).toContain("settings-density-${option.value}");
  });

  test("globals.css preserves mobile density sizes and adds desktop-only editor scale overrides", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const css: string = fs.readFileSync(
      path.resolve(__dirname, "../src/app/globals.css"),
      "utf8"
    );
    const tokens: string = fs.readFileSync(
      path.resolve(__dirname, "../src/styles/tokens.css"),
      "utf8"
    );
    expect(css).toContain('[data-density="compact"] .editor-content');
    expect(css).toContain('[data-density="comfortable"] .editor-content');
    expect(tokens).toContain("--editor-density-compact: 13px");
    expect(tokens).toContain("--editor-density-normal: 16px");
    expect(tokens).toContain("--editor-density-comfortable: 20px");
    expect(css).toContain("@media (min-width: 1280px)");
    expect(tokens).toContain("--desktop-editor-density-compact: 12px");
    expect(tokens).toContain("--desktop-editor-density-normal: 15px");
    expect(tokens).toContain("--desktop-editor-density-comfortable: 18px");
  });

  test("desktop sidebar density is opt-in so the mobile sheet keeps existing row metrics", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src: string = fs.readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );
    expect(src).toContain('variant="desktop"');
    expect(src).toContain('variant?: "desktop" | "mobile"');
    expect(src).toContain("const compactDesktop = variant === \"desktop\"");
    expect(src).toContain("var(--desktop-tree-indent-step)");
    expect(src).toContain("min-h-[var(--desktop-tree-page-row-height)]");
  });
});
