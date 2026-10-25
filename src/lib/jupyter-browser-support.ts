/**
 * SN-129 / SN-360: decide whether this browser can host remote JupyterLab.
 * Mobile/PWA is a same-origin proxy client of the desktop-hosted Lab — not a
 * phone-local runtime — so we only hard-fail when WebSockets or cookies are
 * truly unavailable.
 */

export function cookiesAvailable(): boolean {
  if (typeof navigator === "undefined") return true;
  if (navigator.cookieEnabled) return true;
  // Some mobile WebViews / PWA modes report cookieEnabled === false even when
  // first-party cookies work. Probe before declaring unsupported.
  if (typeof document === "undefined") return false;
  try {
    const key = "sn_jupyter_cookie_probe";
    document.cookie = `${key}=1; SameSite=Lax; path=/`;
    const ok = document.cookie.includes(`${key}=`);
    document.cookie = `${key}=; Max-Age=0; path=/`;
    return ok;
  } catch {
    return false;
  }
}

/** Null when the browser can attempt Lab; otherwise a human-readable reason. */
export function unsupportedBrowserReason(): string | null {
  if (typeof window === "undefined") return null;
  if (!("WebSocket" in window)) {
    return "WebSocket support is unavailable, so Jupyter kernel channels cannot connect.";
  }
  if (!cookiesAvailable()) {
    return "Cookies are disabled, so JupyterLab cannot keep its authenticated session.";
  }
  return null;
}

/**
 * SN-360: class names for a cached Jupyter frame host inside the height-bearing
 * jupyter surface. Active hosts participate in flex height; inactive keep-alive
 * hosts stay laid out (visibility/absolute) instead of display:none so mobile
 * WebKit does not collapse the surface or freeze kernel WebSockets mid-session.
 */
export function jupyterFrameHostClassName(visible: boolean): string {
  return visible
    ? "relative flex min-h-0 flex-1 flex-col"
    : "pointer-events-none invisible absolute inset-0 flex min-h-0 flex-col";
}
