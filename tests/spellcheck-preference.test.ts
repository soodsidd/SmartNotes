/**
 * @jest-environment jsdom
 *
 * SN-130: Text-editor spellcheck preference — persistence and settings wiring.
 */

import {
  resolveInitialSpellcheck,
  SPELLCHECK_STORAGE_KEY,
} from "@/components/spellcheck-provider";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("spellcheck preference (SN-130)", () => {
  test("defaults to enabled when no stored value", () => {
    expect(resolveInitialSpellcheck()).toBe(true);
  });

  test("reads stored false from localStorage", () => {
    localStorage.setItem(SPELLCHECK_STORAGE_KEY, "false");
    expect(resolveInitialSpellcheck()).toBe(false);
  });

  test("reads stored true from localStorage", () => {
    localStorage.setItem(SPELLCHECK_STORAGE_KEY, "true");
    expect(resolveInitialSpellcheck()).toBe(true);
  });

  test("ignores unknown stored values and returns enabled", () => {
    localStorage.setItem(SPELLCHECK_STORAGE_KEY, "maybe");
    expect(resolveInitialSpellcheck()).toBe(true);
  });

  test("spellcheck provider source exports provider and storage key", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src: string = fs.readFileSync(
      path.resolve(__dirname, "../src/components/spellcheck-provider.tsx"),
      "utf8"
    );
    expect(src).toContain("export function SpellcheckProvider");
    expect(src).toContain("export function useSpellcheck");
    expect(src).toContain("export function useSpellcheckEnabled");
    expect(src).toContain(SPELLCHECK_STORAGE_KEY);
  });

  test("settings dialog exposes spellcheck toggle backed by spellcheck provider", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src: string = fs.readFileSync(
      path.resolve(__dirname, "../src/components/app-settings-dialog.tsx"),
      "utf8"
    );
    expect(src).toContain("useSpellcheck");
    expect(src).toContain('data-testid="settings-spellcheck-toggle"');
    expect(src).toContain('role="switch"');
  });

  test("rich text editor applies spellcheck attribute from preference", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src: string = fs.readFileSync(
      path.resolve(__dirname, "../src/components/rich-text-editor.tsx"),
      "utf8"
    );
    expect(src).toContain("useSpellcheckEnabled");
    expect(src).toContain('spellcheck: spellcheckEnabled ? "true" : "false"');
    expect(src).toContain('setAttribute("spellcheck"');
  });

  test("layout wraps the app with SpellcheckProvider", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src: string = fs.readFileSync(
      path.resolve(__dirname, "../src/app/layout.tsx"),
      "utf8"
    );
    expect(src).toContain("SpellcheckProvider");
  });
});
