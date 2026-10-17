"use client";

/**
 * SN-334: one compact action row for a PDF passage — a live selection
 * (Highlight, Record, Ask Companion) or a tapped highlight (Record, Ask
 * Companion). Buttons keep the inline AI menu look and the 44px phone target.
 */
import * as React from "react";
import { Highlighter, NotebookPen, Sparkles } from "lucide-react";

export interface PdfPassageActionsProps {
  /** Omit to hide Highlight (e.g. an existing highlight was tapped). */
  onHighlight?: () => void;
  highlightDisabled?: boolean;
  /** Omit when no Record destination is available. */
  onRecord?: () => void;
  onAsk: (anchor: DOMRect) => void;
  /** Accessible name for the toolbar. */
  label?: string;
}

export function PdfPassageActions({
  onHighlight,
  highlightDisabled = false,
  onRecord,
  onAsk,
  label = "Selected passage actions",
}: PdfPassageActionsProps) {
  // EmbedPDF clears its virtual range on page pointerdown; a tap on an action
  // must not reach the page provider before the click runs.
  const keepRange = (event: React.PointerEvent) => event.stopPropagation();
  return (
    <div
      className="pdf-passage-actions"
      role="toolbar"
      aria-label={label}
      data-testid="pdf-passage-actions"
      onPointerDown={keepRange}
    >
      {onHighlight ? (
        <button
          type="button"
          className="inline-ai-menu-action"
          data-testid="pdf-passage-highlight"
          disabled={highlightDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onHighlight();
          }}
        >
          <Highlighter size={16} aria-hidden="true" /> Highlight
        </button>
      ) : null}
      {onRecord ? (
        <button
          type="button"
          className="inline-ai-menu-action"
          data-testid="pdf-passage-record"
          onClick={(event) => {
            event.stopPropagation();
            onRecord();
          }}
        >
          <NotebookPen size={16} aria-hidden="true" /> Record
        </button>
      ) : null}
      <button
        type="button"
        className="inline-ai-menu-action"
        data-testid="pdf-passage-ask"
        onClick={(event) => {
          event.stopPropagation();
          onAsk(event.currentTarget.getBoundingClientRect());
        }}
      >
        <Sparkles size={16} aria-hidden="true" /> Ask Companion
      </button>
    </div>
  );
}

const VIEWPORT_MARGIN_PX = 8;

/**
 * Keeps a page-anchored floating menu inside the viewport on narrow screens by
 * writing a horizontal correction into `--pdf-passage-shift`.
 */
export function useViewportClamp(ref: React.RefObject<HTMLElement | null>) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--pdf-passage-shift", "0px");
    const rect = el.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    let shift = 0;
    if (rect.width + VIEWPORT_MARGIN_PX * 2 >= viewportWidth) {
      shift = VIEWPORT_MARGIN_PX - rect.left;
    } else if (rect.left < VIEWPORT_MARGIN_PX) {
      shift = VIEWPORT_MARGIN_PX - rect.left;
    } else if (rect.right > viewportWidth - VIEWPORT_MARGIN_PX) {
      shift = viewportWidth - VIEWPORT_MARGIN_PX - rect.right;
    }
    if (shift) el.style.setProperty("--pdf-passage-shift", `${Math.round(shift)}px`);
  });
}

/** Floating container anchored below (or above) the selection's menu rect. */
export function PdfPassageMenu({
  anchorWidth,
  anchorHeight,
  above,
  children,
}: {
  anchorWidth: number;
  anchorHeight: number;
  above: boolean;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useViewportClamp(ref);
  return (
    <div
      ref={ref}
      className="pdf-passage-menu"
      data-testid="pdf-passage-menu"
      data-placement={above ? "top" : "bottom"}
      style={{ left: anchorWidth / 2, top: above ? 0 : anchorHeight }}
    >
      {children}
    </div>
  );
}
