"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, Sparkles, X } from "lucide-react";
import { streamJupyterFastLanePrompt } from "@/lib/api/jupyter";
import { inlineAiHandoff, parseInlineAiContext, type InlineAiInvocation } from "@/lib/inline-ai";
import { invokePdfRecord } from "@/components/pdf-record-panel";

export function InlineAiPopover({ pagePath, onContinue }: { pagePath: string; onContinue: (payload: { draft: string }) => void }) {
  const [invocation, setInvocation] = React.useState<InlineAiInvocation | null>(null);
  const [question, setQuestion] = React.useState("");
  const [answer, setAnswer] = React.useState("");
  const [answeredQuestion, setAnsweredQuestion] = React.useState("");
  const [error, setError] = React.useState("");
  const [working, setWorking] = React.useState(false);
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
      setQuestion(""); setAnswer(""); setAnsweredQuestion(""); setError(""); setWorking(false); setInvocation(detail);
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

  async function ask() {
    if (!invocation || !question.trim() || working) return;
    const controller = new AbortController(); abort.current = controller;
    setWorking(true); setAnswer(""); setError("");
    try {
      const result = await streamJupyterFastLanePrompt(pagePath, question, invocation.context, {
        signal: controller.signal,
        onDelta: (_, text) => { if (!controller.signal.aborted) setAnswer(text); },
      });
      if (!controller.signal.aborted) { setAnswer(result.text); setAnsweredQuestion(question); }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not get an answer. Try again.");
    } finally { if (!controller.signal.aborted) setWorking(false); }
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
        <button className="inline-ai-menu-action" role="menuitem" onClick={() => setInvocation({ ...invocation, menu: false })}><Sparkles size={16} /> Ask Companion...</button>
        {invocation.pdfRecord && <button className="inline-ai-menu-action" role="menuitem" onClick={() => { invokePdfRecord({ ...invocation.pdfRecord!, quick: true }); close(); }}>Record</button>}
        {invocation.pdfRecord && <button className="inline-ai-menu-action" role="menuitem" onClick={() => { invokePdfRecord(invocation.pdfRecord!); close(); }}>Record options…</button>}
        {invocation.menuActions?.map(action => <button key={action.id} className="inline-ai-menu-action" role="menuitem" data-testid={`inline-ai-menu-${action.id}`} onClick={() => { close(); action.run(); }}><MessageSquarePlus size={16} /> {action.label}</button>)}
      </> : <>
        <header><span><Sparkles size={16} /> Companion</span><button aria-label="Close Companion popover" onClick={close}><X size={16} /></button></header>
        <span className="inline-ai-target">{invocation.context.target}</span>
        <p className="inline-ai-helper">Uses full page text and table context. Images, ink, and linked files are not read.</p>
        <blockquote>{invocation.context.text || "This target has no text yet."}</blockquote>
        <div className="inline-ai-chips">{["Explain", "Summarize"].map(label => <button key={label} disabled={working} onClick={() => { setQuestion(`${label} this text.`); panel.current?.querySelector("textarea")?.focus(); }}>{label}</button>)}{invocation.pdfRecord && <button onClick={() => invokePdfRecord({ ...invocation.pdfRecord!, quick: true })}>Record</button>}</div>
        {invocation.pdfRecord && <button className="inline-ai-continue" onClick={() => invokePdfRecord(invocation.pdfRecord!)}>Add thought or choose note…</button>}
        <form onSubmit={e => { e.preventDefault(); void ask(); }}>
          <label htmlFor="inline-ai-question">Ask about this text</label>
          <textarea id="inline-ai-question" placeholder="What does this mean?" rows={3} maxLength={4000} value={question} disabled={working} onChange={e => setQuestion(e.target.value)} />
          <footer><span>Only this captured text is sent.</span><button className="inline-ai-ask" disabled={!question.trim() || working}>{working ? "Asking…" : error ? "Retry" : "Ask"}</button></footer>
        </form>
        {working && !answer && <p role="status">Thinking…</p>}
        {answer && <div className="inline-ai-answer" aria-live="polite" aria-busy={working}>{answer}</div>}
        {invocation.pdfRecord && answer && !working && answeredQuestion === question && <button className="inline-ai-continue" onClick={() => invokePdfRecord({ ...invocation.pdfRecord!, question: answeredQuestion, answer, quick: true })}>Record answer</button>}
        {error && <p role="alert">{error}</p>}
        <button className="inline-ai-continue" onClick={() => { onContinue({ draft: inlineAiHandoff(invocation.context, question, answer) }); close(); }}>Continue in Companion →</button>
      </>}
    </div>, document.body
  );
}
