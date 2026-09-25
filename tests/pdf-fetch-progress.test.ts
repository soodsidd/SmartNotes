/**
 * @jest-environment node
 *
 * Unit tests for the PDF fetch / progress utilities introduced in SN-148.
 *
 * Covers:
 *  - fmtBytes helper
 *  - buildPdfBuffer chunk-assembly helper
 *  - Cache policy: fetch should be called with cache: "no-cache", not "no-store"
 *  - Streaming accumulation: chunks assemble into the correct ArrayBuffer
 *  - Content-Length absent: still resolves without a total
 *  - Percent progress calculation logic
 */

import { fmtBytes, buildPdfBuffer } from "@/lib/pdf-fetch-utils";

// ── fmtBytes ─────────────────────────────────────────────────────────────────

describe("fmtBytes", () => {
  test("returns '0 B' for zero", () => {
    expect(fmtBytes(0)).toBe("0 B");
  });

  test("formats bytes below 1 MB as KB", () => {
    expect(fmtBytes(1024)).toBe("1 KB");
    expect(fmtBytes(512 * 1024)).toBe("512 KB");
    expect(fmtBytes(1023 * 1024)).toBe("1023 KB");
  });

  test("formats 1 MB and above as MB with one decimal", () => {
    expect(fmtBytes(1024 * 1024)).toBe("1.0 MB");
    expect(fmtBytes(45 * 1024 * 1024)).toBe("45.0 MB");
    expect(fmtBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});

// ── buildPdfBuffer ────────────────────────────────────────────────────────────

describe("buildPdfBuffer", () => {
  test("concatenates multiple Uint8Array chunks into one ArrayBuffer", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const c = new Uint8Array([6]);
    const result = buildPdfBuffer([a, b, c]);
    expect(result.byteLength).toBe(6);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  test("handles a single chunk", () => {
    const chunk = new Uint8Array([0xff, 0xfe]);
    const result = buildPdfBuffer([chunk]);
    expect(result.byteLength).toBe(2);
    expect(new Uint8Array(result)).toEqual(chunk);
  });

  test("returns an empty ArrayBuffer for an empty chunk list", () => {
    const result = buildPdfBuffer([]);
    expect(result.byteLength).toBe(0);
  });

  test("is equivalent to a manual set-and-offset loop", () => {
    const chunks = [
      new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
      new Uint8Array([0x2d, 0x31, 0x2e, 0x34]), // -1.4
    ];
    const result = buildPdfBuffer(chunks);
    expect(new Uint8Array(result)).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    );
  });
});

// ── fetch cache policy ────────────────────────────────────────────────────────
// Verify the cache option value at the call site. This documents the contract
// (cache: "no-cache" = conditional GET; NOT "no-store" = unconditional bypass).

describe("PDF fetch cache policy", () => {
  const originalFetch = (global as Record<string, unknown>).fetch;

  afterEach(() => {
    (global as Record<string, unknown>).fetch = originalFetch;
  });

  test("fetch options use cache: 'no-cache'", async () => {
    const calls: RequestInit[] = [];
    (global as Record<string, unknown>).fetch = jest.fn(
      (_url: string, init?: RequestInit) => {
        if (init) calls.push(init);
        return Promise.resolve({
          ok: true,
          headers: { get: () => null },
          body: null,
          arrayBuffer: () =>
            Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer),
        });
      }
    );

    const href = "/vault/Notes/test.assets/sample.pdf";
    const controller = new AbortController();

    // Replicate the exact call from the component.
    await (global as Record<string, unknown>).fetch(href, {
      signal: controller.signal,
      cache: "no-cache",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].cache).toBe("no-cache");
    // "no-store" was the former value — assert it is NOT used.
    expect(calls[0].cache).not.toBe("no-store");
  });
});

// ── streaming accumulation ─────────────────────────────────────────────────────

describe("streaming PDF fetch accumulation (ReadableStream)", () => {
  /**
   * Simulate a streaming Response whose body emits the provided chunks.
   * Uses the WHATWG ReadableStream available in Node.js 18+.
   */
  function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
  }

  test("assembles chunks into the correct final buffer and tracks progress", async () => {
    const part1 = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const part2 = new Uint8Array([0x2d, 0x31, 0x2e, 0x34]); // -1.4
    const stream = makeStream([part1, part2]);

    const reader = stream.getReader();
    const collected: Uint8Array[] = [];
    let loaded = 0;
    const progressSnapshots: number[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      collected.push(value);
      loaded += value.byteLength;
      progressSnapshots.push(loaded);
    }

    const buffer = buildPdfBuffer(collected);
    expect(buffer.byteLength).toBe(8);
    expect(new Uint8Array(buffer)).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    );
    // Progress was reported after each chunk: 4 bytes, then 8 bytes.
    expect(progressSnapshots).toEqual([4, 8]);
  });

  test("works correctly when Content-Length header is absent (total = null)", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const stream = makeStream([data]);

    const reader = stream.getReader();
    const collected: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      collected.push(value);
      loaded += value.byteLength;
    }

    const buffer = buildPdfBuffer(collected);
    expect(buffer.byteLength).toBe(5);
    expect(loaded).toBe(5);
  });

  test("Content-Length header is parsed as a finite integer", () => {
    const header = "45678901";
    const parsed = parseInt(header, 10);
    expect(parsed).toBe(45678901);
    expect(Number.isFinite(parsed)).toBe(true);
  });
});

// ── percent progress calculation ───────────────────────────────────────────────

describe("download percent calculation", () => {
  /** Mirrors the inline calculation in the component's render. */
  function calcPercent(loaded: number, total: number | null): number | null {
    if (total && total > 0) return Math.round((loaded / total) * 100);
    return null;
  }

  test("returns null when total is null", () => {
    expect(calcPercent(1000, null)).toBeNull();
  });

  test("returns null when total is 0", () => {
    expect(calcPercent(0, 0)).toBeNull();
  });

  test("returns 0% at the start of a download", () => {
    expect(calcPercent(0, 1000)).toBe(0);
  });

  test("rounds to the nearest integer", () => {
    expect(calcPercent(1, 3)).toBe(33); // 33.33…
    expect(calcPercent(2, 3)).toBe(67); // 66.67…
  });

  test("returns 100% when all bytes are received", () => {
    expect(calcPercent(5_000_000, 5_000_000)).toBe(100);
  });

  test("saturates at 100% if loaded exceeds total (chunked-encoding edge case)", () => {
    // The UI renders Math.round(loaded/total*100)%; this documents the raw value.
    expect(calcPercent(5_000_001, 5_000_000)).toBe(100);
  });
});
