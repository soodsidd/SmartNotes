/**
 * @jest-environment jsdom
 */
import {
  DEFAULT_PRINT_SETTINGS,
  applyPrintLayoutStyles,
  clearPrintLayoutStyles,
  getLineHeightValue,
  getMarginCssValue,
  LINE_HEIGHT_PRESET_VALUES,
  MARGIN_PRESET_VALUES,
  loadPrintSettings,
  savePrintSettings,
  type PrintSettings,
} from "@/lib/print-settings";

describe("getMarginCssValue", () => {
  test("returns preset values for narrow / normal / wide", () => {
    expect(getMarginCssValue({ ...DEFAULT_PRINT_SETTINGS, marginPreset: "narrow" })).toBe(
      MARGIN_PRESET_VALUES.narrow
    );
    expect(getMarginCssValue({ ...DEFAULT_PRINT_SETTINGS, marginPreset: "normal" })).toBe(
      MARGIN_PRESET_VALUES.normal
    );
    expect(getMarginCssValue({ ...DEFAULT_PRINT_SETTINGS, marginPreset: "wide" })).toBe(
      MARGIN_PRESET_VALUES.wide
    );
  });

  test("returns custom value in inches for custom preset", () => {
    expect(
      getMarginCssValue({ ...DEFAULT_PRINT_SETTINGS, marginPreset: "custom", customMarginIn: 1.25 })
    ).toBe("1.25in");
  });

  test("clamps custom margin to 0.1–3in range", () => {
    expect(
      getMarginCssValue({ ...DEFAULT_PRINT_SETTINGS, marginPreset: "custom", customMarginIn: 0 })
    ).toBe("0.1in");
    expect(
      getMarginCssValue({ ...DEFAULT_PRINT_SETTINGS, marginPreset: "custom", customMarginIn: 5 })
    ).toBe("3in");
  });
});

describe("getLineHeightValue", () => {
  test("returns correct numeric values for each preset", () => {
    expect(
      getLineHeightValue({ ...DEFAULT_PRINT_SETTINGS, lineHeightPreset: "compact" })
    ).toBe(LINE_HEIGHT_PRESET_VALUES.compact);
    expect(
      getLineHeightValue({ ...DEFAULT_PRINT_SETTINGS, lineHeightPreset: "normal" })
    ).toBe(LINE_HEIGHT_PRESET_VALUES.normal);
    expect(
      getLineHeightValue({ ...DEFAULT_PRINT_SETTINGS, lineHeightPreset: "relaxed" })
    ).toBe(LINE_HEIGHT_PRESET_VALUES.relaxed);
  });
});

describe("loadPrintSettings / savePrintSettings", () => {
  beforeEach(() => localStorage.clear());

  test("returns defaults when localStorage is empty", () => {
    expect(loadPrintSettings()).toEqual(DEFAULT_PRINT_SETTINGS);
  });

  test("round-trips custom settings through localStorage", () => {
    const custom: PrintSettings = {
      marginPreset: "custom",
      customMarginIn: 1.1,
      lineHeightPreset: "relaxed",
    };
    savePrintSettings(custom);
    expect(loadPrintSettings()).toEqual(custom);
  });

  test("falls back to defaults for unknown / corrupt preset values", () => {
    localStorage.setItem(
      "sn:print-settings:v1",
      JSON.stringify({ marginPreset: "invalid", lineHeightPreset: "huge" })
    );
    const result = loadPrintSettings();
    expect(result.marginPreset).toBe(DEFAULT_PRINT_SETTINGS.marginPreset);
    expect(result.lineHeightPreset).toBe(DEFAULT_PRINT_SETTINGS.lineHeightPreset);
  });

  test("falls back to defaults when localStorage contains invalid JSON", () => {
    localStorage.setItem("sn:print-settings:v1", "not-json");
    expect(loadPrintSettings()).toEqual(DEFAULT_PRINT_SETTINGS);
  });
});

describe("applyPrintLayoutStyles / clearPrintLayoutStyles", () => {
  afterEach(() => {
    clearPrintLayoutStyles();
  });

  test("injects a <style> element with the correct @page margin", () => {
    applyPrintLayoutStyles({ ...DEFAULT_PRINT_SETTINGS, marginPreset: "narrow" });
    const el = document.getElementById("sn-print-layout-style") as HTMLStyleElement | null;
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("@page");
    expect(el?.textContent).toContain(MARGIN_PRESET_VALUES.narrow);
  });

  test("sets --print-body-line-height CSS custom property on documentElement", () => {
    applyPrintLayoutStyles({ ...DEFAULT_PRINT_SETTINGS, lineHeightPreset: "compact" });
    expect(
      document.documentElement.style.getPropertyValue("--print-body-line-height")
    ).toBe(String(LINE_HEIGHT_PRESET_VALUES.compact));
  });

  test("clearPrintLayoutStyles removes the injected style and CSS variable", () => {
    applyPrintLayoutStyles(DEFAULT_PRINT_SETTINGS);
    clearPrintLayoutStyles();
    expect(document.getElementById("sn-print-layout-style")).toBeNull();
    expect(
      document.documentElement.style.getPropertyValue("--print-body-line-height")
    ).toBe("");
  });

  test("custom margin value appears in the injected @page rule", () => {
    applyPrintLayoutStyles({
      marginPreset: "custom",
      customMarginIn: 1.5,
      lineHeightPreset: "normal",
    });
    const el = document.getElementById("sn-print-layout-style") as HTMLStyleElement;
    expect(el.textContent).toContain("1.5in");
  });
});

describe("globals.css print line-height variable", () => {
  test("globals.css uses var(--print-body-line-height) for print editor-content line-height (SN-97)", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain("var(--print-body-line-height");
  });
});
