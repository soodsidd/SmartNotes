/**
 * @jest-environment node
 *
 * Unit tests for Cache Storage PDF re-open path (SN-148).
 */

import {
  PDF_VAULT_CACHE_NAME,
  clearPdfVaultCaches,
  clearSessionPdfBuffers,
  deletePdfFromVaultCache,
  fetchPdfWithVaultCache,
  isCompletePdfBuffer,
  isPdfBuffer,
  matchPdfInVaultCache,
  pdfBufferHasEofMarker,
  putPdfBufferInVaultCache,
  putPdfInVaultCache,
  revalidatePdfVaultCache,
} from "@/lib/pdf-vault-cache";

function pdfBytes(label = "a"): ArrayBuffer {
  // Minimal complete PDF: header + body + trailer marker (%%EOF).
  const text = `%PDF-1.4 ${label}\n%%EOF\n`;
  const buf = new ArrayBuffer(text.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i);
  return buf;
}

function truncatedPdfBytes(): ArrayBuffer {
  // Looks like a PDF header but missing %%EOF — the gray-page cache trap.
  const text = `%PDF-1.4 truncated-body-no-trailer`;
  const buf = new ArrayBuffer(text.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i);
  return buf;
}

function garbageBytes(): ArrayBuffer {
  const text = "NOT-A-PDF";
  const buf = new ArrayBuffer(text.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i);
  return buf;
}

function makeResponse(
  body: ArrayBuffer,
  init: { status?: number; etag?: string; contentLength?: boolean } = {}
): Response {
  const headers = new Headers();
  if (init.etag) headers.set("ETag", init.etag);
  if (init.contentLength !== false) {
    headers.set("Content-Length", String(body.byteLength));
  }
  return new Response(body.slice(0), {
    status: init.status ?? 200,
    headers,
  });
}

/** Minimal in-memory CacheStorage for Node unit tests. */
function createMemoryCaches(): CacheStorage {
  const buckets = new Map<string, Map<string, Response>>();

  const open = async (name: string): Promise<Cache> => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    const store = buckets.get(name)!;

    return {
      async match(request: RequestInfo | URL) {
        const key = typeof request === "string" ? request : String(request);
        const hit = store.get(key);
        return hit ? hit.clone() : undefined;
      },
      async put(request: RequestInfo | URL, response: Response) {
        const key = typeof request === "string" ? request : String(request);
        store.set(key, response.clone());
      },
      async delete(request: RequestInfo | URL) {
        const key = typeof request === "string" ? request : String(request);
        return store.delete(key);
      },
      async keys() {
        return [...store.keys()].map((k) => new Request(k));
      },
      async add() {
        throw new Error("not implemented");
      },
      async addAll() {
        throw new Error("not implemented");
      },
      async matchAll() {
        return [];
      },
    } as Cache;
  };

  return {
    open,
    async has(name: string) {
      return buckets.has(name);
    },
    async delete(name: string) {
      return buckets.delete(name);
    },
    async keys() {
      return [...buckets.keys()];
    },
    async match() {
      return undefined;
    },
  } as CacheStorage;
}

describe("pdf-vault-cache", () => {
  const href = "/vault/Notes/demo.assets/book.pdf";

  beforeEach(() => {
    clearSessionPdfBuffers();
  });

  test("exports a stable cache bucket name", () => {
    expect(PDF_VAULT_CACHE_NAME).toBe("smart-notes-vault-pdfs-v4");
  });

  test("isPdfBuffer accepts %PDF and rejects garbage", () => {
    expect(isPdfBuffer(pdfBytes("ok"))).toBe(true);
    expect(isPdfBuffer(garbageBytes())).toBe(false);
    expect(isPdfBuffer(new ArrayBuffer(0))).toBe(false);
  });

  test("isCompletePdfBuffer requires %%EOF trailer", () => {
    expect(isCompletePdfBuffer(pdfBytes("ok"))).toBe(true);
    expect(isCompletePdfBuffer(truncatedPdfBytes())).toBe(false);
    expect(pdfBufferHasEofMarker(truncatedPdfBytes())).toBe(false);
    expect(pdfBufferHasEofMarker(pdfBytes("ok"))).toBe(true);
  });

  test("putPdfBufferInVaultCache refuses truncated PDFs without %%EOF", async () => {
    const cachesImpl = createMemoryCaches();
    await putPdfBufferInVaultCache(href, truncatedPdfBytes(), {}, cachesImpl);
    expect(await matchPdfInVaultCache(href, cachesImpl)).toBeUndefined();
  });

  test("clearPdfVaultCaches removes vault PDF buckets", async () => {
    const cachesImpl = createMemoryCaches();
    await putPdfBufferInVaultCache(
      href,
      pdfBytes("x"),
      { etag: 'W/"x"' },
      cachesImpl
    );
    expect(await cachesImpl.has(PDF_VAULT_CACHE_NAME)).toBe(true);
    const removed = await clearPdfVaultCaches(cachesImpl);
    expect(removed).toBe(1);
    expect(await cachesImpl.has(PDF_VAULT_CACHE_NAME)).toBe(false);
  });

  test("put + match round-trip via assembled buffer", async () => {
    const cachesImpl = createMemoryCaches();
    const body = pdfBytes("v1");
    await putPdfBufferInVaultCache(
      href,
      body,
      { etag: 'W/"1"' },
      cachesImpl
    );
    const hit = await matchPdfInVaultCache(href, cachesImpl);
    expect(hit).toBeTruthy();
    expect(hit!.headers.get("ETag")).toBe('W/"1"');
    expect((await hit!.arrayBuffer()).byteLength).toBe(body.byteLength);
  });

  test("putPdfBufferInVaultCache refuses non-PDF payloads", async () => {
    const cachesImpl = createMemoryCaches();
    await putPdfBufferInVaultCache(href, garbageBytes(), {}, cachesImpl);
    expect(await matchPdfInVaultCache(href, cachesImpl)).toBeUndefined();
  });

  test("cache hit returns immediately and still revalidates in background", async () => {
    const cachesImpl = createMemoryCaches();
    const body = pdfBytes("cached");
    await putPdfBufferInVaultCache(
      href,
      body,
      { etag: 'W/"abc"' },
      cachesImpl
    );

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response(null, { status: 304 });
    }) as unknown as typeof fetch;

    const result = await fetchPdfWithVaultCache(href, {
      cachesImpl,
      fetchImpl,
      preferCache: true,
      revalidateDelayMs: 0,
    });

    expect(result.source).toBe("cache");
    expect(result.byteLength).toBe(body.byteLength);
    expect(new Uint8Array(result.buffer)[0]).toBe("%".charCodeAt(0));

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    expect(fetchCalls[0].url).toBe(href);
    expect(fetchCalls[0].init?.cache).toBe("no-cache");
    const headers = fetchCalls[0].init?.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe('W/"abc"');
  });

  test("warm Cache Storage hit returns bytes without a network request body", async () => {
    jest.useFakeTimers();
    try {
      const cachesImpl = createMemoryCaches();
      const body = pdfBytes("installed-pwa-warm-hit");
      await putPdfBufferInVaultCache(
        href,
        body,
        { etag: 'W/"warm"' },
        cachesImpl
      );

      const fetchImpl = jest.fn(async () => {
        throw new Error("warm hit must not wait for network");
      }) as unknown as typeof fetch;
      const sources: string[] = [];

      const result = await fetchPdfWithVaultCache(href, {
        cachesImpl,
        fetchImpl,
        onSource: (source) => sources.push(source),
      });

      expect(result.source).toBe("cache");
      expect(result.byteLength).toBe(body.byteLength);
      expect(sources).toEqual(["cache"]);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  test("same-tab buffer hit reports session resume without Cache Storage or network", async () => {
    const cachesImpl = createMemoryCaches();
    const body = pdfBytes("session");
    const fetchImpl = jest.fn(async () =>
      makeResponse(body, { etag: 'W/"session"' })
    ) as unknown as typeof fetch;

    expect(
      (await fetchPdfWithVaultCache(href, { cachesImpl, fetchImpl })).source
    ).toBe("network");

    const sources: string[] = [];
    const reopened = await fetchPdfWithVaultCache(href, {
      cachesImpl: null,
      fetchImpl,
      onSource: (source) => sources.push(source),
    });

    expect(reopened.source).toBe("session");
    expect(sources).toEqual(["session"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("corrupt cache hit is deleted and refetched from network", async () => {
    const cachesImpl = createMemoryCaches();
    await putPdfInVaultCache(
      href,
      makeResponse(garbageBytes(), { etag: 'W/"bad"' }),
      cachesImpl
    );

    const good = pdfBytes("repaired");
    const fetchImpl = jest.fn(async () =>
      makeResponse(good, { etag: 'W/"good"' })
    ) as unknown as typeof fetch;

    const result = await fetchPdfWithVaultCache(href, {
      cachesImpl,
      fetchImpl,
      preferCache: true,
    });

    expect(result.source).toBe("network");
    expect(result.byteLength).toBe(good.byteLength);
    expect(isPdfBuffer(result.buffer)).toBe(true);

    const hit = await matchPdfInVaultCache(href, cachesImpl);
    expect(hit).toBeTruthy();
    expect(hit!.headers.get("ETag")).toBe('W/"good"');
  });

  test("cold miss streams from network and stores for next open", async () => {
    const cachesImpl = createMemoryCaches();
    const body = pdfBytes("fresh");
    const fetchImpl = jest.fn(async () =>
      makeResponse(body, { etag: 'W/"2"' })
    ) as unknown as typeof fetch;

    const progress: Array<{ loaded: number; total: number | null }> = [];
    const result = await fetchPdfWithVaultCache(href, {
      cachesImpl,
      fetchImpl,
      onProgress: (loaded, total) => progress.push({ loaded, total }),
    });

    expect(result.source).toBe("network");
    expect(result.etag).toBe('W/"2"');
    expect(progress.length).toBeGreaterThan(0);

    // Allow fire-and-forget put to settle.
    await new Promise((r) => setTimeout(r, 20));
    const hit = await matchPdfInVaultCache(href, cachesImpl);
    expect(hit).toBeTruthy();
    expect((await hit!.arrayBuffer()).byteLength).toBe(body.byteLength);
  });

  test("network failure falls back to Cache Storage", async () => {
    const cachesImpl = createMemoryCaches();
    const body = pdfBytes("offline");
    await putPdfBufferInVaultCache(
      href,
      body,
      { etag: 'W/"z"' },
      cachesImpl
    );

    const result = await fetchPdfWithVaultCache(href, {
      cachesImpl,
      preferCache: false,
      fetchImpl: jest.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });

    expect(result.source).toBe("cache");
    expect(result.byteLength).toBe(body.byteLength);
  });

  test("revalidate updates cache on fresh 200", async () => {
    const cachesImpl = createMemoryCaches();
    await putPdfBufferInVaultCache(
      href,
      pdfBytes("old"),
      { etag: 'W/"old"' },
      cachesImpl
    );

    const newer = pdfBytes("new");
    const status = await revalidatePdfVaultCache(href, 'W/"old"', {
      cachesImpl,
      fetchImpl: jest.fn(async () =>
        makeResponse(newer, { etag: 'W/"new"' })
      ) as unknown as typeof fetch,
    });

    expect(status).toBe("updated");
    const hit = await matchPdfInVaultCache(href, cachesImpl);
    expect(hit!.headers.get("ETag")).toBe('W/"new"');
    expect((await hit!.arrayBuffer()).byteLength).toBe(newer.byteLength);
  });

  test("revalidate reports not-modified on 304", async () => {
    const status = await revalidatePdfVaultCache(href, 'W/"same"', {
      cachesImpl: createMemoryCaches(),
      fetchImpl: jest.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch,
    });
    expect(status).toBe("not-modified");
  });

  test("fetch uses cache: no-cache, never no-store", async () => {
    const cachesImpl = createMemoryCaches();
    const calls: RequestInit[] = [];
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init) calls.push(init);
      return makeResponse(pdfBytes("x"), { etag: 'W/"x"' });
    }) as unknown as typeof fetch;

    await fetchPdfWithVaultCache(href, { cachesImpl, fetchImpl });
    expect(calls[0].cache).toBe("no-cache");
    expect(calls[0].cache).not.toBe("no-store");
  });

  test("deletePdfFromVaultCache removes a single entry", async () => {
    const cachesImpl = createMemoryCaches();
    await putPdfBufferInVaultCache(href, pdfBytes("z"), {}, cachesImpl);
    expect(await deletePdfFromVaultCache(href, cachesImpl)).toBe(true);
    expect(await matchPdfInVaultCache(href, cachesImpl)).toBeUndefined();
  });
});
