/**
 * Pure utility functions for the PDF fetch / streaming pipeline (SN-148).
 *
 * Kept separate from the React component so they can be unit-tested without
 * mounting the full reader and without any DOM / browser API dependencies.
 */

/**
 * Format a byte count as a human-readable string.
 *
 * @param b — number of bytes
 * @returns formatted string, e.g. "512 KB" or "45.0 MB"
 */
export function fmtBytes(b: number): string {
  if (b === 0) return "0 B";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Assemble an array of `Uint8Array` chunks (from a `ReadableStream` read loop)
 * into a single contiguous `ArrayBuffer`.
 *
 * @param chunks — ordered list of byte chunks received from the stream reader
 * @returns a single `ArrayBuffer` containing all chunk bytes in order
 */
export function buildPdfBuffer(chunks: Uint8Array[]): ArrayBuffer {
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const buffer = new ArrayBuffer(totalBytes);
  const view = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}
