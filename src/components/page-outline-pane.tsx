"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { ChevronsDownUp, ChevronsUpDown, ChevronRight, X } from "lucide-react";
import { buildPageOutline, outlineBranchKeys, outlineDefaultExpandedKeys, type PageOutlineEntry } from "@/lib/page-outline";

interface PageOutlinePaneProps {
  editor: Editor;
  scrollContainer: HTMLElement | null;
  onClose: () => void;
  onNavigate?: () => void;
}

export function PageOutlinePane({ editor, scrollContainer, onClose, onNavigate }: PageOutlinePaneProps) {
  const [entries, setEntries] = React.useState(() => buildPageOutline(editor.state.doc));
  // Open showing one level below roots (H2 sections under H1), not just top headings.
  const [expanded, setExpanded] = React.useState(() => outlineDefaultExpandedKeys(buildPageOutline(editor.state.doc)));
  const paneRef = React.useRef<HTMLElement>(null);
  const previousFocus = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const sync = () => setEntries(buildPageOutline(editor.state.doc));
    editor.on("update", sync);
    return () => { editor.off("update", sync); };
  }, [editor]);

  React.useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    paneRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  const branchKeys = React.useMemo(() => outlineBranchKeys(entries), [entries]);
  const branchSet = React.useMemo(() => new Set(branchKeys), [branchKeys]);
  const expandedSet = React.useMemo(() => new Set(expanded.filter((key) => branchSet.has(key))), [expanded, branchSet]);

  const jumpTo = (entry: PageOutlineEntry) => {
    const target = editor.view.nodeDOM(entry.key);
    if (!(target instanceof HTMLElement)) return;
    // Close first so the overlay cannot mask the destination.
    onNavigate?.();
    onClose();
    requestAnimationFrame(() => {
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        scrollContainer.scrollTo({
          top: Math.max(0, scrollContainer.scrollTop + targetRect.top - containerRect.top - 12),
          behavior: "smooth",
        });
      } else {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };

  const renderEntries = (items: PageOutlineEntry[], depth = 0): React.ReactNode => items.map((entry) => {
    const hasChildren = entry.children.length > 0;
    const isExpanded = expandedSet.has(entry.key);
    return (
      <li key={entry.key}>
        <div className="page-outline-row" style={{ paddingLeft: `${8 + depth * 18}px` }}>
          {hasChildren ? (
            <button type="button" className="page-outline-chevron" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${entry.title}`} aria-expanded={isExpanded} onClick={() => setExpanded((current) => isExpanded ? current.filter((key) => key !== entry.key) : [...current, entry.key])}>
              <ChevronRight className={isExpanded ? "page-outline-chevron-open" : ""} size={16} />
            </button>
          ) : <span className="page-outline-chevron-spacer" />}
          <button type="button" className="page-outline-entry" onClick={() => jumpTo(entry)} title={entry.title}>{entry.title}</button>
        </div>
        {hasChildren && isExpanded ? <ul>{renderEntries(entry.children, depth + 1)}</ul> : null}
      </li>
    );
  });

  return createPortal(
    <div className="page-outline-layer" data-testid="page-outline-layer">
      <button type="button" className="page-outline-backdrop" aria-label="Close page outline" onClick={onClose} />
      <aside
        ref={paneRef}
        className="page-outline-pane"
        role="dialog"
        aria-modal="true"
        aria-label="Page outline"
        tabIndex={-1}
        data-testid="page-outline-pane"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key === "Tab") {
            const buttons = Array.from(paneRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
            if (!buttons.length) return;
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === paneRef.current)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}
      >
        <div className="page-outline-header">
          <span className="page-outline-title">Page outline</span>
          <button type="button" className="page-outline-header-button" aria-label="Collapse all" title="Collapse all" onClick={() => setExpanded([])}><ChevronsDownUp size={16} /></button>
          <button type="button" className="page-outline-header-button" aria-label="Expand all" title="Expand all" onClick={() => setExpanded(branchKeys)}><ChevronsUpDown size={16} /></button>
          <button type="button" className="page-outline-header-button" aria-label="Close page outline" title="Close" onClick={onClose}><X size={18} /></button>
        </div>
        {entries.length ? <nav aria-label="Page headings" className="page-outline-tree"><ul>{renderEntries(entries)}</ul></nav> : (
          <p className="page-outline-empty">No headings yet. Use Heading 1, 2, or 3 to build this outline.</p>
        )}
      </aside>
    </div>,
    document.body
  );
}
