"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SN-392: dedicated expand/collapse hit target for the notebook rail (which
 * shows/hides a notebook's sections), section headers, and nested pages. The glyph stays compact; the button box is a full touch target
 * (44px tall on phones, the 26px tree affordance height on compact desktop).
 * It only toggles — never selects, opens, renames, or starts a row drag.
 */
export const TREE_TOGGLE_ATTRIBUTE = "data-tree-toggle";

// Compact desktop keeps the 26px tree affordance; phones and coarse pointers get the full 44px box. A
// narrower touch box let Chrome's touch adjustment hand near-edge taps to the adjacent row button.
const boxClass = (compact: boolean) =>
  compact ? "h-[var(--desktop-tree-affordance-size)] w-5 [@media(pointer:coarse)]:size-11" : "size-11";

/** True when a pointer/drag gesture began on a tree toggle, so the row must not start a drag. */
export function isTreeToggleTarget(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && Boolean(target.closest(`[${TREE_TOGGLE_ATTRIBUTE}]`));
}

export function TreeToggleButton({
  expanded,
  onToggle,
  compact,
  label,
  testId,
}: {
  expanded: boolean;
  onToggle: () => void;
  compact: boolean;
  /** Item name, used in the accessible label ("Collapse Notes"). */
  label?: string;
  testId?: string;
}) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      {...{ [TREE_TOGGLE_ATTRIBUTE]: "" }}
      draggable={false}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        boxClass(compact)
      )}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"}${label ? ` ${label}` : ""}`}
      data-testid={testId}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <Icon className={cn("pointer-events-none", compact ? "size-3" : "size-3.5")} aria-hidden />
    </button>
  );
}

/** Keeps leaf rows aligned with rows that render a TreeToggleButton. */
export function TreeToggleSpacer({ compact }: { compact: boolean }) {
  return <span className={cn("shrink-0", compact ? "w-5 [@media(pointer:coarse)]:w-11" : "w-11")} aria-hidden />;
}
