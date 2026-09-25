import { ApiError } from "./pages";
import type { JupyterFocusState } from "@/lib/jupyter-focus";

export type JupyterSessionStatus = "starting" | "ready" | "error" | "stopped";
export type WorkspaceAccessMode = "read-only" | "editable";

export type JupyterErrorCode =
  | "JUPYTER_MISSING"
  | "NOTEBOOK_UNAVAILABLE"
  | "SERVER_LAUNCH_FAILED"
  | "PORT_CONFLICT"
  | "SERVER_DOWN"
  | "PROXY_UNAVAILABLE"
  | "MOBILE_BROWSER_UNSUPPORTED";

export interface JupyterSessionView {
  status: JupyterSessionStatus;
  /** Same-origin JupyterLab proxy URL (with token) to embed. Present when status === "ready". */
  url?: string;
  port?: number;
  pagePath: string;
  errorCode?: JupyterErrorCode;
  errorMessage?: string;
  accessMode?: WorkspaceAccessMode;
  /** Access policy resolved for the current request, independent of an already-running session. */
  resolvedAccessMode?: WorkspaceAccessMode;
  rootPath?: string;
  branch?: string;
  projectId?: string;
  repoId?: string;
  capability?: string;
  workItemId?: string;
  worktreeLabel?: string;
  projectName?: string;
  returnUrl?: string;
  executionContext?: string;
  expiresAt?: number;
}

export interface JupyterWorkspaceSessionRequest {
  rootPath: string;
  projectId?: string;
  repoId?: string;
  branch?: string;
  isDefaultBranch?: boolean;
  requestedAccess?: WorkspaceAccessMode;
  ownerOpen?: boolean;
  defaultBranchEditConfirmed?: boolean;
  projectName?: string;
  workItemId?: string;
  worktreeLabel?: string;
  returnUrl?: string;
  /** Accepted only in this POST body, never from URL/history. */
  executionApproved?: boolean;
  executionContext?: string;
}

export interface JupyterProfileStatus {
  profileInstalled: boolean;
  source: "override" | "profile" | "path" | "missing";
  jupyterLabVersion: string | null;
  lspInstalled: boolean;
  pylspReachable: boolean;
  pylspVersion: string | null;
}

export interface JupyterFastLaneResult {
  text: string;
  sessionId: string | null;
  ttftMs: number | null;
  durationMs: number;
}

export interface JupyterFastLaneSettings {
  fastLaneProvider: string;
  fastLaneModel: string;
  fastLaneEffort: string;
}

export async function fetchJupyterProfileStatus(): Promise<JupyterProfileStatus> {
  const response = await fetch("/api/jupyter/profile");
  return readJson<JupyterProfileStatus>(response);
}

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

function proxyStatusUrlFromLabUrl(url: string): string | null {
  try {
    const resolved = new URL(url, window.location.origin);
    if (resolved.origin !== window.location.origin) {
      return null;
    }

    const match = resolved.pathname.match(/^\/api\/jupyter\/proxy\/([^/]+)\//);
    if (!match) {
      return null;
    }

    const token = resolved.searchParams.get("token");
    const statusUrl = new URL(`/api/jupyter/proxy/${match[1]}/api/status`, window.location.origin);
    if (token) {
      statusUrl.searchParams.set("token", token);
    }
    return `${statusUrl.pathname}${statusUrl.search}`;
  } catch {
    return null;
  }
}

/**
 * Force the embed URL onto the browser-visible origin.
 * Relative `/api/jupyter/proxy/...` paths are fine inside the app shell, but
 * mobile/PWA edge cases (about:blank interim frames, odd base hrefs) can turn
 * a relative src into a dead navigation. Absolute same-origin URLs keep the
 * iframe on the Smart Notes host the phone already reached over LAN/Tailscale.
 */
function sameOriginProxyEmbedUrl(url: string): string | null {
  try {
    const resolved = new URL(url, window.location.origin);
    if (resolved.origin !== window.location.origin) {
      return null;
    }
    if (!/^\/api\/jupyter\/proxy\/[^/]+\//.test(resolved.pathname)) {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}

async function verifyBrowserProxyRoute(view: JupyterSessionView): Promise<void> {
  if (view.status !== "ready" || !view.url || typeof window === "undefined") {
    return;
  }

  const statusUrl = proxyStatusUrlFromLabUrl(view.url);
  if (!statusUrl) {
    throw new ApiError("Jupyter did not return a Smart Notes same-origin proxy URL.", 502, "PROXY_UNAVAILABLE");
  }

  let response: Response;
  try {
    response = await fetch(statusUrl, { cache: "no-store" });
  } catch {
    throw new ApiError("The browser could not reach Jupyter through the Smart Notes proxy.", 502, "PROXY_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new ApiError(
      "The Smart Notes Jupyter proxy did not answer the browser status check.",
      response.status,
      "PROXY_UNAVAILABLE"
    );
  }
}

/** Launch or connect to the local Jupyter session backing a notebook note. */
export async function launchJupyterSession(path: string): Promise<JupyterSessionView> {
  const response = await fetch("/api/jupyter/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const view = await readJson<JupyterSessionView>(response);
  await verifyBrowserProxyRoute(view);

  if (view.status === "ready" && view.url && typeof window !== "undefined") {
    const embedUrl = sameOriginProxyEmbedUrl(view.url);
    if (!embedUrl) {
      throw new ApiError("Jupyter did not return a Smart Notes same-origin proxy URL.", 502, "PROXY_UNAVAILABLE");
    }
    view.url = embedUrl;
  }

  return view;
}

/** Poll the session status without launching a server. */
export async function fetchJupyterSessionStatus(path: string): Promise<JupyterSessionView> {
  const response = await fetch(`/api/jupyter/session?path=${encodeURIComponent(path)}`, {
    cache: "no-store",
  });
  return readJson<JupyterSessionView>(response);
}

/** Stop the local Jupyter session backing a notebook note. */
export async function stopJupyterSession(path: string): Promise<{ stopped: boolean }> {
  const response = await fetch(`/api/jupyter/session?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
  return readJson<{ stopped: boolean }>(response);
}

/** Stop every local Jupyter session launched by Smart Notes in this app process. */
export async function stopAllJupyterSessions(): Promise<{ stopped: number }> {
  const response = await fetch("/api/jupyter/session", {
    method: "DELETE",
  });
  return readJson<{ stopped: number }>(response);
}

function workspaceSessionQuery(request: JupyterWorkspaceSessionRequest): string {
  const params = new URLSearchParams({ root: request.rootPath });
  if (request.projectId) params.set("projectId", request.projectId);
  if (request.repoId) params.set("repoId", request.repoId);
  if (request.branch) params.set("branch", request.branch);
  if (request.isDefaultBranch !== undefined) params.set("isDefaultBranch", String(request.isDefaultBranch));
  if (request.requestedAccess) params.set("requestedAccess", request.requestedAccess);
  if (request.ownerOpen !== undefined) params.set("ownerOpen", String(request.ownerOpen));
  if (request.defaultBranchEditConfirmed !== undefined) {
    params.set("defaultBranchEditConfirmed", String(request.defaultBranchEditConfirmed));
  }
  return params.toString();
}

/** Launch or resume an explicitly registered project-backed Deep Work session. */
export async function launchJupyterWorkspaceSession(
  request: JupyterWorkspaceSessionRequest
): Promise<JupyterSessionView> {
  const response = await fetch("/api/jupyter/workspace/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const view = await readJson<JupyterSessionView>(response);
  await verifyBrowserProxyRoute(view);
  if (view.status === "ready" && view.url && typeof window !== "undefined") {
    const embedUrl = sameOriginProxyEmbedUrl(view.url);
    if (!embedUrl) {
      throw new ApiError("Jupyter did not return a Smart Notes same-origin proxy URL.", 502, "PROXY_UNAVAILABLE");
    }
    view.url = embedUrl;
  }
  return view;
}

/** Read project-workspace status without launching a server. */
export async function fetchJupyterWorkspaceSessionStatus(
  request: JupyterWorkspaceSessionRequest
): Promise<JupyterSessionView> {
  const response = await fetch(`/api/jupyter/workspace/session?${workspaceSessionQuery(request)}`, {
    cache: "no-store",
  });
  return readJson<JupyterSessionView>(response);
}

/** Stop one project-backed Deep Work session. */
export async function stopJupyterWorkspaceSession(
  request: JupyterWorkspaceSessionRequest
): Promise<{ stopped: boolean }> {
  const response = await fetch(`/api/jupyter/workspace/session?${workspaceSessionQuery(request)}`, {
    method: "DELETE",
  });
  return readJson<{ stopped: boolean }>(response);
}

/**
 * SN-247: warm the no-tools, low-latency fast-lane Claude session for an open
 * Jupyter page. Fire-and-forget — the caller does not await this, so warm-up
 * never blocks the Jupyter kernel launch or anything else on the page-open
 * path. Errors are swallowed: a failed warm-up just means the first real
 * fast-lane request falls back to a cold turn instead of a resumed one.
 */
export function warmJupyterFastLaneSession(path: string): void {
  if (typeof window === "undefined") return;
  fetch("/api/companion/fast-lane", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => undefined);
}

/**
 * SN-247: tear down the fast-lane session for a page that just closed.
 * `keepalive: true` so the request can still complete during an abrupt
 * unmount/navigation/tab-close, matching the browser-keepalive convention
 * already used for durable companion turn persistence (see sysdoc SN-202).
 */
export function closeJupyterFastLaneSession(path: string): void {
  if (typeof window === "undefined") return;
  fetch(`/api/companion/fast-lane?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => undefined);
}

export async function fetchJupyterFastLaneSettings(): Promise<JupyterFastLaneSettings> {
  const response = await fetch("/api/companion/fast-lane", { cache: "no-store" });
  return readJson<JupyterFastLaneSettings>(response);
}

export async function saveJupyterFastLaneSettings(
  update: Partial<JupyterFastLaneSettings>
): Promise<JupyterFastLaneSettings> {
  const response = await fetch("/api/companion/fast-lane", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  return readJson<JupyterFastLaneSettings>(response);
}

/**
 * Send an inline request with the current bounded bridge snapshot. The server
 * assembles the first full context and later per-page deltas; callers should
 * pass the model text to JupyterNotebookBridgeController.applyAnswer.
 */
export async function sendJupyterFastLanePrompt(
  path: string,
  message: string,
  context: JupyterFocusState,
  signal?: AbortSignal
): Promise<JupyterFastLaneResult> {
  const response = await fetch("/api/companion/fast-lane/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, message, context }),
    signal,
  });
  return readJson<JupyterFastLaneResult>(response);
}

/**
 * SN-253 — streaming sibling of sendJupyterFastLanePrompt, used by the
 * "Answer comment" overlay conversation stream.
 *
 * `onDelta` receives newly produced answer text as it arrives. The resolved
 * result always carries the complete answer, so a caller that ignores the
 * deltas behaves exactly like the non-streaming path. Errors surfaced inside
 * the stream (the request already returned 200 by then) are re-thrown as
 * ApiError so both paths fail the same way for callers.
 */
export async function streamJupyterFastLanePrompt(
  path: string,
  message: string,
  context: JupyterFocusState,
  options?: { signal?: AbortSignal; onDelta?: (chunk: string, accumulated: string) => void }
): Promise<JupyterFastLaneResult> {
  const response = await fetch("/api/companion/fast-lane/send/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ path, message, context }),
    signal: options?.signal,
  });

  if (!response.ok || !response.body) {
    // Validation/transport failures never open a stream, so the body is JSON.
    const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(
      payload.error ?? response.statusText ?? "The inline AI request failed.",
      response.status,
      payload.code ?? "API_ERROR"
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let result: JupyterFastLaneResult | null = null;
  let failure: ApiError | null = null;

  const handleFrame = (frame: string) => {
    let name = "message";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    } catch {
      return;
    }
    if (name === "delta" && typeof payload.text === "string") {
      accumulated += payload.text;
      options?.onDelta?.(payload.text, accumulated);
    } else if (name === "done") {
      result = {
        text: typeof payload.text === "string" ? payload.text : accumulated,
        sessionId: typeof payload.sessionId === "string" ? payload.sessionId : null,
        ttftMs: null,
        durationMs: typeof payload.durationMs === "number" ? payload.durationMs : 0,
      };
    } else if (name === "error") {
      failure = new ApiError(
        typeof payload.error === "string" ? payload.error : "The inline AI request failed.",
        502,
        typeof payload.code === "string" ? payload.code : "FAST_LANE_PROVIDER_ERROR"
      );
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (frame.trim()) handleFrame(frame);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (buffer.trim()) handleFrame(buffer);

  if (failure) throw failure;
  if (result) return result;
  // The stream ended without a terminal event (process died, connection cut).
  throw new ApiError(
    "The inline AI stream ended before the answer completed.",
    502,
    "FAST_LANE_INCOMPLETE"
  );
}

export const __testInternals = {
  proxyStatusUrlFromLabUrl,
  sameOriginProxyEmbedUrl,
  verifyBrowserProxyRoute,
};
