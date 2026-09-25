/**
 * Per-attachment reader state for the immersive PDF reader (SN-135) plus the
 * global night-mode preference (SN-225).
 *
 * Last-read page and view/zoom are remembered per PDF attachment so reopening
 * a document returns the reader to where the user left off. Night mode is a
 * reader-wide viewing choice (not per attachment) so toggling it once applies
 * to every PDF. Both live in `localStorage` and are intentionally decoupled
 * from vault page content so they never touch the saved `.html` body or the
 * `.assets/` files.
 */

/**
 * Remembered view preference. Either a fit mode understood by the EmbedPDF
 * zoom plugin (`fit-width` / `fit-page` / `automatic`) or an explicit numeric
 * scale factor (e.g. `1.5` for 150%).
 */
export type PdfReaderZoom = "fit-width" | "fit-page" | "automatic" | number;
export type PdfReaderSpreadOffset = "even" | "odd";

export interface PdfReaderPrefs {
  /** 1-based last-read page number. */
  page: number;
  /** Remembered view / zoom preference. */
  zoom: PdfReaderZoom;
  /** Whether two-page spread view is requested for eligible landscape widths. */
  spreadMode: boolean;
  /** `even` leaves page 1 alone; `odd` pairs pages 1-2. */
  spreadOffset: PdfReaderSpreadOffset;
}

export const DEFAULT_PDF_READER_PREFS: PdfReaderPrefs = {
  page: 1,
  zoom: "fit-width",
  spreadMode: false,
  spreadOffset: "even",
};

const STORAGE_PREFIX = "smart-notes:pdf-reader:";
/** Global (not per-href) night-mode choice for the immersive reader (SN-225). */
const NIGHT_MODE_STORAGE_KEY = `${STORAGE_PREFIX}night-mode`;

export type PdfReaderNightModePref = "on" | "off";

/**
 * Derive the stable storage key for an attachment href. The href is used
 * verbatim (it is already unique per attachment within the vault) so the same
 * document reopened from any note returns to the same place.
 */
export function pdfReaderPrefsKey(href: string): string {
  return `${STORAGE_PREFIX}${href}`;
}

export function pdfReaderNightModeKey(): string {
  return NIGHT_MODE_STORAGE_KEY;
}

/**
 * Clamp a remembered 1-based page to a valid page within a document of
 * `totalPages`. Used when restoring reader position: a stored page that now
 * exceeds the document length (e.g. the file was replaced with a shorter one)
 * resolves to the last page rather than failing. Returns 1 until the page
 * count is known (`totalPages <= 0`).
 */
export function clampReaderPage(page: number, totalPages: number): number {
  if (!Number.isFinite(totalPages) || totalPages <= 0) return 1;
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), Math.floor(totalPages));
}

/**
 * Resolve a user-typed page-jump entry to a valid 1-based page, or `null` when
 * the entry cannot become a jump target. Used by the reader's editable page
 * field: an empty/non-numeric entry (`null`) leaves the current page untouched,
 * while a numeric entry is clamped into the document range so out-of-range
 * values (0, negatives, or beyond the last page) resolve to the nearest edge
 * rather than jumping nowhere. Returns `null` until the page count is known
 * (`totalPages <= 0`).
 */
export function parseJumpPage(raw: string, totalPages: number): number | null {
  if (!Number.isFinite(totalPages) || totalPages <= 0) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return null;
  return clampReaderPage(parsed, totalPages);
}

/**
 * Zoom plugin bounds used by the immersive reader (`minZoom` / `maxZoom` on
 * ZoomPluginPackage). Manual zoom entry clamps into this range so typed
 * values cannot exceed what EmbedPDF will accept.
 */
export const MIN_ZOOM_PERCENT = 25;
export const MAX_ZOOM_PERCENT = 1000;

/**
 * Resolve a user-typed zoom-percent entry to a scale factor, or `null` when
 * the entry cannot become a zoom target (SN-198). Empty / non-numeric input
 * is rejected; a trailing `%` is tolerated; in-range numbers become
 * `percent / 100`; out-of-range numbers clamp to
 * `[MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT]` so typing `10` or `5000` still
 * applies a safe zoom rather than crashing or no-oping.
 */
export function parseZoomPercent(raw: string): number | null {
  let trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("%")) trimmed = trimmed.slice(0, -1).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const clamped = Math.min(
    MAX_ZOOM_PERCENT,
    Math.max(MIN_ZOOM_PERCENT, parsed)
  );
  return clamped / 100;
}

function isValidZoom(value: unknown): value is PdfReaderZoom {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  return value === "fit-width" || value === "fit-page" || value === "automatic";
}

function normalizePrefs(raw: unknown): PdfReaderPrefs {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PDF_READER_PREFS };
  }
  const candidate = raw as Partial<PdfReaderPrefs>;
  const page =
    typeof candidate.page === "number" &&
    Number.isInteger(candidate.page) &&
    candidate.page >= 1
      ? candidate.page
      : DEFAULT_PDF_READER_PREFS.page;
  const zoom = isValidZoom(candidate.zoom)
    ? candidate.zoom
    : DEFAULT_PDF_READER_PREFS.zoom;
  const spreadMode = candidate.spreadMode === true;
  const spreadOffset = candidate.spreadOffset === "odd" ? "odd" : "even";
  return { page, zoom, spreadMode, spreadOffset };
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // localStorage can throw in private-mode / sandboxed contexts.
    return null;
  }
}

/**
 * Read the remembered reader state for an attachment. Returns defaults
 * (page 1, fit-width) when nothing is stored or the stored value is invalid.
 */
export function readPdfReaderPrefs(href: string): PdfReaderPrefs {
  const storage = getStorage();
  if (!storage || !href) return { ...DEFAULT_PDF_READER_PREFS };
  try {
    const stored = storage.getItem(pdfReaderPrefsKey(href));
    if (!stored) return { ...DEFAULT_PDF_READER_PREFS };
    return normalizePrefs(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_PDF_READER_PREFS };
  }
}

/**
 * Persist the remembered reader state for an attachment. Omitted fields keep
 * their stored values; invalid supplied fields are coerced to defaults so a
 * bad in-memory value can never corrupt future reads. Failures (quota,
 * disabled storage) are swallowed — remembering place is best-effort and must
 * never break the reader.
 */
export function writePdfReaderPrefs(
  href: string,
  prefs: Pick<PdfReaderPrefs, "page" | "zoom"> & Partial<PdfReaderPrefs>
): void {
  const storage = getStorage();
  if (!storage || !href) return;
  try {
    const current = readPdfReaderPrefs(href);
    storage.setItem(
      pdfReaderPrefsKey(href),
      JSON.stringify(normalizePrefs({ ...current, ...prefs }))
    );
  } catch {
    // Best-effort; ignore storage failures.
  }
}

/**
 * Read the explicit night-mode choice, or `null` when the user has never
 * toggled the reader control. `null` means follow Settings theme.
 */
export function readPdfReaderNightModePref(): PdfReaderNightModePref | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const stored = storage.getItem(NIGHT_MODE_STORAGE_KEY);
    if (stored === "on" || stored === "off") return stored;
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist an explicit night-mode choice. After this write, Settings theme no
 * longer drives the reader until storage is cleared. Failures are swallowed —
 * remembering the toggle is best-effort and must never break the reader.
 */
export function writePdfReaderNightModePref(enabled: boolean): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(NIGHT_MODE_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Best-effort; ignore storage failures.
  }
}

/**
 * Resolve whether page bitmaps should invert. An explicit reader toggle wins;
 * otherwise follow Settings theme so dark chrome does not leave bright pages
 * (the SN-225 default until the owner opts out).
 */
export function resolvePdfReaderNightMode(theme: "light" | "dark"): boolean {
  const pref = readPdfReaderNightModePref();
  if (pref === "on") return true;
  if (pref === "off") return false;
  return theme === "dark";
}
