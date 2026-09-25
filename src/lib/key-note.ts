/** Vault metadata key for the SN-229 key-note marker. Omitted when false. */
export const KEY_NOTE_METADATA_KEY = "key_note";

export function isKeyNoteFlag(value: unknown): boolean {
  return value === true;
}

export function isPageKeyNote(page: {
  keyNote?: boolean;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (page.keyNote === true) return true;
  return isKeyNoteFlag(page.metadata?.[KEY_NOTE_METADATA_KEY]);
}

export function keyNoteMenuLabel(isKeyNote: boolean): string {
  return isKeyNote ? "Unmark key note" : "Mark as key note";
}

export function applyKeyNoteFlag<T extends Record<string, unknown>>(
  metadata: T,
  keyNote: boolean
): T {
  const next = { ...metadata };
  if (keyNote) {
    (next as Record<string, unknown>)[KEY_NOTE_METADATA_KEY] = true;
  } else {
    delete (next as Record<string, unknown>)[KEY_NOTE_METADATA_KEY];
  }
  return next;
}
