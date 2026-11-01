/**
 * SN-407: user-configurable dictation auto-stop silence timeout.
 *
 * Stored per device in localStorage (same convention as spellcheck/density),
 * so desktop and phone each keep their own value. Read at the start of every
 * recording, so a change takes effect on the next dictation without a reload.
 */

export const DICTATION_SILENCE_STORAGE_KEY = "smart-notes-dictation-silence-seconds";

/** App default: short, OpenWhispr-like auto-stop (SN-406 shipped a fixed 10 s). */
export const DICTATION_SILENCE_DEFAULT_SECONDS = 3;
export const DICTATION_SILENCE_MIN_SECONDS = 1;
export const DICTATION_SILENCE_MAX_SECONDS = 60;
export const DICTATION_SILENCE_OPTIONS = [2, 3, 5, 10, 20] as const;

export function clampDictationSilenceSeconds(value: number): number {
  if (!Number.isFinite(value)) return DICTATION_SILENCE_DEFAULT_SECONDS;
  return Math.min(DICTATION_SILENCE_MAX_SECONDS, Math.max(DICTATION_SILENCE_MIN_SECONDS, value));
}

export function readDictationSilenceSeconds(): number {
  if (typeof window === "undefined") return DICTATION_SILENCE_DEFAULT_SECONDS;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DICTATION_SILENCE_STORAGE_KEY);
  } catch {
    return DICTATION_SILENCE_DEFAULT_SECONDS;
  }
  if (raw === null || raw.trim() === "") return DICTATION_SILENCE_DEFAULT_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DICTATION_SILENCE_DEFAULT_SECONDS;
  return clampDictationSilenceSeconds(parsed);
}

export function writeDictationSilenceSeconds(value: number): number {
  const next = clampDictationSilenceSeconds(value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DICTATION_SILENCE_STORAGE_KEY, String(next));
    } catch {
      // storage unavailable (private mode): the setting just does not persist
    }
  }
  return next;
}
