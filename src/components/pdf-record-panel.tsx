"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { fetchVaultTree } from "@/lib/api/pages";
import type { PdfRecordInput, PdfRecordSource } from "@/lib/pdf-record";

export interface PdfRecordInvocation {
  source: PdfRecordSource;
  defaultDestinationPath: string;
  quick?: boolean;
  question?: string;
  answer?: string;
}

export function invokePdfRecord(detail: PdfRecordInvocation) {
  window.dispatchEvent(new CustomEvent("smart-notes-pdf-record", { detail }));
}

type RecordState = "editing" | "saving" | "saved" | "error" | "undoing";
type CurrentRecord = { input: PdfRecordInput; state: RecordState; error?: string; attempted: boolean };

function sessionDestination(source: PdfRecordSource, fallback: string): string {
  try { return sessionStorage.getItem(`smart-notes-pdf-record:${source.pdfPath}`) || fallback; }
  catch { return fallback; }
}

async function recordRequest(input: PdfRecordInput, method: "POST" | "DELETE") {
  const response = await fetch("/api/pdf-record", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(method === "POST" ? input : { id: input.id, destinationPath: input.destinationPath }),
  });
  const result = await response.json().catch(() => ({})) as { error?: string; path?: string; removed?: boolean };
  if (!response.ok || result.path !== input.destinationPath || (method === "DELETE" && !result.removed)) {
    throw new Error(result.error || "The note write was not confirmed. Retry to check it safely.");
  }
}

export function PdfRecordPanel({ onOpenNote }: { onOpenNote: (path: string) => void }) {
  const [current, setCurrent] = React.useState<CurrentRecord | null>(null);
  const currentRef = React.useRef<CurrentRecord | null>(null);
  const [destinations, setDestinations] = React.useState<Array<{ path: string; title: string }>>([]);
  const [dictationError, setDictationError] = React.useState("");
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const update = React.useCallback((next: CurrentRecord | null) => { currentRef.current = next; setCurrent(next); }, []);

  const save = React.useCallback(async (record: CurrentRecord) => {
    if (currentRef.current?.input.id !== record.input.id || currentRef.current.state === "saving") return;
    update({ ...record, state: "saving", attempted: true, error: undefined });
    try {
      await recordRequest(record.input, "POST");
      if (currentRef.current?.input.id === record.input.id) update({ ...record, state: "saved", attempted: true });
    } catch (error) {
      if (currentRef.current?.input.id === record.input.id) update({ ...record, state: "error", attempted: true, error: error instanceof Error ? error.message : "Save failed. Retry." });
    }
  }, [update]);

  React.useEffect(() => {
    const onRecord = (event: Event) => {
      const detail = (event as CustomEvent<PdfRecordInvocation>).detail;
      if (!detail?.source?.pdfPath || !detail.defaultDestinationPath) return;
      if (["saving", "error", "undoing"].includes(currentRef.current?.state ?? "")) return;
      const destinationPath = sessionDestination(detail.source, detail.defaultDestinationPath);
      const record: CurrentRecord = {
        input: { ...detail.source, id: crypto.randomUUID(), destinationPath, question: detail.question, answer: detail.answer },
        state: "editing", attempted: false,
      };
      update(record);
      setDictationError("");
      if (detail.quick) void save(record);
      void fetchVaultTree().then(({ tree }) => {
        const notes = tree.flatMap(notebook => [
          ...notebook.pages.map(page => ({ path: page.path, title: page.title })),
          ...notebook.sections.flatMap(section => section.pages.map(page => ({ path: page.path, title: page.title }))),
        ]);
        setDestinations(notes.filter((note, index) => notes.findIndex(other => other.path === note.path) === index));
      }).catch(() => undefined);
    };
    window.addEventListener("smart-notes-pdf-record", onRecord);
    return () => window.removeEventListener("smart-notes-pdf-record", onRecord);
  }, [save, update]);

  async function undo(record: CurrentRecord) {
    update({ ...record, state: "undoing" });
    try {
      await recordRequest(record.input, "DELETE");
      if (currentRef.current?.input.id === record.input.id) update(null);
    } catch (error) {
      if (currentRef.current?.input.id === record.input.id) update({ ...record, state: "saved", error: error instanceof Error ? error.message : "Undo failed. Try again." });
    }
  }

  function editInput(patch: Partial<PdfRecordInput>) {
    if (!current || current.attempted) return;
    const input = { ...current.input, ...patch };
    update({ ...current, input });
    if (patch.destinationPath) {
      try { sessionStorage.setItem(`smart-notes-pdf-record:${input.pdfPath}`, patch.destinationPath); } catch { /* session storage unavailable */ }
    }
  }

  function dictate() {
    const speechWindow = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.onerror = () => setDictationError("Dictation did not start. You can type your thought.");
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript;
      const record = currentRef.current;
      if (text && record && !record.attempted) update({ ...record, input: { ...record.input, thought: [record.input.thought, text].filter(Boolean).join(" ") } });
    };
    try { recognition.start(); } catch { setDictationError("Dictation did not start. You can type your thought."); }
  }

  if (!mounted || !current) return null;
  const { input, state } = current;
  const supportsDictation = Boolean((window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  return createPortal(<div className="pdf-record-panel" role="dialog" aria-label="Record PDF passage" data-testid="pdf-record-panel">
    <header><strong>Record · {input.pdfTitle}, page {input.page}</strong><button type="button" aria-label="Close Record panel" disabled={state === "saving" || state === "error" || state === "undoing"} onClick={() => update(null)}>×</button></header>
    <p className="pdf-record-panel__quote">{input.quote === null ? "Source text unavailable from this PDF highlight." : input.quote}</p>
    {state === "editing" && <>
      <label htmlFor="pdf-record-destination">Save in</label>
      <select id="pdf-record-destination" value={input.destinationPath} onChange={event => editInput({ destinationPath: event.target.value })}>
        {!destinations.some(note => note.path === input.destinationPath) && <option value={input.destinationPath}>{input.destinationPath}</option>}
        {destinations.map(note => <option key={note.path} value={note.path}>{note.title} · {note.path}</option>)}
      </select>
      <label htmlFor="pdf-record-thought">Your thought (optional)</label>
      <textarea id="pdf-record-thought" value={input.thought ?? ""} onChange={event => editInput({ thought: event.target.value })} />
      {dictationError && <p role="alert">{dictationError}</p>}
      <div className="pdf-record-panel__actions"><button type="button" disabled={!supportsDictation} onClick={dictate}>{supportsDictation ? "Dictate thought" : "Dictation unavailable"}</button><button type="button" className="pdf-record-panel__primary" onClick={() => void save(current)}>Record</button></div>
    </>}
    {state === "saving" || state === "undoing" ? <p role="status">{state === "saving" ? "Saving…" : "Undoing…"}</p> : null}
    {state === "error" && <div role="alert"><p>{current.error}</p><button type="button" onClick={() => void save(current)}>Retry in {input.destinationPath}</button></div>}
    {state === "saved" && <div role="status"><p>Saved in {input.destinationPath}</p><div className="pdf-record-panel__actions"><button type="button" onClick={() => onOpenNote(input.destinationPath)}>Open note</button><button type="button" onClick={() => void undo(current)}>Undo</button></div></div>}
    {state === "saved" && current.error && <p role="alert">{current.error}</p>}
  </div>, document.body);
}

interface SpeechRecognitionLike {
  onresult: ((event: { results?: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start(): void;
}
