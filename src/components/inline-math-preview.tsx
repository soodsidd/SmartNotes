"use client";

import * as React from "react";
import katex from "katex";

type InlineMathPreviewProps = {
  latex: string;
  className?: string;
  /** Render in KaTeX display style — used when previewing a block equation (SN-158). */
  displayMode?: boolean;
};

/** Live KaTeX preview for inline/block equation compose (fractions, symbols, etc.). */
export function InlineMathPreview({ latex, className, displayMode = false }: InlineMathPreviewProps) {
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const trimmed = latex.trim();
    if (!trimmed) {
      el.textContent = "";
      el.classList.remove("inline-math-preview--error");
      return;
    }
    try {
      katex.render(trimmed, el, { throwOnError: false, strict: "ignore", displayMode });
      el.classList.remove("inline-math-preview--error");
    } catch {
      el.textContent = trimmed;
      el.classList.add("inline-math-preview--error");
    }
  }, [latex, displayMode]);

  return (
    <span
      ref={ref}
      className={className ?? "inline-math-preview"}
      data-testid="inline-math-preview"
      aria-hidden={!latex.trim()}
    />
  );
}
