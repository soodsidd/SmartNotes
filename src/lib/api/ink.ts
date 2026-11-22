import { ApiError } from "./pages";
import { vaultWriteFetch } from "@/lib/connection-status";
import type { InkEngineId } from "@/lib/ink-engine";
import { isSmartNotesInkScene } from "@/lib/ink-engine/scene";

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(
      (payload as { error?: string }).error ?? response.statusText,
      response.status,
      (payload as { code?: string }).code ?? "API_ERROR"
    );
  }
  return payload as T;
}

export type InkBackgroundMode = "blank" | "grid";

export function parseInkSidecarJson(raw: string, engine: InkEngineId = "tldraw"): { scene: unknown; backgroundMode: InkBackgroundMode } {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") {
      return { scene: null, backgroundMode: "blank" };
    }
    if (engine === "tldraw" && "document" in data) {
      return { scene: data, backgroundMode: "blank" };
    }
    const sidecar = data as { scene?: unknown; inkMeta?: { backgroundMode?: string } };
    if (engine === "smart-notes" && !isSmartNotesInkScene(sidecar.scene)) return { scene: null, backgroundMode: "blank" };
    return {
      scene: sidecar.scene ?? null,
      backgroundMode: sidecar.inkMeta?.backgroundMode === "grid" ? "grid" : "blank",
    };
  } catch {
    return { scene: null, backgroundMode: "blank" };
  }
}

export async function fetchInkScene(
  path: string,
  engine: InkEngineId = "tldraw"
): Promise<{ scene: unknown; backgroundMode: InkBackgroundMode }> {
  const response = await fetch(`/api/ink?path=${encodeURIComponent(path)}${engine === "smart-notes" ? "&engine=smart-notes" : ""}`, {
    cache: "no-store",
  });
  const data = await readJson<{ scene: unknown; backgroundMode?: string }>(response);
  return {
    scene: data.scene,
    backgroundMode: data.backgroundMode === "grid" ? "grid" : "blank",
  };
}

export async function saveInkScene(
  path: string,
  scene: unknown,
  backgroundMode: InkBackgroundMode = "blank",
  engine: InkEngineId = "tldraw"
): Promise<void> {
  const response = await vaultWriteFetch("/api/ink", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, scene, backgroundMode, engine: engine === "tldraw" ? undefined : engine }),
  });
  await readJson<{ ok: boolean }>(response);
}
