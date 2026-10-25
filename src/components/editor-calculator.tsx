"use client";

import * as React from "react";
import { X } from "lucide-react";
import { calculateExpression } from "@/lib/scientific-calculator";

const INACTIVITY_MS = 60_000;
const EDGE = 8;
const KEYS = [
  ["sin", "cos", "tan", "(", ")"],
  ["log", "ln", "√", "^", "%"],
  ["7", "8", "9", "÷", "C"],
  ["4", "5", "6", "×", "⌫"],
  ["1", "2", "3", "−", "π"],
  ["0", ".", "e", "+", "="],
];

export function EditorCalculator({
  hostRef,
  initialExpression,
  focusToken,
  onClose,
  popupRef,
}: {
  hostRef: React.RefObject<HTMLDivElement>;
  initialExpression: string;
  focusToken: number;
  onClose: () => void;
  popupRef: React.RefObject<HTMLDivElement>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [expression, setExpression] = React.useState(initialExpression);
  const [degrees, setDegrees] = React.useState(true);
  const [message, setMessage] = React.useState("");
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const resetTimeout = React.useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(onClose, INACTIVITY_MS);
  }, [onClose]);

  React.useEffect(() => {
    resetTimeout();
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [resetTimeout]);

  React.useEffect(() => { inputRef.current?.focus(); }, [focusToken]);

  const clampPosition = React.useCallback((left: number, top: number) => {
    const host = hostRef.current;
    const panel = popupRef.current;
    if (!host || !panel) return { left, top };
    return {
      left: Math.max(EDGE, Math.min(left, host.clientWidth - panel.offsetWidth - EDGE)),
      top: Math.max(EDGE, Math.min(top, host.clientHeight - panel.offsetHeight - EDGE)),
    };
  }, [hostRef, popupRef]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      setPosition((current) => current ? clampPosition(current.left, current.top) : current);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [clampPosition, hostRef]);

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag) setPosition(clampPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y));
    };
    const stop = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [clampPosition]);

  const calculate = async () => {
    resetTimeout();
    try {
      const result = calculateExpression(expression, degrees);
      setExpression(result);
      await navigator.clipboard.writeText(result);
      setMessage("Copied result. Paste in the editor.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not calculate");
    }
    inputRef.current?.focus();
  };

  const press = (key: string) => {
    resetTimeout();
    setMessage("");
    if (key === "=") { void calculate(); return; }
    if (key === "C") { setExpression(""); inputRef.current?.focus(); return; }
    if (key === "⌫") { setExpression((current) => current.slice(0, -1)); inputRef.current?.focus(); return; }
    const token = ["sin", "cos", "tan", "log", "ln"].includes(key) ? `${key}(` : key === "√" ? "sqrt(" : key;
    setExpression((current) => current + token);
    inputRef.current?.focus();
  };

  return (
    <section
      ref={popupRef}
      aria-label="Scientific calculator"
      data-testid="editor-calculator"
      className="absolute z-20 flex max-h-[calc(100%_-_1rem)] w-[min(22rem,calc(100%_-_1rem))] flex-col overflow-auto rounded-md border border-border bg-popover p-3 font-sans text-foreground shadow-md"
      style={position ? position : { right: EDGE, top: EDGE }}
      onPointerDown={resetTimeout}
      onKeyDown={(event) => {
        resetTimeout();
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      }}
    >
      <div
        className="mb-2 flex cursor-move touch-none select-none items-center justify-between gap-2 text-sm font-medium"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const host = hostRef.current;
          const panel = popupRef.current;
          if (!host || !panel) return;
          // Without this, dragging starts a native text selection across the editor.
          event.preventDefault();
          const hostRect = host.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          dragRef.current = { x: event.clientX, y: event.clientY, left: panelRect.left - hostRect.left, top: panelRect.top - hostRect.top };
        }}
      >
        <span>Scientific calculator</span>
        <button type="button" aria-label="Close calculator" className="flex size-11 items-center justify-center rounded-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring xl:size-8" onClick={onClose}><X className="size-4" /></button>
      </div>
      <label htmlFor="editor-calculator-expression" className="mb-1 text-xs text-muted-foreground">Expression</label>
      <input
        ref={inputRef}
        id="editor-calculator-expression"
        data-testid="editor-calculator-expression"
        value={expression}
        onChange={(event) => { setExpression(event.target.value); setMessage(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void calculate(); } }}
        className="mb-2 h-11 w-full rounded-sm border border-input bg-background px-3 text-right text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        autoComplete="off"
        spellCheck={false}
      />
      <button type="button" aria-pressed={degrees} onClick={() => setDegrees((value) => !value)} className="mb-2 self-start rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring">{degrees ? "DEG" : "RAD"}</button>
      <div className="grid grid-cols-5 gap-1">
        {KEYS.flat().map((key, index) => (
          <button
            key={`${key}-${index}`}
            type="button"
            aria-label={key === "⌫" ? "Backspace" : key === "C" ? "Clear" : key === "=" ? "Calculate and copy" : key}
            onClick={() => press(key)}
            className={`min-h-11 rounded-sm border border-border text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring ${key === "=" ? "bg-accent text-accent-foreground hover:opacity-90" : "bg-background text-foreground"}`}
          >{key}</button>
        ))}
      </div>
      <p role="status" className="mt-2 min-h-4 text-xs text-muted-foreground">{message || "Enter or = calculates and copies"}</p>
    </section>
  );
}
