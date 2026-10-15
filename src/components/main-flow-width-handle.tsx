"use client";

import * as React from "react";
import {
  MAIN_FLOW_DEFAULT_WIDTH,
  MAIN_FLOW_KEY_STEP,
  MAIN_FLOW_KEY_STEP_COARSE,
  MAIN_FLOW_MAX_WIDTH,
  MAIN_FLOW_MIN_WIDTH,
  normalizeMainFlowWidth,
  resizeMainFlowWidth,
} from "@/lib/main-flow-width";

/** Keyboard edits are committed after the user pauses, so arrow-key bursts make one vault write. */
export const MAIN_FLOW_KEY_COMMIT_DELAY_MS = 400;

/**
 * SN-318: right-edge width-only resize handle for the main editor flow frame.
 *
 * Mirrors the SN-316 floating-box handle: pointer drag and arrow keys change
 * only the column width. `onLiveChange` fires on every step so prose reflows
 * immediately; `onCommit` fires once per drag (on release) or per keyboard
 * burst, which is when the width is persisted.
 */
export function MainFlowWidthHandle({
  width,
  inset = 0,
  height,
  onLiveChange,
  onCommit,
}: {
  width: number;
  /** Frame padding around the column; the handle sits on the outline's right edge. */
  inset?: number;
  height: number;
  onLiveChange: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const keyCommitTimerRef = React.useRef<number | null>(null);
  const pendingKeyWidthRef = React.useRef<number | null>(null);
  const onCommitRef = React.useRef(onCommit);
  onCommitRef.current = onCommit;

  const flushKeyCommit = React.useCallback(() => {
    if (keyCommitTimerRef.current !== null) window.clearTimeout(keyCommitTimerRef.current);
    keyCommitTimerRef.current = null;
    const pending = pendingKeyWidthRef.current;
    pendingKeyWidthRef.current = null;
    if (pending !== null) onCommitRef.current(pending);
  }, []);

  // Don't drop a pending keyboard edit when the editor unmounts or swaps pages.
  React.useEffect(() => flushKeyCommit, [flushKeyCommit]);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    flushKeyCommit();
    const handle = event.currentTarget;
    // The frame may sit inside the workspace-zoom transform; convert screen px to layout px.
    const scale = handle.getBoundingClientRect().width / (handle.offsetWidth || 1) || 1;
    const startX = event.clientX;
    const startWidth = normalizeMainFlowWidth(width);
    let latest = startWidth;
    handle.setPointerCapture?.(event.pointerId);
    handle.dataset.dragging = "true";

    const move = (moveEvent: PointerEvent) => {
      const next = resizeMainFlowWidth(startWidth, (moveEvent.clientX - startX) / scale);
      if (next === latest) return;
      latest = next;
      onLiveChange(next);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      delete handle.dataset.dragging;
      if (latest !== startWidth) onCommitRef.current(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? MAIN_FLOW_KEY_STEP_COARSE : MAIN_FLOW_KEY_STEP;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = resizeMainFlowWidth(width, -step);
    else if (event.key === "ArrowRight") next = resizeMainFlowWidth(width, step);
    else if (event.key === "Home") next = MAIN_FLOW_DEFAULT_WIDTH;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (next === width) return;
    onLiveChange(next);
    pendingKeyWidthRef.current = next;
    if (keyCommitTimerRef.current !== null) window.clearTimeout(keyCommitTimerRef.current);
    keyCommitTimerRef.current = window.setTimeout(flushKeyCommit, MAIN_FLOW_KEY_COMMIT_DELAY_MS);
  }

  return (
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize page column width"
      aria-valuemin={MAIN_FLOW_MIN_WIDTH}
      aria-valuemax={MAIN_FLOW_MAX_WIDTH}
      aria-valuenow={width}
      title="Drag to change column width; arrow keys to adjust, Home to reset"
      className="editor-main-flow-resize"
      data-testid="editor-main-flow-resize"
      style={{ left: width + inset, height }}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onBlur={flushKeyCommit}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="editor-main-flow-resize__grip" aria-hidden="true" />
    </button>
  );
}
