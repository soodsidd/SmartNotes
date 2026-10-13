import type { CSSProperties } from "react";

/**
 * SN-297: OneNote-style rule / grid lines drawn as a page background.
 *
 * Lines are a CSS background on the editor content frame — never document
 * content. The per-page choice lives in page frontmatter under
 * `page_lines`; the "Always create pages with these lines" default lives in
 * this browser's localStorage only.
 */

/** Vault frontmatter key. Omitted when the page uses the default (no lines). */
export const PAGE_LINES_METADATA_KEY = "page_lines";

/** Per-browser default for new text pages (never synced). */
export const NEW_PAGE_LINES_STORAGE_KEY = "smart-notes:new-page-lines";

export const RULE_LINE_STYLES = [
  "rule-narrow",
  "rule-college",
  "rule-wide",
  "rule-college-margin",
] as const;

export const GRID_LINE_STYLES = [
  "grid-small",
  "grid-medium",
  "grid-large",
  "grid-xlarge",
] as const;

export type RuleLineStyle = (typeof RULE_LINE_STYLES)[number];
export type GridLineStyle = (typeof GRID_LINE_STYLES)[number];
export type PageLineStyle = "none" | RuleLineStyle | GridLineStyle;

export const PAGE_LINE_COLORS = ["light-blue", "blue", "green", "lavender", "grey"] as const;
export type PageLineColor = (typeof PAGE_LINE_COLORS)[number];

export interface PageLinesSetting {
  style: PageLineStyle;
  color: PageLineColor;
}

export const DEFAULT_PAGE_LINES: PageLinesSetting = { style: "none", color: "light-blue" };

export const PAGE_LINE_STYLE_LABELS: Record<PageLineStyle, string> = {
  none: "None",
  "rule-narrow": "Narrow ruled",
  "rule-college": "College ruled",
  "rule-wide": "Wide ruled",
  "rule-college-margin": "College ruled with margin",
  "grid-small": "Small grid",
  "grid-medium": "Medium grid",
  "grid-large": "Large grid",
  "grid-xlarge": "Very large grid",
};

export const PAGE_LINE_COLOR_LABELS: Record<PageLineColor, string> = {
  "light-blue": "Light blue",
  blue: "Blue",
  green: "Green",
  lavender: "Lavender",
  grey: "Grey",
};

/** Spacing token per style (documented in docs/design-system/README.md). */
const STYLE_SPACING_TOKEN: Record<Exclude<PageLineStyle, "none">, string> = {
  "rule-narrow": "--page-rule-narrow",
  "rule-college": "--page-rule-college",
  "rule-wide": "--page-rule-wide",
  "rule-college-margin": "--page-rule-college",
  "grid-small": "--page-grid-small",
  "grid-medium": "--page-grid-medium",
  "grid-large": "--page-grid-large",
  "grid-xlarge": "--page-grid-xlarge",
};

const ALL_STYLES = new Set<string>(["none", ...RULE_LINE_STYLES, ...GRID_LINE_STYLES]);
const ALL_COLORS = new Set<string>(PAGE_LINE_COLORS);

export function isPageLineStyle(value: unknown): value is PageLineStyle {
  return typeof value === "string" && ALL_STYLES.has(value);
}

export function isPageLineColor(value: unknown): value is PageLineColor {
  return typeof value === "string" && ALL_COLORS.has(value);
}

export function isGridLineStyle(style: PageLineStyle): style is GridLineStyle {
  return (GRID_LINE_STYLES as readonly string[]).includes(style);
}

export function pageLineColorVar(color: PageLineColor): string {
  return `var(--page-line-${color})`;
}

/** Normalize any stored / posted value; unknown fields fall back to defaults. */
export function normalizePageLines(value: unknown): PageLinesSetting {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_PAGE_LINES };
  }
  const record = value as Record<string, unknown>;
  return {
    style: isPageLineStyle(record.style) ? record.style : DEFAULT_PAGE_LINES.style,
    color: isPageLineColor(record.color) ? record.color : DEFAULT_PAGE_LINES.color,
  };
}

export function pageLinesFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): PageLinesSetting {
  return normalizePageLines(metadata?.[PAGE_LINES_METADATA_KEY]);
}

export function isDefaultPageLines(setting: PageLinesSetting): boolean {
  return setting.style === DEFAULT_PAGE_LINES.style && setting.color === DEFAULT_PAGE_LINES.color;
}

export function samePageLines(a: PageLinesSetting, b: PageLinesSetting): boolean {
  return a.style === b.style && a.color === b.color;
}

/** Write (or omit, when default) the setting into a frontmatter object. */
export function applyPageLinesMetadata<T extends Record<string, unknown>>(
  metadata: T,
  setting: PageLinesSetting
): T {
  const next = { ...metadata } as Record<string, unknown>;
  const normalized = normalizePageLines(setting);
  if (isDefaultPageLines(normalized)) {
    delete next[PAGE_LINES_METADATA_KEY];
  } else {
    next[PAGE_LINES_METADATA_KEY] = { style: normalized.style, color: normalized.color };
  }
  return next as T;
}

/**
 * CSS background for the editor content frame. Pure CSS gradients keyed on
 * design tokens, so lines never touch layout, selection, copy, or export.
 */
export function pageLinesBackgroundStyle(
  setting: PageLinesSetting,
  options: { spacing?: string; marginInset?: string } = {}
): CSSProperties | undefined {
  const { style, color } = normalizePageLines(setting);
  if (style === "none") return undefined;

  const spacing = options.spacing ?? `var(${STYLE_SPACING_TOKEN[style]})`;
  const line = pageLineColorVar(color);
  const horizontal = `linear-gradient(to bottom, transparent calc(${spacing} - 1px), ${line} calc(${spacing} - 1px))`;

  if (isGridLineStyle(style)) {
    const vertical = `linear-gradient(to right, transparent calc(${spacing} - 1px), ${line} calc(${spacing} - 1px))`;
    return {
      backgroundImage: `${horizontal}, ${vertical}`,
      backgroundSize: `${spacing} ${spacing}`,
    };
  }

  if (style === "rule-college-margin") {
    const inset = options.marginInset ?? "var(--page-rule-margin-inset)";
    const margin = `linear-gradient(to right, transparent ${inset}, var(--page-line-margin) ${inset}, var(--page-line-margin) calc(${inset} + 1px), transparent calc(${inset} + 1px))`;
    return {
      backgroundImage: `${margin}, ${horizontal}`,
      backgroundSize: `100% 100%, 100% ${spacing}`,
      backgroundRepeat: "no-repeat, repeat",
    };
  }

  return {
    backgroundImage: horizontal,
    backgroundSize: `100% ${spacing}`,
  };
}

// ---------------------------------------------------------------------------
// Per-browser "Always create pages with these lines" default
// ---------------------------------------------------------------------------

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Returns the stored default for new text pages, or null when the toggle is off. */
export function readNewPageLinesDefault(
  storage: StorageLike | null = browserStorage()
): PageLinesSetting | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(NEW_PAGE_LINES_STORAGE_KEY);
    if (!raw) return null;
    return normalizePageLines(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeNewPageLinesDefault(
  setting: PageLinesSetting | null,
  storage: StorageLike | null = browserStorage()
): void {
  if (!storage) return;
  try {
    if (setting) {
      const normalized = normalizePageLines(setting);
      storage.setItem(NEW_PAGE_LINES_STORAGE_KEY, JSON.stringify(normalized));
    } else {
      storage.removeItem(NEW_PAGE_LINES_STORAGE_KEY);
    }
  } catch {
    // Storage full / disabled: the per-page choice still persists in the vault.
  }
}

/**
 * Lines to stamp on a newly created page. Only text pages pick up the
 * per-browser default; other note types never get page lines.
 */
export function pageLinesForNewPage(
  noteType: string | null | undefined,
  storage: StorageLike | null = browserStorage()
): PageLinesSetting | null {
  if (noteType && noteType !== "text") return null;
  const setting = readNewPageLinesDefault(storage);
  if (!setting || isDefaultPageLines(setting)) return null;
  return setting;
}
