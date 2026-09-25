/**
 * @jest-environment node
 *
 * Unit tests for vault asset HTTP helpers (SN-148): ETag, conditional GET,
 * and single-range parsing used by server.js serveVaultAsset.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  buildVaultAssetEtag,
  formatHttpDate,
  shouldRespondNotModified,
  parseSingleByteRange,
} = require("../server/vault-asset-http");

describe("buildVaultAssetEtag", () => {
  test("is stable for the same size + mtime", () => {
    const a = buildVaultAssetEtag({ size: 1024, mtimeMs: 1_700_000_000_000 });
    const b = buildVaultAssetEtag({ size: 1024, mtimeMs: 1_700_000_000_000 });
    expect(a).toBe(b);
    expect(a.startsWith('W/"')).toBe(true);
  });

  test("changes when size or mtime changes", () => {
    const base = buildVaultAssetEtag({ size: 1024, mtimeMs: 1_700_000_000_000 });
    expect(buildVaultAssetEtag({ size: 2048, mtimeMs: 1_700_000_000_000 })).not.toBe(base);
    expect(buildVaultAssetEtag({ size: 1024, mtimeMs: 1_700_000_000_001 })).not.toBe(base);
  });
});

describe("formatHttpDate", () => {
  test("formats as GMT HTTP-date", () => {
    const formatted = formatHttpDate(Date.UTC(2024, 0, 15, 12, 0, 0));
    expect(formatted).toContain("GMT");
    expect(formatted).toContain("2024");
  });
});

describe("shouldRespondNotModified", () => {
  const meta = {
    etag: 'W/"400-abc"',
    lastModifiedMs: Date.UTC(2024, 5, 1, 0, 0, 0),
  };

  test("returns true when If-None-Match matches ETag", () => {
    expect(
      shouldRespondNotModified({ headers: { "if-none-match": meta.etag } }, meta)
    ).toBe(true);
  });

  test("returns false when If-None-Match does not match", () => {
    expect(
      shouldRespondNotModified(
        { headers: { "if-none-match": 'W/"other"' } },
        meta
      )
    ).toBe(false);
  });

  test("falls back to If-Modified-Since when no If-None-Match", () => {
    const ims = new Date(meta.lastModifiedMs).toUTCString();
    expect(
      shouldRespondNotModified({ headers: { "if-modified-since": ims } }, meta)
    ).toBe(true);
  });

  test("returns false when If-Modified-Since is older than file", () => {
    const older = new Date(meta.lastModifiedMs - 60_000).toUTCString();
    expect(
      shouldRespondNotModified({ headers: { "if-modified-since": older } }, meta)
    ).toBe(false);
  });

  test("returns false with no conditional headers", () => {
    expect(shouldRespondNotModified({ headers: {} }, meta)).toBe(false);
  });
});

describe("parseSingleByteRange", () => {
  test("parses inclusive start-end ranges", () => {
    expect(parseSingleByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
  });

  test("parses open-ended ranges", () => {
    expect(parseSingleByteRange("bytes=100-", 1000)).toEqual({
      start: 100,
      end: 999,
    });
  });

  test("parses suffix ranges", () => {
    expect(parseSingleByteRange("bytes=-50", 1000)).toEqual({
      start: 950,
      end: 999,
    });
  });

  test("returns null for multi-range or malformed", () => {
    expect(parseSingleByteRange("bytes=0-10,20-30", 1000)).toBeNull();
    expect(parseSingleByteRange("bytes=abc", 1000)).toBeNull();
    expect(parseSingleByteRange(undefined, 1000)).toBeNull();
  });

  test("returns null when start is past EOF", () => {
    expect(parseSingleByteRange("bytes=1000-1005", 1000)).toBeNull();
  });
});
