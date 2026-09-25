/**
 * Cache Storage for vault PDF attachments (SN-148).
 *
 * The PWA service worker intentionally bypasses `/vault/*` so large binaries
 * are not mixed into the app-shell cache. This module stores PDFs the reader
 * has already opened so re-opens (including during the few seconds a PWA is
 * still "connecting") can skip a full re-download.
 *
 * Important: we never `cache.put()` a late-consumed `response.clone()` of a
 * streaming fetch. On Chromium/Android that path can truncate large bodies,
 * so the next open serves a corrupt PDF (page count may still parse; paint is
 * gray). We only store fully assembled ArrayBuffers that pass a `%PDF` check,
 * and we discard invalid cache hits before falling back to the network.
 *
 * Freshness when online: after serving a cached copy we revalidate with
 * `If-None-Match` in the background and replace the entry on a 200. Cold
 * misses still stream from the network with `cache: "no-cache"`.
 */

import { buildPdfBuffer } from "@/lib/pdf-fetch-utils";

/**
 * Bumped when validation rules change so phones abandon corrupt Local copies.
 * v3: assembled-buffer put + %PDF header check.
 * v4: also require a trailing %%EOF (truncated Chromium bodies often keep %PDF
 * and still parse a page count while paint stays gray forever).
 */
export const PDF_VAULT_CACHE_NAME = "smart-notes-vault-pdfs-v4";

/** Prefix used by FORCE_RELOAD / Settings → Reload app to drop vault PDF caches. */
export const PDF_VAULT_CACHE_PREFIX = "smart-notes-vault-pdfs-";

/**
 * Delete Cache Storage buckets used for vault PDF re-opens.
 * Called from Settings → Reload app so a stale PWA shell + PDF cache can be
 * cleared without Android/iOS system settings.
 *
 * Does NOT touch localStorage reader prefs (`smart-notes:pdf-reader:*`) — last
 * page / zoom survive a PDF-cache clear.
 */
export async function clearPdfVaultCaches(
  cachesImpl?: CacheStorage | null
): Promise<number> {
  const store =
    cachesImpl === null
      ? null
      : cachesImpl ?? (typeof caches !== "undefined" ? caches : null);
  if (!store) return 0;
  try {
    const keys = await store.keys();
    const targets = keys.filter((name) => name.startsWith(PDF_VAULT_CACHE_PREFIX));
    await Promise.all(targets.map((name) => store.delete(name)));
    return targets.length;
  } catch {
    return 0;
  }
}

export type PdfVaultFetchSource = "network" | "cache" | "session";

export interface PdfVaultFetchResult {
  buffer: ArrayBuffer;
  source: PdfVaultFetchSource;
  etag: string | null;
  byteLength: number;
}

export interface PdfVaultFetchOptions {
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number | null) => void;
  /**
   * Reports the selected byte source before progress starts. Cache/session
   * callbacks let the reader say "Resuming" instead of briefly presenting a
   * local hit as a fresh download.
   */
  onSource?: (source: PdfVaultFetchSource) => void;
  /** Test seam — defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Test seam — defaults to global `caches` when available. */
  cachesImpl?: CacheStorage | null;
  /**
   * When true (default), a Cache Storage hit is returned immediately and a
   * background revalidation updates the entry for the next open.
   */
  preferCache?: boolean;
  /**
   * Delay before background revalidation after a Cache Storage hit.
   * Default 15000 so revalidation cannot contend with first-paint WASM work.
   * Tests may pass 0.
   */
  revalidateDelayMs?: number;
}

/** Same-tab reopen cache — avoids re-reading ~30MB from Cache Storage. */
const sessionPdfBuffers = new Map<
  string,
  { buffer: ArrayBuffer; etag: string | null }
>();

export function clearSessionPdfBuffers(): void {
  sessionPdfBuffers.clear();
}

function peekSessionPdf(href: string): PdfVaultFetchResult | null {
  const hit = sessionPdfBuffers.get(href);
  if (!hit || !isCompletePdfBuffer(hit.buffer)) return null;
  return {
    buffer: hit.buffer.slice(0),
    source: "session",
    etag: hit.etag,
    byteLength: hit.buffer.byteLength,
  };
}

function rememberSessionPdf(
  href: string,
  buffer: ArrayBuffer,
  etag: string | null
): void {
  if (!isCompletePdfBuffer(buffer)) return;
  sessionPdfBuffers.set(href, { buffer: buffer.slice(0), etag });
}


function resolveCaches(
  cachesImpl: CacheStorage | null | undefined
): CacheStorage | null {
  if (cachesImpl === null) return null;
  if (cachesImpl) return cachesImpl;
  if (typeof caches !== "undefined") return caches;
  return null;
}

async function openPdfCache(
  store: CacheStorage | null
): Promise<Cache | null> {
  if (!store) return null;
  try {
    return await store.open(PDF_VAULT_CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * True when `buffer` starts with `%PDF` (minimal integrity check before we
 * hand bytes to PDFium or persist them in Cache Storage).
 */
export function isPdfBuffer(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength < 5) return false;
  const head = new Uint8Array(buffer, 0, 5);
  return (
    head[0] === 0x25 && // %
    head[1] === 0x50 && // P
    head[2] === 0x44 && // D
    head[3] === 0x46 && // F
    head[4] === 0x2d // -
  );
}

/**
 * True when the last 1 KiB of `buffer` contains `%%EOF` (ASCII). Truncated
 * large-PDF cache entries often keep a valid `%PDF` header (and may still
 * report a page count) but lose the trailer — paint then stays gray.
 */
export function pdfBufferHasEofMarker(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength < 8) return false;
  const windowSize = Math.min(1024, buffer.byteLength);
  const tail = new Uint8Array(buffer, buffer.byteLength - windowSize, windowSize);
  // Scan for '%' '%' 'E' 'O' 'F'
  for (let i = 0; i <= tail.length - 5; i++) {
    if (
      tail[i] === 0x25 &&
      tail[i + 1] === 0x25 &&
      tail[i + 2] === 0x45 &&
      tail[i + 3] === 0x4f &&
      tail[i + 4] === 0x46
    ) {
      return true;
    }
  }
  return false;
}

/** Cache / open gate: header + trailer present. */
export function isCompletePdfBuffer(buffer: ArrayBuffer): boolean {
  return isPdfBuffer(buffer) && pdfBufferHasEofMarker(buffer);
}

/**
 * Persist a successful network Response under `href`. Best-effort: quota
 * pressure deletes other entries once and retries.
 *
 * Prefer {@link putPdfBufferInVaultCache} for fetch results — only use this
 * with a Response whose body is already fully buffered (not a live network
 * stream clone).
 */
export async function putPdfInVaultCache(
  href: string,
  response: Response,
  cachesImpl?: CacheStorage | null
): Promise<void> {
  const store = resolveCaches(cachesImpl);
  const cache = await openPdfCache(store);
  if (!cache || !response.ok) return;

  const toStore = response.clone();
  try {
    await cache.put(href, toStore);
  } catch {
    try {
      const keys = await cache.keys();
      await Promise.all(keys.map((key) => cache.delete(key)));
      await cache.put(href, response.clone());
    } catch {
      // Quota / private mode — ignore; next open will hit the network again.
    }
  }
}

/**
 * Store a fully assembled PDF buffer. Rejects non-PDF payloads so we never
 * persist a truncated stream as a "successful" cache entry.
 */
export async function putPdfBufferInVaultCache(
  href: string,
  buffer: ArrayBuffer,
  meta: { etag?: string | null; contentType?: string | null } = {},
  cachesImpl?: CacheStorage | null
): Promise<void> {
  // Refuse truncated bodies — %PDF alone is not enough (gray-page trap).
  if (!isCompletePdfBuffer(buffer)) return;

  const headers = new Headers();
  headers.set("Content-Type", meta.contentType || "application/pdf");
  headers.set("Content-Length", String(buffer.byteLength));
  if (meta.etag) headers.set("ETag", meta.etag);

  // slice() so Cache Storage owns an independent copy (PDFium may detach).
  const response = new Response(buffer.slice(0), { status: 200, headers });
  await putPdfInVaultCache(href, response, cachesImpl);
}

export async function matchPdfInVaultCache(
  href: string,
  cachesImpl?: CacheStorage | null
): Promise<Response | undefined> {
  const store = resolveCaches(cachesImpl);
  const cache = await openPdfCache(store);
  if (!cache) return undefined;
  try {
    return (await cache.match(href)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function deletePdfFromVaultCache(
  href: string,
  cachesImpl?: CacheStorage | null
): Promise<boolean> {
  const store = resolveCaches(cachesImpl);
  const cache = await openPdfCache(store);
  if (!cache) return false;
  try {
    return await cache.delete(href);
  } catch {
    return false;
  }
}

async function readResponseBuffer(
  response: Response,
  onProgress?: (loaded: number, total: number | null) => void
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("Content-Length");
  const total = contentLength ? parseInt(contentLength, 10) : null;

  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
    return buildPdfBuffer(chunks);
  }

  const buffer = await response.arrayBuffer();
  onProgress?.(buffer.byteLength, buffer.byteLength);
  return buffer;
}

/**
 * Background revalidation — does not throw to callers.
 * Updates Cache Storage when the server returns a fresh 200 with a valid PDF.
 */
export async function revalidatePdfVaultCache(
  href: string,
  etag: string | null,
  options: {
    fetchImpl?: typeof fetch;
    cachesImpl?: CacheStorage | null;
    signal?: AbortSignal;
  } = {}
): Promise<"not-modified" | "updated" | "skipped" | "failed"> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {};
  if (etag) headers["If-None-Match"] = etag;

  try {
    const response = await fetchImpl(href, {
      signal: options.signal,
      cache: "no-cache",
      headers,
    });

    if (response.status === 304) return "not-modified";
    if (!response.ok) return "failed";

    const buffer = await response.arrayBuffer();
    if (!isCompletePdfBuffer(buffer)) return "failed";

    await putPdfBufferInVaultCache(
      href,
      buffer,
      {
        etag: response.headers.get("ETag"),
        contentType: response.headers.get("Content-Type"),
      },
      options.cachesImpl
    );
    return "updated";
  } catch {
    return "failed";
  }
}

/**
 * Fetch a vault PDF using Cache Storage for fast / offline re-opens.
 *
 * - Cache hit + `preferCache` (default): return cached bytes immediately and
 *   revalidate in the background — but only if the entry is a complete PDF
 *   (`%PDF` + trailing `%%EOF`).
 * - Invalid / truncated cache entries are deleted and treated as a miss.
 * - Cache miss: network stream with progress, then store the assembled buffer.
 * - Network failure with a valid cache hit: return the cached copy.
 */
export async function fetchPdfWithVaultCache(
  href: string,
  options: PdfVaultFetchOptions = {}
): Promise<PdfVaultFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const preferCache = options.preferCache !== false;

  // Fast same-tab reopen (exit reader → open again) — no Cache Storage read.
  const sessionHit = peekSessionPdf(href);
  if (sessionHit && preferCache) {
    options.onSource?.("session");
    options.onProgress?.(sessionHit.byteLength, sessionHit.byteLength);
    return sessionHit;
  }

  let cached = await matchPdfInVaultCache(href, options.cachesImpl);

  if (cached && preferCache) {
    const etag = cached.headers.get("ETag");
    const buffer = (await cached.arrayBuffer()).slice(0);
    if (isCompletePdfBuffer(buffer)) {
      options.onSource?.("cache");
      options.onProgress?.(buffer.byteLength, buffer.byteLength);
      rememberSessionPdf(href, buffer, etag);
      // Defer revalidation so it cannot contend with first-paint WASM work.
      const delayMs =
        typeof options.revalidateDelayMs === "number"
          ? Math.max(0, options.revalidateDelayMs)
          : 15_000;
      const schedule =
        typeof window !== "undefined" ? window.setTimeout.bind(window) : setTimeout;
      schedule(() => {
        void revalidatePdfVaultCache(href, etag, {
          fetchImpl,
          cachesImpl: options.cachesImpl,
          signal: options.signal,
        });
      }, delayMs);
      return {
        buffer,
        source: "cache",
        etag,
        byteLength: buffer.byteLength,
      };
    }
    // Truncated / corrupt entry — drop it and fall through to network.
    await deletePdfFromVaultCache(href, options.cachesImpl);
    cached = undefined;
  }

  try {
    options.onSource?.("network");
    const headers: Record<string, string> = {};
    if (cached) {
      const etag = cached.headers.get("ETag");
      if (etag) headers["If-None-Match"] = etag;
    }

    const response = await fetchImpl(href, {
      signal: options.signal,
      cache: "no-cache",
      headers,
    });

    if (response.status === 304 && cached) {
      const buffer = (await cached.arrayBuffer()).slice(0);
      if (isCompletePdfBuffer(buffer)) {
        options.onSource?.("cache");
        options.onProgress?.(buffer.byteLength, buffer.byteLength);
        rememberSessionPdf(href, buffer, cached.headers.get("ETag"));
        return {
          buffer,
          source: "cache",
          etag: cached.headers.get("ETag"),
          byteLength: buffer.byteLength,
        };
      }
      await deletePdfFromVaultCache(href, options.cachesImpl);
      throw new Error("Cached PDF was corrupt after 304");
    }

    if (!response.ok) {
      throw new Error(`PDF request failed (${response.status})`);
    }

    // Assemble first, then cache the complete buffer — never put a live clone.
    const buffer = await readResponseBuffer(response, options.onProgress);
    if (!isCompletePdfBuffer(buffer)) {
      throw new Error("PDF response was not a complete PDF");
    }

    // Optional length check when the server advertised Content-Length.
    const declared = response.headers.get("Content-Length");
    if (declared) {
      const expected = parseInt(declared, 10);
      if (Number.isFinite(expected) && expected > 0 && buffer.byteLength !== expected) {
        throw new Error(
          `PDF download incomplete (${buffer.byteLength} of ${expected} bytes)`
        );
      }
    }

    const etag = response.headers.get("ETag");
    rememberSessionPdf(href, buffer, etag);
    void putPdfBufferInVaultCache(
      href,
      buffer,
      {
        etag,
        contentType: response.headers.get("Content-Type"),
      },
      options.cachesImpl
    );

    return {
      buffer,
      source: "network",
      etag,
      byteLength: buffer.byteLength,
    };
  } catch (error) {
    if (cached) {
      const buffer = (await cached.arrayBuffer()).slice(0);
      if (isCompletePdfBuffer(buffer)) {
        options.onSource?.("cache");
        options.onProgress?.(buffer.byteLength, buffer.byteLength);
        rememberSessionPdf(href, buffer, cached.headers.get("ETag"));
        return {
          buffer,
          source: "cache",
          etag: cached.headers.get("ETag"),
          byteLength: buffer.byteLength,
        };
      }
      await deletePdfFromVaultCache(href, options.cachesImpl);
    }
    throw error;
  }
}
