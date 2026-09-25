export type MarginPreset = "narrow" | "normal" | "wide" | "custom";
export type LineHeightPreset = "compact" | "normal" | "relaxed";

export interface PrintSettings {
  marginPreset: MarginPreset;
  customMarginIn: number;
  lineHeightPreset: LineHeightPreset;
}

export const MARGIN_PRESET_VALUES: Record<Exclude<MarginPreset, "custom">, string> = {
  narrow: "0.5in",
  normal: "0.75in",
  wide: "1in",
};

export const LINE_HEIGHT_PRESET_VALUES: Record<LineHeightPreset, number> = {
  compact: 1.4,
  normal: 1.72,
  relaxed: 2.0,
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  marginPreset: "normal",
  customMarginIn: 0.75,
  lineHeightPreset: "normal",
};

const STORAGE_KEY = "sn:print-settings:v1";
const PRINT_STYLE_ID = "sn-print-layout-style";
const PRINT_LH_VAR = "--print-body-line-height";

export function loadPrintSettings(): PrintSettings {
  if (typeof window === "undefined") return { ...DEFAULT_PRINT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PRINT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<PrintSettings>;
    return {
      marginPreset: isValidMarginPreset(parsed.marginPreset)
        ? parsed.marginPreset
        : DEFAULT_PRINT_SETTINGS.marginPreset,
      customMarginIn:
        typeof parsed.customMarginIn === "number" && parsed.customMarginIn > 0
          ? parsed.customMarginIn
          : DEFAULT_PRINT_SETTINGS.customMarginIn,
      lineHeightPreset: isValidLineHeightPreset(parsed.lineHeightPreset)
        ? parsed.lineHeightPreset
        : DEFAULT_PRINT_SETTINGS.lineHeightPreset,
    };
  } catch {
    return { ...DEFAULT_PRINT_SETTINGS };
  }
}

export function savePrintSettings(settings: PrintSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable (private browsing quota, etc.)
  }
}

export function getMarginCssValue(settings: PrintSettings): string {
  if (settings.marginPreset === "custom") {
    const clamped = Math.max(0.1, Math.min(3, settings.customMarginIn));
    return `${clamped}in`;
  }
  return MARGIN_PRESET_VALUES[settings.marginPreset];
}

export function getLineHeightValue(settings: PrintSettings): number {
  return LINE_HEIGHT_PRESET_VALUES[settings.lineHeightPreset];
}

export function applyPrintLayoutStyles(settings: PrintSettings): void {
  if (typeof document === "undefined") return;

  // CSS custom properties are not supported inside @page rules, so inject a
  // dynamic <style> element with the resolved margin value instead.
  let styleEl = document.getElementById(PRINT_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = PRINT_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@page { margin: ${getMarginCssValue(settings)}; }`;

  document.documentElement.style.setProperty(
    PRINT_LH_VAR,
    String(getLineHeightValue(settings))
  );
}

export function clearPrintLayoutStyles(): void {
  if (typeof document === "undefined") return;
  document.getElementById(PRINT_STYLE_ID)?.remove();
  document.documentElement.style.removeProperty(PRINT_LH_VAR);
}

function isValidMarginPreset(v: unknown): v is MarginPreset {
  return v === "narrow" || v === "normal" || v === "wide" || v === "custom";
}

function isValidLineHeightPreset(v: unknown): v is LineHeightPreset {
  return v === "compact" || v === "normal" || v === "relaxed";
}
