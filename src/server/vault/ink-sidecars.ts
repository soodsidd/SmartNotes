import type { InkEngineId } from "@/lib/ink-engine";
import { isSmartNotesInkScene } from "@/lib/ink-engine/scene";
import { VaultError } from "./errors";

export const SMART_NOTES_INK_SUFFIX = ".sn-ink.json";
export const SMART_NOTES_ANNOTATIONS_SUFFIX = ".sn-annotations.json";

export function parseInkEngine(value: unknown): InkEngineId {
  if (value == null || value === "tldraw") return "tldraw";
  if (value === "smart-notes") return value;
  throw new VaultError("INVALID_INPUT", 'Ink engine must be "tldraw" or "smart-notes".');
}

export function validateInkScene(scene: unknown, engine: InkEngineId): void {
  if (scene == null) return;
  if (engine === "smart-notes" && !isSmartNotesInkScene(scene)) {
    throw new VaultError("INVALID_INPUT", "Expected a version 2 Smart Notes ink scene.");
  }
  if (engine === "tldraw" && isSmartNotesInkScene(scene)) {
    throw new VaultError("INVALID_INPUT", "A Smart Notes ink scene requires the smart-notes engine.");
  }
}
