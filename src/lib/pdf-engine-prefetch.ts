/**
 * Idle-prefetch PDFium WASM (SN-148) so the first PDF open is warmer.
 * Safe to call multiple times; only the first call schedules work.
 */

const WASM_URL = "/pdfium.wasm";

let started = false;

export function prefetchPdfiumWasm(): void {
  if (typeof window === "undefined" || started) return;
  started = true;

  const run = () => {
    void fetch(WASM_URL, { cache: "force-cache" }).catch(() => {
      // Best-effort; the open path still loads WASM normally.
    });
  };

  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;

  if (typeof ric === "function") {
    ric(run, { timeout: 4000 });
  } else {
    window.setTimeout(run, 1200);
  }
}
