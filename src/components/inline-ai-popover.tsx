"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Crop, FileImage, Highlighter, MessageSquarePlus, NotebookPen, Sparkles, X } from "lucide-react";
import { parseInlineAiContext, type InlineAiInvocation, type InlineAiRelayObserver, type InlineAiRelayRequest, type InlineAiSpeed } from "@/lib/inline-ai";
import { invokePdfRecord } from "@/components/pdf-record-panel";

export function InlineAiPopover({ pagePath, onAsk, onOpenCompanion }: {
  pagePath: string;
  onAsk: (request: InlineAiRelayRequest, observer: InlineAiRelayObserver) => void;
  onOpenCompanion: () => void;
}) {
  const [invocation, setInvocation] = React.useState<InlineAiInvocation | null>(null);
  const [question, setQuestion] = React.useState("");
  const [answer, setAnswer] = React.useState("");
  const [answeredQuestion, setAnsweredQuestion] = React.useState("");
  const [error, setError] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [speed, setSpeed] = React.useState<InlineAiSpeed>("fast");
  const [edit, setEdit] = React.useState(false);
  const [inserted, setInserted] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const invocationRef = React.useRef<InlineAiInvocation | null>(null);
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const close = React.useCallback(() => {
    abort.current?.abort(); abort.current = null;
    invocationRef.current?.onClose?.();
    invocationRef.current = null;
    setInvocation(null); setWorking(false);
    previousFocus.current?.focus();
  }, []);
  React.useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<InlineAiInvocation>).detail;
      if (!detail || !parseInlineAiContext(detail.context) || !Number.isFinite(detail.x) || !Number.isFinite(detail.y)) return;
      abort.current?.abort(); abort.current = null;
      invocationRef.current = detail;
      previousFocus.current = document.activeElement as HTMLElement;
      setQuestion(""); setAnswer(""); setAnsweredQuestion(""); setError(""); setWorking(false); setSpeed("fast"); setEdit(false); setInserted(false); setInvocation(detail);
    };
    window.addEventListener("smart-notes-ask-companion", open);
    return () => { window.removeEventListener("smart-notes-ask-companion", open); abort.current?.abort(); };
  }, []);
  React.useEffect(() => {
    const dismiss = (event: Event) => {
      if (invocationRef.current?.sourceId === (event as CustomEvent<string>).detail) close();
    };
    window.addEventListener("smart-notes-ask-companion-dismiss", dismiss);
    return () => window.removeEventListener("smart-notes-ask-companion-dismiss", dismiss);
  }, [close]);
  React.useEffect(close, [pagePath, close]);
  // The one-row menu (frames, PDF) dismisses like a context menu; the open dialog stays put.
  React.useEffect(() => {
    if (!invocation?.menu) return;
    const dismiss = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [invocation, close]);
  React.useLayoutEffect(() => {
    if (!invocation || !panel.current) return;
    const el = panel.current;
    const position = () => {
      const rect = el.getBoundingClientRect();
      el.style.left = `${Math.max(8, Math.min(invocation.x, window.innerWidth - rect.width - 8))}px`;
      el.style.top = `${Math.max(8, Math.min(invocation.y, window.innerHeight - rect.height - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(el);
    window.addEventListener("resize", position);
    el.querySelector<HTMLElement>(invocation.menu ? "button" : "textarea")?.focus();
    return () => { observer.disconnect(); window.removeEventListener("resize", position); };
  }, [invocation]);

  function ask(prompt = question) {
    if (!invocation || !prompt.trim() || working) return;
    const controller = new AbortController(); abort.current = controller;
    setWorking(true); setAnswer(""); setError(""); setInserted(false);
    const askedQuestion = prompt;
    const editTurn = edit && Boolean(invocation.applyEdit);
    try {
      onAsk({ question: askedQuestion, context: invocation.context, speed, edit: editTurn }, {
        onText: (text) => { if (!controller.signal.aborted) setAnswer(text); },
        onDone: (text) => {
          if (controller.signal.aborted) return;
          setAnswer(text); setAnsweredQuestion(askedQuestion); setWorking(false);
          if (!editTurn) return;
          void Promise.resolve(invocation.applyEdit?.(text)).catch(() => false).then((applied) => {
            if (controller.signal.aborted) return;
            if (applied) setInserted(true);
            else setError("The answer could not be inserted into this editor.");
          });
        },
        onError: (message) => { if (!controller.signal.aborted) { setError(message); setWorking(false); } },
      });
    } catch (err) {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "Could not get an answer. Try again."); setWorking(false); }
    }
  }
  if (!invocation) return null;
  return createPortal(
    <div ref={panel} className="inline-ai-popover" role={invocation.menu ? "menu" : "dialog"} aria-label="Companion" data-testid="ask-companion-popover"
      onKeyDown={e => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        if (e.key === "Tab") {
          const controls = panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled),textarea:not(:disabled)");
          if (!controls?.length) return;
          if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls[controls.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === controls[controls.length - 1]) { e.preventDefault(); controls[0].focus(); }
        }
      }}>
      {invocation.menu ? <>
        {invocation.pdfHighlight && <button className="inline-ai-menu-action" role="menuitem" data-testid="inline-ai-menu-highlight" onClick={() => { const highlight = invocation.pdfHighlight!; close(); highlight(); }}><Highlighter size={16} /> Highlight</button>}
        {invocation.pdfRecord && <button className="inline-ai-menu-action" role="menuitem" onClick={() => { invokePdfRecord({ ...invocation.pdfRecord!, quick: true }); close(); }}><NotebookPen size={16} /> Record</button>}
        {invocation.pdfRecord && <button className="inline-ai-menu-action" role="menuitem" onClick={() => { invokePdfRecord(invocation.pdfRecord!); close(); }}><NotebookPen size={16} /> Record options…</button>}
        {invocation.pdfClip && <button className="inline-ai-menu-action" role="menuitem" data-testid="inline-ai-menu-record-area" onClick={() => { const clip = invocation.pdfClip!; close(); clip.area(); }}><Crop size={16} /> Record area</button>}
        {invocation.pdfClip && <button className="inline-ai-menu-action" role="menuitem" data-testid="inline-ai-menu-record-page" onClick={() => { const clip = invocation.pdfClip!; close(); clip.page(); }}><FileImage size={16} /> Record page</button>}
        <button className="inline-ai-menu-action" role="menuitem" onClick={() => setInvocation({ ...invocation, menu: false })}><Sparkles size={16} /> Ask Companion...</button>
        {invocation.menuActions?.map(action => <button key={action.id} className="inline-ai-menu-action" role="menuitem" data-testid={`inline-ai-menu-${action.id}`} onClick={() => { close(); action.run(); }}><MessageSquarePlus size={16} /> {action.label}</button>)}
      </> : <>
        <header><span><Sparkles size={16} /> Companion</span><button aria-label="Close Companion popover" onClick={close}><X size={16} /></button></header>
        <span className="inline-ai-target">{invocation.context.target}</span>
        <p className="inline-ai-helper">Uses full page text and table context. Images, ink, and linked files are not read.</p>
        <blockquote>{invocation.context.text || "This target has no text yet."}</blockquote>
        <div className="inline-ai-chips">{["Explain", "Summarize"].map(label => <button key={label} disabled={working} onClick={() => { const prompt = `${label} this text.`; setQuestion(prompt); ask(prompt); }}>{label}</button>)}{invocation.pdfRecord && <button onClick={() => invokePdfRecord({ ...invocation.pdfRecord!, quick: true })}>Record</button>}</div>
        <div className="inline-ai-chips" role="group" aria-label="Companion turn mode">
          {(["fast", "slow"] as const).map(value => <button key={value} type="button" aria-pressed={speed === value} disabled={working} onClick={() => setSpeed(value)}>{value === "fast" ? "Fast" : "Slow"}</button>)}
          {invocation.applyEdit && <button type="button" aria-pressed={edit} disabled={working} onClick={() => setEdit(value => !value)}>Edit</button>}
        </div>
        {invocation.pdfRecord && <button className="inline-ai-continue" onClick={() => invokePdfRecord(invocation.pdfRecord!)}>Add thought or choose note…</button>}
        <form onSubmit={e => { e.preventDefault(); ask(); }}>
          <label htmlFor="inline-ai-question">Ask about this text</label>
          <textarea id="inline-ai-question" placeholder="What does this mean?" rows={3} maxLength={4000} value={question} disabled={working} onChange={e => setQuestion(e.target.value)} />
          <footer><span>Selection and surrounding page context are sent.</span><button className="inline-ai-ask" disabled={!question.trim() || working}>{working ? "Asking…" : error ? "Retry" : "Ask"}</button></footer>
        </form>
        {working && !answer && <p role="status">Thinking…</p>}
        {answer && <div className="inline-ai-answer" aria-live="polite" aria-busy={working}>{answer}</div>}
        {invocation.pdfRecord && answer && !working && answeredQuestion === question && <button className="inline-ai-continue" onClick={() => invokePdfRecord({ ...invocation.pdfRecord!, question: answeredQuestion, answer, quick: true })}>Record answer</button>}
        {inserted && <p role="status">Inserted into the page.</p>}
        {error && <p role="alert">{error}</p>}
        <button className="inline-ai-continue" onClick={() => { onOpenCompanion(); close(); }}>Open in Companion →</button>
      </>}
    </div>, document.body
  );
}
