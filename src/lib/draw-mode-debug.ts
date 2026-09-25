"use client";

const LS_KEY = "smart-notes.draw-mode-debug.v1";
const MAX_ENTRIES = 150;

export interface DrawModeEntry {
  ts: number;
  tag: string;
  fields: Record<string, unknown>;
}

function readRing(): DrawModeEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeRing(ring: DrawModeEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ring.slice(-MAX_ENTRIES)));
  } catch {
    // storage quota — ignore
  }
}

export function logDrawEvent(tag: string, fields: Record<string, unknown> = {}): void {
  const entry: DrawModeEntry = { ts: Date.now(), tag, fields };

  // localStorage ring (readable same-origin, desktop DevTools, av diag)
  const ring = readRing();
  ring.push(entry);
  writeRing(ring);

  // Server stdout — captured by runtime-stdout diag stream; works over Tailscale.
  // Guard for test environments (jsdom) where fetch is not available.
  if (typeof fetch !== "undefined") {
    void fetch("/api/draw-diag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => undefined);
  }
}

export function clearDrawDiag(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}
