"use client";

const STORAGE_KEY = "smart-notes.pdf-render-debug.v1";
const MAX_ENTRIES = 200;

export interface PdfRenderDiagnosticEntry {
  ts: number;
  openId: string;
  tag: string;
  fields: Record<string, unknown>;
}

function readRing(): PdfRenderDiagnosticEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRing(entries: PdfRenderDiagnosticEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Diagnostics must never interfere with the reader when storage is full.
  }
}

export function createPdfRenderOpenId(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `pdf-${Date.now().toString(36)}-${suffix}`;
}

export function logPdfRenderEvent(
  openId: string,
  tag: string,
  fields: Record<string, unknown> = {}
): void {
  const entry: PdfRenderDiagnosticEntry = {
    ts: Date.now(),
    openId,
    tag,
    fields,
  };

  const ring = readRing();
  ring.push(entry);
  writeRing(ring);

  // Same-origin relay reaches the managed runtime even when the installed PWA
  // bypasses AV's browser capture proxy. Runtime stdout is ingested by av diag.
  if (typeof fetch !== "undefined") {
    void fetch("/api/pdf-render-diag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => undefined);
  }
}

