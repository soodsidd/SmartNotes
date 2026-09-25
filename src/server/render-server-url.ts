const GLOBAL_PORT_KEY = "_smartNotesListenPort" as const;

type ListenPortGlobal = typeof globalThis & {
  [GLOBAL_PORT_KEY]?: number;
  _smartNotesListenPort?: number;
};

/** True when Smart Notes is running via `npm run dev` / next dev (preview inspect path). */
export function isDevRuntime(): boolean {
  return process.env.npm_lifecycle_event === "dev" || process.env.NODE_ENV !== "production";
}

/** Port the HTTP server actually bound (set in server.js at listen time). */
export function getBoundListenPort(): number | undefined {
  const globalScope = globalThis as ListenPortGlobal;
  const port = globalScope[GLOBAL_PORT_KEY] ?? globalScope._smartNotesListenPort;
  return Number.isFinite(port) && port! > 0 ? port : undefined;
}

export function setBoundListenPort(port: number): void {
  const globalScope = globalThis as ListenPortGlobal;
  globalScope[GLOBAL_PORT_KEY] = port;
  globalScope._smartNotesListenPort = port;
}

/**
 * Loopback base URL Playwright uses to load `/render/page`.
 * Prefer the bound listen port over PORT env — AV preview injects PORT at spawn
 * time but some code paths only see the value after listen.
 */
export function resolveRenderServerBaseUrl(): string {
  const override = process.env.SMART_NOTES_RENDER_BASE_URL?.trim();
  if (override) {
    return override.replace(/\/$/, "");
  }

  const host = process.env.SMART_NOTES_RENDER_HOST?.trim() || "127.0.0.1";
  const port = getBoundListenPort() ?? Number.parseInt(String(process.env.PORT || "3002"), 10);
  return `http://${host}:${port}`;
}

export function resolvePublicServerBaseUrl(): string {
  const override = process.env.SMART_NOTES_PUBLIC_BASE_URL?.trim();
  if (override) {
    return override.replace(/\/$/, "");
  }
  return resolveRenderServerBaseUrl();
}
