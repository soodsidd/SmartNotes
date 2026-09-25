/**
 * HTTP helpers for /vault/* asset responses (SN-148).
 *
 * Pure functions so unit tests can cover ETag / conditional GET / Range
 * parsing without spinning up the Next custom server.
 */

/**
 * Build a weak ETag from file size + mtime (ms). Stable across process
 * restarts as long as the file on disk is unchanged.
 *
 * @param {{ size: number, mtimeMs: number }} st
 * @returns {string}
 */
function buildVaultAssetEtag(st) {
  const mtime = Math.floor(Number(st.mtimeMs) || 0);
  const size = Number(st.size) || 0;
  return `W/"${size.toString(16)}-${mtime.toString(16)}"`;
}

/**
 * Format a Date / mtime ms for Last-Modified (HTTP-date, GMT).
 *
 * @param {number | Date} mtime
 * @returns {string}
 */
function formatHttpDate(mtime) {
  const date = mtime instanceof Date ? mtime : new Date(mtime);
  return date.toUTCString();
}

/**
 * Decide whether a conditional request should short-circuit with 304.
 *
 * Prefers If-None-Match (ETag) when present; falls back to
 * If-Modified-Since. Weak ETags are compared as opaque strings.
 *
 * @param {import('http').IncomingMessage | { headers?: Record<string, string | string[] | undefined> }} req
 * @param {{ etag: string, lastModifiedMs: number }} meta
 * @returns {boolean}
 */
function shouldRespondNotModified(req, meta) {
  const headers = req.headers || {};
  const inm = headers["if-none-match"];
  if (typeof inm === "string" && inm.trim()) {
    // Clients may send a comma-separated list; any match is enough.
    const candidates = inm.split(",").map((v) => v.trim());
    if (candidates.includes(meta.etag) || candidates.includes("*")) {
      return true;
    }
    // No ETag match → treat as modified even if If-Modified-Since matches.
    return false;
  }

  const ims = headers["if-modified-since"];
  if (typeof ims === "string" && ims.trim()) {
    const since = Date.parse(ims);
    if (!Number.isNaN(since) && Math.floor(meta.lastModifiedMs) <= since) {
      return true;
    }
  }

  return false;
}

/**
 * Parse a single-range `bytes=` Range header. Returns null when absent,
 * malformed, multi-range, or unsatisfiable against `size`.
 *
 * @param {string | undefined} rangeHeader
 * @param {number} size
 * @returns {{ start: number, end: number } | null}
 */
function parseSingleByteRange(rangeHeader, size) {
  if (!rangeHeader || typeof rangeHeader !== "string") return null;
  const trimmed = rangeHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bytes=")) return null;
  const spec = trimmed.slice(6);
  // Multi-range (comma) is not supported for vault assets.
  if (spec.includes(",")) return null;

  const dash = spec.indexOf("-");
  if (dash < 0) return null;
  const startRaw = spec.slice(0, dash);
  const endRaw = spec.slice(dash + 1);

  let start;
  let end;

  if (startRaw === "") {
    // Suffix form: bytes=-N → last N bytes
    const suffix = parseInt(endRaw, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(startRaw, 10);
    if (!Number.isFinite(start) || start < 0) return null;
    end = endRaw === "" ? size - 1 : parseInt(endRaw, 10);
    if (!Number.isFinite(end) || end < start) return null;
    end = Math.min(end, size - 1);
  }

  if (start >= size) return null;
  return { start, end };
}

module.exports = {
  buildVaultAssetEtag,
  formatHttpDate,
  shouldRespondNotModified,
  parseSingleByteRange,
};
