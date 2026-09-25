import type { AppRpcOperation } from "@/lib/app-contract";

export const APP_FRAME_MESSAGE_SOURCE = "smart-notes-app-frame" as const;
export const APP_FRAME_HOST_SOURCE = "smart-notes-app-host" as const;
export const APP_FRAME_MAX_HEIGHT = 20_000;
export const APP_FRAME_MAX_MESSAGE_BYTES = 256 * 1024;
export const APP_FRAME_MAX_RESPONSE_BYTES = 1024 * 1024;
export const APP_FRAME_MAX_INFLIGHT_RPCS = 32;
export const APP_FRAME_RATE_WINDOW_MS = 10_000;
export const APP_FRAME_MAX_MESSAGES_PER_WINDOW = 240;
/** Upper bound on an openPage target path (SN-205); real existence is checked host-side. */
export const APP_FRAME_MAX_PAGE_PATH_LENGTH = 1024;
/** Upper bound on the free-text carried by a companion.send turn (SN-203). */
export const APP_FRAME_MAX_COMPANION_TEXT_LENGTH = 16_000;

export type AppFrameMessage =
  | { source: typeof APP_FRAME_MESSAGE_SOURCE; nonce: string; kind: "height"; height: number }
  | { source: typeof APP_FRAME_MESSAGE_SOURCE; nonce: string; kind: "heartbeat" }
  | { source: typeof APP_FRAME_MESSAGE_SOURCE; nonce: string; kind: "navigation-attempt" }
  | { source: typeof APP_FRAME_MESSAGE_SOURCE; nonce: string; kind: "runtime-unsupported" }
  | {
      source: typeof APP_FRAME_MESSAGE_SOURCE;
      nonce: string;
      kind: "rpc";
      requestId: string;
      tableId: string;
      operation: AppRpcOperation;
      rowId?: string;
      values?: unknown;
      query?: unknown;
    }
  | {
      source: typeof APP_FRAME_MESSAGE_SOURCE;
      nonce: string;
      kind: "accept";
      requestId: string;
      tableId: string;
      mutationId: string;
      values: unknown;
      retire?: { tableId: string; mutationId: string; upsertKey: string; values: unknown };
    }
  | {
      source: typeof APP_FRAME_MESSAGE_SOURCE;
      nonce: string;
      kind: "upsert";
      requestId: string;
      tableId: string;
      mutationId: string;
      upsertKey: string;
      values: unknown;
    }
  // SN-205: app-authored request to deep-link the host into an existing vault page.
  | {
      source: typeof APP_FRAME_MESSAGE_SOURCE;
      nonce: string;
      kind: "open-page";
      requestId: string;
      pagePath: string;
    }
  // SN-203: app-authored request to push a turn into the main companion and auto-run it.
  // Deliberately separate from the rpc/accept data channel so a reply can never land
  // in app/log data by construction.
  | {
      source: typeof APP_FRAME_MESSAGE_SOURCE;
      nonce: string;
      kind: "companion-send";
      requestId: string;
      text: string;
      payload: unknown;
    };

/**
 * App-frame request kinds are the app→host messages that expect a bounded
 * `rpc-result` reply and are inflight-tracked by the host limiter. Fire-and-forget
 * telemetry kinds (height/heartbeat/navigation-attempt/runtime-unsupported) are not.
 */
export const APP_FRAME_REQUEST_KINDS = ["rpc", "accept", "upsert", "open-page", "companion-send"] as const;

export function isAppFrameRequestKind(kind: unknown): kind is (typeof APP_FRAME_REQUEST_KINDS)[number] {
  return typeof kind === "string" && (APP_FRAME_REQUEST_KINDS as readonly string[]).includes(kind);
}

export interface AppFrameRpcResponse {
  source: "smart-notes-app-host";
  nonce: string;
  kind: "rpc-result";
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * SN-203 host→app delivery: a structured, best-effort message pushed into a
 * running app instance and surfaced through `smartNotesApp.companion.onMessage`.
 * Ephemeral — never queued, never replayed on reload.
 */
export interface AppFrameCompanionDeliver {
  source: "smart-notes-app-host";
  nonce: string;
  kind: "companion-deliver";
  messageId: string;
  message: unknown;
}

/**
 * Build a size-bounded companion-deliver envelope, or null when the payload
 * cannot be serialized or exceeds the host response bound. Returning null lets
 * the caller drop the delivery cleanly instead of posting an oversized message.
 */
export function buildCompanionDeliverMessage(
  nonce: string,
  messageId: string,
  message: unknown
): AppFrameCompanionDeliver | null {
  const envelope: AppFrameCompanionDeliver = {
    source: APP_FRAME_HOST_SOURCE,
    nonce,
    kind: "companion-deliver",
    messageId,
    message,
  };
  try {
    if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > APP_FRAME_MAX_RESPONSE_BYTES) {
      return null;
    }
  } catch {
    return null;
  }
  return envelope;
}

/**
 * SN-205: reduce an app-supplied openPage target to a canonical vault-relative
 * page path, or null when it is external/absolute/traversing/oversized. The
 * host still verifies the page actually EXISTS against the loaded vault tree;
 * this only rejects shapes that can never be a safe vault-relative target.
 */
export function normalizeVaultRelativePagePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > APP_FRAME_MAX_PAGE_PATH_LENGTH) return null;
  // Reject schemes (http:, mailto:, javascript:, //host) and protocol-relative URLs.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return null;
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return null;
  // Reject drive-absolute (C:/…, already caught by scheme test) and directory traversal.
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  return normalized;
}

export class AppFrameHostLimiter {
  private windowStartedAt = 0;
  private messageCount = 0;
  private readonly inflight = new Set<string>();

  admit(message: AppFrameMessage, now = Date.now()): string | null {
    if (this.windowStartedAt === 0 || now - this.windowStartedAt >= APP_FRAME_RATE_WINDOW_MS) {
      this.windowStartedAt = now;
      this.messageCount = 0;
    }
    if (this.messageCount >= APP_FRAME_MAX_MESSAGES_PER_WINDOW) {
      return "App frame message rate limit exceeded.";
    }
    this.messageCount += 1;
    if (!isAppFrameRequestKind(message.kind)) return null;
    const { requestId } = message as Extract<AppFrameMessage, { requestId: string }>;
    if (this.inflight.has(requestId)) return "Duplicate App table request id.";
    if (this.inflight.size >= APP_FRAME_MAX_INFLIGHT_RPCS) return "Too many in-flight App table requests.";
    this.inflight.add(requestId);
    return null;
  }

  finish(requestId: string): void {
    this.inflight.delete(requestId);
  }
}

export class AppFrameHostLimiterScope {
  private identity = "";
  private limiter = new AppFrameHostLimiter();

  forFrame(pagePath: string, nonce: string): AppFrameHostLimiter {
    const identity = `${pagePath}\u0000${nonce}`;
    if (identity !== this.identity) {
      this.identity = identity;
      this.limiter = new AppFrameHostLimiter();
    }
    return this.limiter;
  }
}

const APP_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src 'none'",
  "media-src 'none'",
  "connect-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
].join("; ");

function appBridgeScript(nonce: string, navigationApiAvailable: boolean): string {
  return `<script data-smart-notes-app-bridge="true">
(() => {
  'use strict';
  const source = ${JSON.stringify(APP_FRAME_MESSAGE_SOURCE)};
  const nonce = ${JSON.stringify(nonce)};
  const hostNavigationApiAvailable = ${JSON.stringify(navigationApiAvailable)};
  const nativeReflectApply = Reflect.apply;
  const nativePreventDefault = Event.prototype.preventDefault;
  const nativeDefaultPrevented = Object.getOwnPropertyDescriptor(Event.prototype, 'defaultPrevented')?.get;
  const preventDefault = (event) => { try { nativeReflectApply(nativePreventDefault, event, []); } catch {} };
  const isDefaultPrevented = (event) => { try { return nativeDefaultPrevented ? Boolean(nativeReflectApply(nativeDefaultPrevented, event, [])) : true; } catch { return true; } };
  const pending = new Map();
  const companionHandlers = [];
  let requestCounter = 0;
  const blocked = (name) => () => Promise.reject(new Error(name + ' is disabled by Smart Notes app policy.'));
  const blockedConstructor = (name) => function () { throw new Error(name + ' is disabled by Smart Notes app policy.'); };
  const lock = (target, name, value) => { try { Object.defineProperty(target, name, { value, configurable: false, writable: false }); } catch {} };
  lock(window, 'fetch', blocked('fetch'));
  lock(window, 'XMLHttpRequest', blockedConstructor('XMLHttpRequest'));
  lock(window, 'WebSocket', blockedConstructor('WebSocket'));
  lock(window, 'EventSource', blockedConstructor('EventSource'));
  lock(window, 'Worker', blockedConstructor('Worker'));
  lock(window, 'SharedWorker', blockedConstructor('SharedWorker'));
  lock(window, 'open', () => null);
  try { Object.defineProperty(navigator, 'sendBeacon', { value: () => false, configurable: false }); } catch {}

  const post = (message) => parent.postMessage({ source, nonce, ...message }, '*');
  const rpc = (operation, tableId, payload = {}, messageKind = 'rpc') => {
    if (typeof tableId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(tableId)) {
      return Promise.reject(new Error('Invalid app table id.'));
    }
    let serialized;
    try { serialized = JSON.stringify(payload); } catch { return Promise.reject(new Error('App RPC payload must be JSON.')); }
    const serializedBytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).byteLength : serialized.length;
    if (serializedBytes > ${APP_FRAME_MAX_MESSAGE_BYTES}) return Promise.reject(new Error('App RPC payload is too large.'));
    if (pending.size >= 64) return Promise.reject(new Error('Too many outstanding App table requests.'));
    const requestId = 'q_' + Date.now().toString(36) + '_' + (++requestCounter).toString(36);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('App table request timed out.'));
      }, 30000);
      pending.set(requestId, { resolve, reject, timeout });
      post(messageKind === 'accept'
        ? { kind: 'accept', requestId, tableId, ...payload }
        : messageKind === 'upsert'
          ? { kind: 'upsert', requestId, tableId, ...payload }
          : { kind: 'rpc', requestId, tableId, operation, ...payload });
    });
  };
  // Generic app→host request that expects a bounded rpc-result reply. Shares the
  // pending map + rpc-result resolution with table rpc, so openPage / companion.send
  // reuse the same size/timeout/limit machinery.
  const hostRequest = (kind, fields) => {
    let serialized;
    try { serialized = JSON.stringify(fields); } catch { return Promise.reject(new Error('Message must be JSON.')); }
    const serializedBytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).byteLength : serialized.length;
    if (serializedBytes > ${APP_FRAME_MAX_MESSAGE_BYTES}) return Promise.reject(new Error('Message is too large.'));
    if (pending.size >= 64) return Promise.reject(new Error('Too many outstanding host requests.'));
    const requestId = 'q_' + Date.now().toString(36) + '_' + (++requestCounter).toString(36);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('Host request timed out.')); }, 30000);
      pending.set(requestId, { resolve, reject, timeout });
      post({ kind, requestId, ...fields });
    });
  };
  const companion = Object.freeze({
    // App → companion: inject a main-companion turn carrying text + payload as
    // context and auto-run it. Resolves with the host ack; the reply renders in
    // the sidebar, never in app/log data.
    send: (input) => {
      const source = input && typeof input === 'object' ? input : {};
      const text = typeof source.text === 'string' ? source.text : '';
      const payload = 'payload' in source ? source.payload : null;
      return hostRequest('companion-send', { text, payload: payload === undefined ? null : payload });
    },
    // Companion → app: register a best-effort receiver for companion.deliver
    // events. Returns an unsubscribe function.
    onMessage: (handler) => {
      if (typeof handler !== 'function') return () => {};
      companionHandlers.push(handler);
      return () => { const index = companionHandlers.indexOf(handler); if (index >= 0) companionHandlers.splice(index, 1); };
    }
  });
  Object.defineProperty(window, 'smartNotesApp', {
    configurable: false,
    writable: false,
    value: Object.freeze({
      query: (tableId, query = {}) => rpc('query', tableId, { query }),
      add: (tableId, values) => rpc('add', tableId, { values }),
      accept: (tableId, values, mutationId, retire) => {
        if (typeof mutationId !== 'string' || !/^m_[A-Za-z0-9_-]{8,100}$/.test(mutationId)) return Promise.reject(new Error('A stable mutation id is required.'));
        if (retire !== undefined) {
          if (!retire || typeof retire !== 'object') return Promise.reject(new Error('A valid draft retirement is required.'));
          if (typeof retire.tableId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(retire.tableId)) return Promise.reject(new Error('A valid draft table id is required.'));
          if (typeof retire.mutationId !== 'string' || !/^m_[A-Za-z0-9_-]{8,100}$/.test(retire.mutationId)) return Promise.reject(new Error('A stable draft retirement mutation id is required.'));
          if (typeof retire.upsertKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(retire.upsertKey)) return Promise.reject(new Error('A stable draft retirement key is required.'));
        }
        return rpc('', tableId, { values, mutationId, ...(retire === undefined ? {} : { retire }) }, 'accept');
      },
      upsert: (tableId, upsertKey, values, mutationId) => {
        if (typeof mutationId !== 'string' || !/^m_[A-Za-z0-9_-]{8,100}$/.test(mutationId)) return Promise.reject(new Error('A stable mutation id is required.'));
        if (typeof upsertKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(upsertKey)) return Promise.reject(new Error('A stable upsert key is required.'));
        return rpc('', tableId, { values, mutationId, upsertKey }, 'upsert');
      },
      update: (tableId, rowId, values) => rpc('update', tableId, { rowId, values }),
      delete: (tableId, rowId) => rpc('delete', tableId, { rowId }),
      // SN-205: request host navigation to an existing vault page. Resolves on
      // accepted navigation; rejects with a bounded error when rejected.
      openPage: (pagePath) => {
        if (typeof pagePath !== 'string' || !pagePath.trim()) return Promise.reject(new Error('A page path is required.'));
        if (pagePath.length > ${APP_FRAME_MAX_PAGE_PATH_LENGTH}) return Promise.reject(new Error('Page path is too long.'));
        return hostRequest('open-page', { pagePath }).then((data) => data);
      },
      // SN-203: two-way companion channel, deliberately separate from table data.
      companion
    })
  });
  const navigationApi = window.navigation;
  if (!hostNavigationApiAvailable || !navigationApi || typeof navigationApi.addEventListener !== 'function') {
    post({ kind: 'runtime-unsupported' });
    return;
  }
  navigationApi.addEventListener('navigate', (event) => {
    preventDefault(event);
    post({ kind: 'navigation-attempt' });
  });
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.source !== 'smart-notes-app-host' || message.nonce !== nonce) return;
    let serialized;
    try { serialized = JSON.stringify(message); } catch { return; }
    const serializedBytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).byteLength : serialized.length;
    if (serializedBytes > ${APP_FRAME_MAX_RESPONSE_BYTES}) return;
    // SN-203: host→app companion delivery. Ephemeral, exact-shape, best-effort;
    // dispatched to every registered onMessage receiver. A missing receiver is a
    // safe no-op.
    if (message.kind === 'companion-deliver') {
      const keys = Object.keys(message).sort().join(',');
      if (keys !== 'kind,message,messageId,nonce,source' || typeof message.messageId !== 'string') return;
      companionHandlers.slice().forEach((handler) => { try { handler(message.message); } catch {} });
      return;
    }
    if (message.kind !== 'rpc-result') return;
    const keys = Object.keys(message).sort().join(',');
    const expectedKeys = (message.ok ? ['data','kind','nonce','ok','requestId','source'] : ['error','kind','nonce','ok','requestId','source']).sort().join(',');
    if (keys !== expectedKeys || typeof message.requestId !== 'string' || typeof message.ok !== 'boolean') return;
    if (!message.ok && (typeof message.error !== 'string' || message.error.length > 400)) return;
    const waiter = pending.get(message.requestId);
    if (!waiter) return;
    pending.delete(message.requestId);
    clearTimeout(waiter.timeout);
    if (message.ok) waiter.resolve(message.data);
    else waiter.reject(new Error(message.error || 'App table request failed.'));
  });

  const blockNavigation = (event) => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest('a') : null;
    if (anchor && !String(anchor.getAttribute('href') || '').startsWith('#')) {
      preventDefault(event); post({ kind: 'navigation-attempt' });
    }
  };
  document.addEventListener('click', blockNavigation, true);
  document.addEventListener('submit', (event) => {
    if (isDefaultPrevented(event)) return;
    preventDefault(event); post({ kind: 'navigation-attempt' });
  });
  const removeRefresh = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('meta[http-equiv="refresh" i]').forEach((node) => node.remove());
  };
  removeRefresh(document);
  new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(removeRefresh)))
    .observe(document.documentElement, { childList: true, subtree: true });

  const postHeight = () => {
    const root = document.documentElement;
    const body = document.body;
    const height = Math.max(root?.scrollHeight || 0, root?.offsetHeight || 0, body?.scrollHeight || 0, body?.offsetHeight || 0);
    post({ kind: 'height', height: Math.min(${APP_FRAME_MAX_HEIGHT}, Math.max(320, height)) });
  };
  const start = () => {
    postHeight();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(postHeight).observe(document.documentElement);
    [100, 400, 1000].forEach((delay) => setTimeout(postHeight, delay));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  setInterval(() => post({ kind: 'heartbeat' }), 1000);
})();
</script>`;
}

/**
 * Policy and bridge are emitted before every byte of companion-authored markup.
 * Full HTML documents are deliberately nested as authored content; browsers
 * retain their style/script/body contents while the outer policy stays first.
 */
export function buildAppSrcDoc(bodyHtml: string, nonce: string, navigationApiAvailable: boolean): string {
  return [
    "<!doctype html><html><head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    `<meta http-equiv="Content-Security-Policy" content=${JSON.stringify(APP_CSP)}>`,
    "<style>html,body{margin:0;min-height:100%;}body{font-family:system-ui,sans-serif;}</style>",
    appBridgeScript(nonce, navigationApiAvailable),
    "</head><body>",
    navigationApiAvailable ? bodyHtml : '<p data-smart-notes-app-unsupported="true">App Preview requires Navigation API enforcement.</p>',
    "</body></html>",
  ].join("");
}

export function parseAppFrameMessage(value: unknown, expectedNonce: string): AppFrameMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AppFrameMessage> & Record<string, unknown>;
  if (candidate.source !== APP_FRAME_MESSAGE_SOURCE || candidate.nonce !== expectedNonce) return null;
  const hasExactKeys = (allowed: string[]) => {
    const keys = Object.keys(candidate);
    return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
  };
  if (candidate.kind === "height") {
    if (!hasExactKeys(["source", "nonce", "kind", "height"]) || !Number.isFinite(candidate.height)) return null;
    return {
      source: APP_FRAME_MESSAGE_SOURCE,
      nonce: expectedNonce,
      kind: "height",
      height: Math.min(APP_FRAME_MAX_HEIGHT, Math.max(320, Number(candidate.height))),
    };
  }
  if (candidate.kind === "navigation-attempt" || candidate.kind === "heartbeat" || candidate.kind === "runtime-unsupported") {
    if (!hasExactKeys(["source", "nonce", "kind"])) return null;
    return { source: APP_FRAME_MESSAGE_SOURCE, nonce: expectedNonce, kind: candidate.kind };
  }
  // SN-205: open-page request. Shape + size only here; canonical existence is a
  // host-side check against the loaded vault tree.
  if (candidate.kind === "open-page") {
    if (!hasExactKeys(["source", "nonce", "kind", "requestId", "pagePath"])) return null;
    if (typeof candidate.requestId !== "string" || !/^q_[a-z0-9_]{1,110}$/.test(candidate.requestId)) return null;
    if (typeof candidate.pagePath !== "string") return null;
    if (candidate.pagePath.length === 0 || candidate.pagePath.length > APP_FRAME_MAX_PAGE_PATH_LENGTH) return null;
    try {
      if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > APP_FRAME_MAX_MESSAGE_BYTES) return null;
    } catch {
      return null;
    }
    return {
      source: APP_FRAME_MESSAGE_SOURCE,
      nonce: expectedNonce,
      kind: "open-page",
      requestId: candidate.requestId,
      pagePath: candidate.pagePath,
    };
  }
  // SN-203: companion-send request. text is bounded; payload is any JSON value.
  if (candidate.kind === "companion-send") {
    if (!hasExactKeys(["source", "nonce", "kind", "requestId", "text", "payload"])) return null;
    if (typeof candidate.requestId !== "string" || !/^q_[a-z0-9_]{1,110}$/.test(candidate.requestId)) return null;
    if (typeof candidate.text !== "string" || candidate.text.length > APP_FRAME_MAX_COMPANION_TEXT_LENGTH) return null;
    try {
      if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > APP_FRAME_MAX_MESSAGE_BYTES) return null;
    } catch {
      return null;
    }
    return {
      source: APP_FRAME_MESSAGE_SOURCE,
      nonce: expectedNonce,
      kind: "companion-send",
      requestId: candidate.requestId,
      text: candidate.text,
      payload: candidate.payload,
    };
  }
  if (candidate.kind !== "rpc" && candidate.kind !== "accept" && candidate.kind !== "upsert") return null;
  if (typeof candidate.requestId !== "string" || !/^q_[a-z0-9_]{1,110}$/.test(candidate.requestId)) return null;
  if (typeof candidate.tableId !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(candidate.tableId)) return null;
  if (candidate.kind === "accept") {
    const hasRetire = Object.prototype.hasOwnProperty.call(candidate, "retire");
    if (!hasExactKeys(hasRetire
      ? ["source", "nonce", "kind", "requestId", "tableId", "mutationId", "values", "retire"]
      : ["source", "nonce", "kind", "requestId", "tableId", "mutationId", "values"])) return null;
    if (typeof candidate.mutationId !== "string" || !/^m_[A-Za-z0-9_-]{8,100}$/.test(candidate.mutationId)) return null;
    if (!candidate.values || typeof candidate.values !== "object" || Array.isArray(candidate.values)) return null;
    let retire: { tableId: string; mutationId: string; upsertKey: string; values: unknown } | undefined;
    if (hasRetire) {
      if (!candidate.retire || typeof candidate.retire !== "object" || Array.isArray(candidate.retire)) return null;
      const value = candidate.retire as Record<string, unknown>;
      if (Object.keys(value).length !== 4 || !["tableId", "mutationId", "upsertKey", "values"].every((key) => Object.prototype.hasOwnProperty.call(value, key))) return null;
      if (typeof value.tableId !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.tableId)) return null;
      if (typeof value.mutationId !== "string" || !/^m_[A-Za-z0-9_-]{8,100}$/.test(value.mutationId)) return null;
      if (typeof value.upsertKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(value.upsertKey)) return null;
      if (!value.values || typeof value.values !== "object" || Array.isArray(value.values)) return null;
      retire = { tableId: value.tableId, mutationId: value.mutationId, upsertKey: value.upsertKey, values: value.values };
    }
    try { if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > APP_FRAME_MAX_MESSAGE_BYTES) return null; } catch { return null; }
    return {
      source: APP_FRAME_MESSAGE_SOURCE, nonce: expectedNonce, kind: "accept", requestId: candidate.requestId,
      tableId: candidate.tableId, mutationId: candidate.mutationId, values: candidate.values,
      ...(retire ? { retire } : {}),
    };
  }
  if (candidate.kind === "upsert") {
    if (!hasExactKeys(["source", "nonce", "kind", "requestId", "tableId", "mutationId", "upsertKey", "values"])) return null;
    if (typeof candidate.mutationId !== "string" || !/^m_[A-Za-z0-9_-]{8,100}$/.test(candidate.mutationId)) return null;
    if (typeof candidate.upsertKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(candidate.upsertKey)) return null;
    if (!candidate.values || typeof candidate.values !== "object" || Array.isArray(candidate.values)) return null;
    try { if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > APP_FRAME_MAX_MESSAGE_BYTES) return null; } catch { return null; }
    return {
      source: APP_FRAME_MESSAGE_SOURCE, nonce: expectedNonce, kind: "upsert", requestId: candidate.requestId,
      tableId: candidate.tableId, mutationId: candidate.mutationId, upsertKey: candidate.upsertKey, values: candidate.values,
    };
  }
  if (typeof candidate.operation !== "string" || !["query", "add", "update", "delete"].includes(candidate.operation)) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > APP_FRAME_MAX_MESSAGE_BYTES) return null;
  } catch {
    return null;
  }
  const base = {
    source: APP_FRAME_MESSAGE_SOURCE,
    nonce: expectedNonce,
    kind: "rpc" as const,
    requestId: candidate.requestId,
    tableId: candidate.tableId,
    operation: candidate.operation,
  };
  if (candidate.operation === "query") {
    if (!hasExactKeys(["source", "nonce", "kind", "requestId", "tableId", "operation", "query"])) return null;
    if (!candidate.query || typeof candidate.query !== "object" || Array.isArray(candidate.query)) return null;
    return { ...base, operation: "query", query: candidate.query };
  }
  if (candidate.operation === "add") {
    if (!hasExactKeys(["source", "nonce", "kind", "requestId", "tableId", "operation", "values"])) return null;
    if (!candidate.values || typeof candidate.values !== "object" || Array.isArray(candidate.values)) return null;
    return { ...base, operation: "add", values: candidate.values };
  }
  if (typeof candidate.rowId !== "string" || !/^r_[A-Za-z0-9_-]{6,80}$/.test(candidate.rowId)) return null;
  if (candidate.operation === "update") {
    if (!hasExactKeys(["source", "nonce", "kind", "requestId", "tableId", "operation", "rowId", "values"])) return null;
    if (!candidate.values || typeof candidate.values !== "object" || Array.isArray(candidate.values)) return null;
    return { ...base, operation: "update", rowId: candidate.rowId, values: candidate.values };
  }
  if (!hasExactKeys(["source", "nonce", "kind", "requestId", "tableId", "operation", "rowId"])) return null;
  return { ...base, operation: "delete", rowId: candidate.rowId };
}
