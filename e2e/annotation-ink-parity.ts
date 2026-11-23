import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import type { SmartNotesInkScene } from "../src/lib/ink-engine/scene";

export const smartInk = process.env.SMART_NOTES_E2E_INK_ENGINE === "smart-notes";
export const annotationSuffix = smartInk ? ".sn-annotations.json" : ".annotations.json";
export const renderedStrokeSelector = smartInk ? "[data-sn-ink-stroke]" : '.tl-shape[data-shape-type="draw"]';
export const strokePathSelector = smartInk ? renderedStrokeSelector : `${renderedStrokeSelector} path`;
export const standaloneCanvasSelector = smartInk
  ? '[data-testid="smart-notes-ink-surface"] svg[aria-label="Smart Notes ink canvas"]'
  : ".tl-canvas";

export function useAnnotationInkEngine() {
  test.beforeEach(async ({ page }) => setInkEnginePreference(page));
}

export async function setInkEnginePreference(page: Page) {
  await page.addInitScript((engine) => {
    localStorage.setItem("smart-notes:ink-engine", engine);
  }, smartInk ? "smart-notes" : "tldraw");
}

export async function readNoteInk(request: APIRequestContext, path: string, engine = smartInk ? "smart-notes" : "tldraw") {
  const response = await request.get(`/api/ink?${new URLSearchParams({ path, engine })}`);
  expect(response.ok()).toBe(true);
  const { scene, backgroundMode } = await response.json() as {
    backgroundMode: "blank" | "grid";
    scene: SmartNotesInkScene | { document?: { store?: Record<string, { typeName?: string; type?: string; x: number; y: number }> } } | null;
  };
  const origins = scene && "strokes" in scene
    ? scene.strokes.map(({ points: [[x, y]] }) => ({ x, y }))
    : Object.values(scene?.document?.store ?? {})
      .filter((record) => record.typeName === "shape" && record.type === "draw")
      .map(({ x, y }) => ({ x, y }));
  return { origins, backgroundMode };
}

type LegacyRecord = { id?: string; typeName?: string; y?: number; props?: { color?: string } };
type Sidecar = { drawableBottom?: number; scene?: SmartNotesInkScene | { document?: { store?: Record<string, LegacyRecord> } } };

export async function readAnnotationSidecar(sidecarPath: string) {
  const raw = await fs.readFile(sidecarPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  const { drawableBottom, scene } = JSON.parse(raw) as Sidecar;
  const strokes = scene && "strokes" in scene
    ? scene.strokes.map((stroke) => ({ color: stroke.color, y: stroke.points[0]?.[1] }))
    : Object.values(scene?.document?.store ?? {})
      .filter((record) => record.typeName === "shape")
      .map((record) => ({ color: record.props?.color, y: record.y }));
  return { drawableBottom, strokes };
}
