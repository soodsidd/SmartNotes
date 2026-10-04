"use client";

/**
 * Paper notes dock (SN-281). The right frame of the paper reading shell:
 * the paper's canonical page in the same-origin standard page shell (the
 * SN-279 inline-paper frame), docked beside the immersive PDF reader.
 *
 * Wide viewports: fixed right column at a persisted width with a pointer +
 * keyboard separator. Narrow viewports: a full-width layer over the PDF.
 * Hiding keeps the frame mounted so unsaved editor state survives toggling.
 * Companion is owned by the host shell and overlays this dock; the dock never
 * reacts to it.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PAPER_NOTES_KEYBOARD_STEP,
  PAPER_NOTES_MIN_WIDTH,
  clampPaperNotesWidth,
  paperNotesFrameSrc,
  paperNotesMaxWidth,
  type PaperShellLayout,
} from "@/lib/paper-reading-shell";

export interface PaperNotesDockProps {
  paperPath: string;
  title: string;
  layout: PaperShellLayout;
  /** Persisted (unclamped) preference; used as the drag/keyboard starting point. */
  preferredWidth: number;
  /** Frame mounts only once the host has flushed its own pending save. */
  frameReady: boolean;
  error: string | null;
  frameRef: React.RefObject<HTMLIFrameElement>;
  onHide: () => void;
  onWidthCommit: (width: number) => void;
}

export function PaperNotesDock({
  paperPath,
  title,
  layout,
  preferredWidth,
  frameReady,
  error,
  frameRef,
  onHide,
  onWidthCommit,
}: PaperNotesDockProps) {
  const dockRef = React.useRef<HTMLElement>(null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const handleResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (layout.mode !== "split") return;
      event.preventDefault();
      const dock = dockRef.current;
      const reader = document.querySelector<HTMLElement>('[data-testid="pdf-reader"]');
      let pending = layout.notesWidth ?? clampPaperNotesWidth(preferredWidth, window.innerWidth);
      let frame = 0;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Best-effort; window listeners still track the drag.
      }
      // The notes iframe would swallow pointer moves that cross into it.
      if (frameRef.current) frameRef.current.style.pointerEvents = "none";
      // Write DOM widths per animation frame; commit React state once (SN-161 pattern).
      const apply = () => {
        frame = 0;
        if (dock) dock.style.width = `${pending}px`;
        if (reader) reader.style.right = `${pending}px`;
      };
      const move = (moveEvent: PointerEvent) => {
        pending = clampPaperNotesWidth(window.innerWidth - moveEvent.clientX, window.innerWidth);
        if (!frame) frame = window.requestAnimationFrame(apply);
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        if (frame) window.cancelAnimationFrame(frame);
        if (frameRef.current) frameRef.current.style.pointerEvents = "";
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onWidthCommit(pending);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [frameRef, layout.mode, layout.notesWidth, onWidthCommit, preferredWidth]
  );

  const handleResizeKey = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const current = layout.notesWidth;
      if (current === null) return;
      const max = paperNotesMaxWidth(window.innerWidth);
      // The separator sits on the dock's left edge: moving it left widens notes.
      const next =
        event.key === "ArrowLeft" ? current + PAPER_NOTES_KEYBOARD_STEP
        : event.key === "ArrowRight" ? current - PAPER_NOTES_KEYBOARD_STEP
        : event.key === "Home" ? PAPER_NOTES_MIN_WIDTH
        : event.key === "End" ? max
        : null;
      if (next === null) return;
      event.preventDefault();
      onWidthCommit(clampPaperNotesWidth(next, window.innerWidth));
    },
    [layout.notesWidth, onWidthCommit]
  );

  if (!mounted) return null;

  const hidden = layout.mode === "hidden";
  const dock = (
    <aside
      ref={dockRef}
      className="paper-notes-dock"
      data-testid="paper-notes-dock"
      data-mode={layout.mode}
      aria-label={`Paper notes: ${title}`}
      hidden={hidden}
      style={layout.notesWidth !== null ? { width: layout.notesWidth } : undefined}
    >
      {layout.mode === "split" ? (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize paper notes"
          aria-valuemin={PAPER_NOTES_MIN_WIDTH}
          aria-valuemax={typeof window === "undefined" ? undefined : paperNotesMaxWidth(window.innerWidth)}
          aria-valuenow={layout.notesWidth ?? undefined}
          className="paper-notes-dock__resize"
          data-testid="paper-notes-resize-handle"
          onPointerDown={handleResizeStart}
          onKeyDown={handleResizeKey}
        />
      ) : null}
      <div className="paper-notes-dock__bar">
        <div className="paper-notes-dock__heading">
          <span className="paper-notes-dock__eyebrow">Paper notes · Bibliography</span>
          <span className="paper-notes-dock__title" title={title}>{title}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="paper-notes-dock__control"
          aria-label={layout.mode === "overlay" ? "Back to PDF" : "Hide paper notes"}
          title={layout.mode === "overlay" ? "Back to PDF" : "Hide paper notes"}
          data-testid="paper-notes-hide"
          onClick={onHide}
        >
          <PanelRightClose className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="paper-notes-dock__error" data-testid="paper-notes-error">
          {error}
        </p>
      ) : null}
      {frameReady ? (
        <iframe
          ref={frameRef}
          src={paperNotesFrameSrc(paperPath)}
          title={`Paper notes: ${title}`}
          className="paper-notes-dock__frame"
          data-paper-dock={paperPath}
          data-testid="paper-notes-frame"
        />
      ) : (
        <p className="paper-notes-dock__status" role="status">Saving open notes…</p>
      )}
    </aside>
  );
  return createPortal(dock, document.body);
}
