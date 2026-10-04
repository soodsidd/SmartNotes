/**
 * Paper reading shell (SN-281): PDF | paper notes (resizable) | Companion overlay.
 *
 * Geometry is a pure function of the viewport and the notes dock preference.
 * Companion is deliberately NOT an input: it is a fixed overlay above both
 * frames, so opening or dismissing it can never resize or move them.
 */
import { isBibliographyPath } from "./papers";

export const PAPER_NOTES_WIDTH_STORAGE_KEY = "smart-notes-paper-notes-width";
export const PAPER_NOTES_OPEN_STORAGE_KEY = "smart-notes-paper-notes-open";
export const PAPER_NOTES_DEFAULT_WIDTH = 440;
export const PAPER_NOTES_MIN_WIDTH = 320;
/** The PDF frame keeps at least this much width beside the docked notes. */
export const PAPER_READER_MIN_WIDTH = 360;
/** Below this viewport width notes become a full-width layer over the PDF. */
export const PAPER_SPLIT_MIN_VIEWPORT = PAPER_NOTES_MIN_WIDTH + PAPER_READER_MIN_WIDTH;
/** Keyboard resize step for the notes separator. */
export const PAPER_NOTES_KEYBOARD_STEP = 24;

export type PaperShellMode = "split" | "overlay" | "hidden";

export interface PaperShellLayout {
  mode: PaperShellMode;
  /** Pixels the PDF reader frame leaves free on its right edge. */
  readerInsetRight: number;
  /** Docked notes width; null when notes cover the viewport or are hidden. */
  notesWidth: number | null;
}

export function paperNotesMaxWidth(viewportWidth: number): number {
  return Math.max(PAPER_NOTES_MIN_WIDTH, Math.floor(viewportWidth) - PAPER_READER_MIN_WIDTH);
}

export function clampPaperNotesWidth(width: number, viewportWidth: number): number {
  const fallback = Number.isFinite(width) ? width : PAPER_NOTES_DEFAULT_WIDTH;
  return Math.round(Math.min(paperNotesMaxWidth(viewportWidth), Math.max(PAPER_NOTES_MIN_WIDTH, fallback)));
}

export function paperShellLayout(input: {
  viewportWidth: number;
  /** Persisted wide-screen notes width preference. */
  notesWidth: number;
  /** Persisted wide-screen preference: notes docked beside the PDF. */
  notesOpen: boolean;
  /** Narrow viewports: notes layer shown over the PDF (per-open, not persisted). */
  overlayOpen?: boolean;
}): PaperShellLayout {
  const hidden: PaperShellLayout = { mode: "hidden", readerInsetRight: 0, notesWidth: null };
  if (input.viewportWidth < PAPER_SPLIT_MIN_VIEWPORT) {
    return input.overlayOpen ? { mode: "overlay", readerInsetRight: 0, notesWidth: null } : hidden;
  }
  if (!input.notesOpen) return hidden;
  const notesWidth = clampPaperNotesWidth(input.notesWidth, input.viewportWidth);
  return { mode: "split", readerInsetRight: notesWidth, notesWidth };
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** Stored width is kept unclamped so a narrow window does not shrink the wide-screen preference. */
export function readPaperNotesWidth(storage: PreferenceStorage | null | undefined): number {
  try {
    const stored = Number(storage?.getItem(PAPER_NOTES_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= PAPER_NOTES_MIN_WIDTH ? Math.round(stored) : PAPER_NOTES_DEFAULT_WIDTH;
  } catch {
    return PAPER_NOTES_DEFAULT_WIDTH;
  }
}

export function writePaperNotesWidth(storage: PreferenceStorage | null | undefined, width: number): void {
  try {
    storage?.setItem(PAPER_NOTES_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Width persistence is best-effort.
  }
}

export function readPaperNotesOpen(storage: PreferenceStorage | null | undefined): boolean {
  try {
    return storage?.getItem(PAPER_NOTES_OPEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writePaperNotesOpen(storage: PreferenceStorage | null | undefined, open: boolean): void {
  try {
    storage?.setItem(PAPER_NOTES_OPEN_STORAGE_KEY, open ? "true" : "false");
  } catch {
    // Open-state persistence is best-effort.
  }
}

/** Same-origin standard page shell, embedded as notes; Companion stays with the host. */
export function paperNotesFrameSrc(paperPath: string): string {
  return `/?page=${encodeURIComponent(paperPath)}&paperInline=1&paperDock=1`;
}

export interface PaperOpenPdfMessage {
  type: "paper-open-pdf";
  paperPath: string;
  target: { href: string; fileName: string };
}

/** Embedded paper editors ask the top shell to open their PDFs in the reading shell. */
export function isPaperOpenPdfMessage(data: unknown): data is PaperOpenPdfMessage {
  if (!data || typeof data !== "object") return false;
  const message = data as Partial<PaperOpenPdfMessage>;
  return (
    message.type === "paper-open-pdf" &&
    typeof message.paperPath === "string" &&
    isBibliographyPath(message.paperPath) &&
    typeof message.target?.href === "string" &&
    typeof message.target.fileName === "string"
  );
}
