import { ApiError } from "./pages";
import { canUseKeepaliveBody, vaultWriteFetch } from "@/lib/connection-status";
import {
  normalizeCompanionSidecar,
  type CompanionSidecar,
} from "@/lib/ai-sidebar";

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

/** Loads the thread map for a page sidecar or shared notebook-section store. */
export async function fetchCompanionSessions(path: string): Promise<CompanionSidecar> {
  const endpoint = path.startsWith("dwc_")
    ? `/api/workspace/companion?workspace=${encodeURIComponent(path)}`
    : `/api/companion?path=${encodeURIComponent(path)}`;
  const response = await fetch(endpoint, {
    cache: "no-store",
  });
  const data = await readJson<{ scopes?: Record<string, unknown> }>(response);
  return normalizeCompanionSidecar({ scopes: data.scopes ?? {} });
}

/** Persists the full scope thread map for a page or shared section store. */
export async function saveCompanionSessions(
  path: string,
  sidecar: CompanionSidecar,
  options: { keepalive?: boolean } = {}
): Promise<void> {
  const workspace = path.startsWith("dwc_") ? path : undefined;
  const body = JSON.stringify(workspace
    ? { workspace, scopes: sidecar.scopes }
    : { path, scopes: sidecar.scopes });
  const response = await vaultWriteFetch(workspace ? "/api/workspace/companion" : "/api/companion", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: options.keepalive === true && canUseKeepaliveBody(body),
  });
  await readJson<{ ok: boolean }>(response);
}

/** Removes a page or shared notebook-section companion store entirely. */
export async function deleteCompanionSessions(path: string): Promise<void> {
  const endpoint = path.startsWith("dwc_")
    ? `/api/workspace/companion?workspace=${encodeURIComponent(path)}`
    : `/api/companion?path=${encodeURIComponent(path)}`;
  const response = await vaultWriteFetch(endpoint, {
    method: "DELETE",
  });
  await readJson<{ ok: boolean }>(response);
}

export interface CompanionPageContextOptions {
  /**
   * Character offset into the extracted PDF text for chunked reading.
   * When a PDF is larger than the server default (60 000 chars), the
   * truncation note in the returned context includes the exact offset to pass
   * here for the next window.
   */
  pdfChunkOffset?: number;
  /**
   * Override the maximum PDF characters included per file.
   * Useful when a turn needs a smaller slice for a tighter context budget.
   */
  pdfMaxChars?: number;
  /** Active immersive-reader attachment href, when the reader is open. */
  activePdfHref?: string;
  /** Display name reported by the active immersive reader. */
  activePdfFileName?: string;
  /** Current 1-based page reported by the active immersive reader. */
  pdfPage?: number;
  /** Authoritative page count reported by the loaded immersive reader. */
  pdfPageCount?: number;
  /** Zero-based active cell in the canonical notebook.ipynb, when live focus reports it. */
  activeJupyterCellIndex?: number;
  /** Stable nbformat id for the active cell, when live focus reports it. */
  activeJupyterCellId?: string;
}

/** Builds page context plus first-class page assets/notebook context for a companion turn. */
export async function fetchCompanionPageContext(
  path: string,
  basePageContext: string,
  options: CompanionPageContextOptions = {}
): Promise<string> {
  const response = await fetch("/api/companion/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ path, basePageContext, ...options }),
  });
  const data = await readJson<{ pageContext?: string }>(response);
  return data.pageContext ?? basePageContext;
}
