import crypto from "node:crypto";

const TOKEN_TTL_MS = 60_000;

interface RenderTokenEntry {
  pagePath: string;
  expiresAt: number;
}

/**
 * Next.js compiles route handlers (`/api/agent/vault`) and RSC page routes
 * (`/render/page`) into separate module bundles. A plain module-level Map is
 * therefore instantiated once per bundle, so a token issued while rendering is
 * invisible to the render route and every capture 404s. Anchoring the store on
 * `globalThis` (which is a true per-process singleton) keeps issue/verify on the
 * same Map regardless of which bundle imported this file.
 */
const GLOBAL_KEY = Symbol.for("smart-notes.page-render-tokens");

type TokenGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, RenderTokenEntry>;
};

function getTokenStore(): Map<string, RenderTokenEntry> {
  const globalScope = globalThis as TokenGlobal;
  if (!globalScope[GLOBAL_KEY]) {
    globalScope[GLOBAL_KEY] = new Map<string, RenderTokenEntry>();
  }
  return globalScope[GLOBAL_KEY];
}

function pruneExpiredTokens(now = Date.now()) {
  const store = getTokenStore();
  for (const [token, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(token);
    }
  }
}

export function issueRenderToken(pagePath: string, ttlMs = TOKEN_TTL_MS): string {
  pruneExpiredTokens();
  const token = crypto.randomBytes(24).toString("hex");
  getTokenStore().set(token, { pagePath, expiresAt: Date.now() + ttlMs });
  return token;
}

export function verifyRenderToken(pagePath: string, token: string): boolean {
  pruneExpiredTokens();
  const store = getTokenStore();
  const entry = store.get(token);
  if (!entry) return false;
  if (entry.pagePath !== pagePath) return false;
  if (entry.expiresAt < Date.now()) {
    store.delete(token);
    return false;
  }
  return true;
}

export function resetRenderTokensForTesting() {
  getTokenStore().clear();
}
