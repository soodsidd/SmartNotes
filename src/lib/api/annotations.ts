import { ApiError } from "./pages";
import { logAnnotationDebug } from "@/lib/annotation-debug";
import { vaultWriteFetch } from "@/lib/connection-status";

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

export function parseAnnotationsSidecarJson(raw: string): {
  scene: unknown;
  drawableBottom?: number;
} {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") {
      return { scene: null };
    }
    if ("document" in (data as Record<string, unknown>)) {
      return { scene: data };
    }
    const sidecar = data as { scene?: unknown; drawableBottom?: unknown };
    const drawableBottom =
      typeof sidecar.drawableBottom === "number" && Number.isFinite(sidecar.drawableBottom)
        ? Math.ceil(sidecar.drawableBottom)
        : undefined;
    return { scene: sidecar.scene ?? null, drawableBottom };
  } catch {
    return { scene: null };
  }
}

export async function fetchAnnotationsScene(
  path: string
): Promise<{ scene: unknown; drawableBottom?: number }> {
  logAnnotationDebug("api.fetch.start", { path });
  const response = await fetch(`/api/annotations?path=${encodeURIComponent(path)}`, {
    cache: "no-store",
  });
  const data = await readJson<{ scene: unknown; drawableBottom?: number }>(response);
  logAnnotationDebug("api.fetch.success", {
    path,
    hasScene: data.scene != null,
    drawableBottom: data.drawableBottom,
  });
  return { scene: data.scene, drawableBottom: data.drawableBottom };
}

export async function saveAnnotationsScene(
  path: string,
  scene: unknown,
  drawableBottom?: number
): Promise<void> {
  logAnnotationDebug("api.save.start", { path, drawableBottom });
  const response = await vaultWriteFetch("/api/annotations", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, scene, drawableBottom }),
  });
  await readJson<{ ok: boolean }>(response);
  logAnnotationDebug("api.save.success", { path, drawableBottom });
}
