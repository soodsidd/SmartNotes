import { EDITOR_MAIN_FLOW_WIDTH } from "./floating-text-box";

/**
 * SN-318: per-page width of the main editor flow column.
 *
 * Width-only, OneNote-style: the right-edge handle changes the column width,
 * prose and images reflow, and height stays content-driven. The per-page
 * choice lives in page frontmatter under `main_flow_width` (parallel to
 * `page_lines`); it is omitted when the page uses the default.
 */

export const MAIN_FLOW_WIDTH_METADATA_KEY = "main_flow_width";

export const MAIN_FLOW_DEFAULT_WIDTH = EDITOR_MAIN_FLOW_WIDTH;
export const MAIN_FLOW_MIN_WIDTH = 360;
/** Matches --editor-table-expanded-max-width so expanded tables never sit narrower than the column. */
export const MAIN_FLOW_MAX_WIDTH = 1200;

/** Keyboard steps for the resize handle (Shift = coarse). */
export const MAIN_FLOW_KEY_STEP = 8;
export const MAIN_FLOW_KEY_STEP_COARSE = 48;

/** Clamp any stored / posted value; anything unusable falls back to the default. */
export function normalizeMainFlowWidth(value: unknown): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return MAIN_FLOW_DEFAULT_WIDTH;
  return Math.min(MAIN_FLOW_MAX_WIDTH, Math.max(MAIN_FLOW_MIN_WIDTH, Math.round(number)));
}

/** Right-edge resize: only the width changes; the column reflows and height follows content. */
export function resizeMainFlowWidth(width: number, dx: number): number {
  return normalizeMainFlowWidth(normalizeMainFlowWidth(width) + dx);
}

export function mainFlowWidthFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): number {
  return normalizeMainFlowWidth(metadata?.[MAIN_FLOW_WIDTH_METADATA_KEY]);
}

export function isDefaultMainFlowWidth(width: number): boolean {
  return normalizeMainFlowWidth(width) === MAIN_FLOW_DEFAULT_WIDTH;
}

/** Write (or omit, when default) the width into a frontmatter object. */
export function applyMainFlowWidthMetadata<T extends Record<string, unknown>>(
  metadata: T,
  width: number
): T {
  const next = { ...metadata } as Record<string, unknown>;
  const normalized = normalizeMainFlowWidth(width);
  if (normalized === MAIN_FLOW_DEFAULT_WIDTH) {
    delete next[MAIN_FLOW_WIDTH_METADATA_KEY];
  } else {
    next[MAIN_FLOW_WIDTH_METADATA_KEY] = normalized;
  }
  return next as T;
}
