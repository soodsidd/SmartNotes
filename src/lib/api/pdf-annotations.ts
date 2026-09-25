import { ApiError } from "./pages";
import { vaultWriteFetch } from "@/lib/connection-status";
import {
  buildPdfAnnotationSidecar,
  type PdfAnnotationSidecar,
} from "@/lib/pdf-annotations";

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      payload.error ?? response.statusText,
      response.status,
      payload.code ?? "API_ERROR"
    );
  }
  return payload as T;
}

export async function fetchPdfAnnotations(pdfPath: string): Promise<PdfAnnotationSidecar> {
  const response = await fetch(
    `/api/pdf-annotations?path=${encodeURIComponent(pdfPath)}`,
    { cache: "no-store" }
  );
  const data = await readJson<PdfAnnotationSidecar>(response);
  return buildPdfAnnotationSidecar(data.items);
}

export async function savePdfAnnotations(
  pdfPath: string,
  items: unknown
): Promise<PdfAnnotationSidecar> {
  const response = await vaultWriteFetch("/api/pdf-annotations", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: pdfPath, items }),
  });
  const data = await readJson<{ ok: boolean; sidecar: PdfAnnotationSidecar }>(response);
  return buildPdfAnnotationSidecar(data.sidecar?.items ?? items);
}
