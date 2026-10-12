"use client";

import * as React from "react";
import { FileBadge } from "lucide-react";
import { cn } from "@/lib/utils";
import { bibliographyEntries, notebookReferencedPapers } from "@/lib/papers";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

/** SN-292: the single paper glyph used by every Bibliography row (#12, #17). */
export function PaperIcon({ className }: { className?: string }) {
  return <FileBadge className={cn("shrink-0 text-paper", className)} aria-hidden />;
}

const activeRowClass = "bg-accent/10 text-foreground ring-1 ring-inset ring-accent/30";

// Text sizes live on inner spans: the global unlayered `button { font-size: inherit }` beats utilities on <button>.
function PaperListRow({ page, active, compact, onOpen, testId }: { page: VaultPage; active: boolean; compact: boolean; onOpen: (path: string) => void; testId: string }) {
  return <button
    type="button"
    className={cn(
      "flex w-full items-center gap-1.5 rounded px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      compact ? "min-h-[var(--desktop-tree-page-row-height)]" : "min-h-11",
      active ? activeRowClass : "hover:bg-surface/70",
    )}
    aria-current={active ? "page" : undefined}
    onClick={() => onOpen(page.path)}
    data-testid={testId}
  >
    <PaperIcon className="size-3" /><span className={cn("min-w-0 truncate font-medium", compact ? "text-[13px]" : "text-sm")}>{page.title}</span>
  </button>;
}

/**
 * SN-292 (#12, #17): pinned top-level Bibliography under Open workspace — the
 * central catalogue of every paper. Activating it lists all papers A–Z;
 * papers are created from Insert → Attach paper… (or Companion), never here.
 */
export function Bibliography({ tree, loading, compact, activePagePath, onOpen }: {
  tree: VaultNotebook[];
  loading: boolean;
  compact: boolean;
  activePagePath?: string | null;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const papers = bibliographyEntries(tree).map((entry) => entry.page).sort((a, b) => a.title.localeCompare(b.title));
  return <section className="mb-2" aria-label="Bibliography">
    <button
      type="button"
      className={cn("flex w-full items-center gap-2 rounded px-1.5 text-left text-foreground hover:bg-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", compact ? "min-h-8" : "min-h-11")}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      data-testid="bibliography-toggle"
    >
      <PaperIcon className="size-4" /><span className="text-base">Bibliography</span>
    </button>
    {open && <div className="mt-0.5 pl-4" data-testid="bibliography-library">
      {loading ? <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Loading papers…</p>
        : papers.length ? papers.map((page) => <PaperListRow key={page.path} page={page} active={page.path === activePagePath} compact={compact} onOpen={onOpen} testId={`bibliography-paper-${String(page.metadata?.paper_id ?? page.path)}`} />)
          : <p className="px-2 py-1 text-xs text-muted-foreground">No papers yet. Use Insert → Attach paper… on any page.</p>}
    </div>}
  </section>;
}

/** SN-292 (#12, #17): muted per-notebook shortcut that shows referenced papers only. */
export function NotebookBibliographyShortcut({ tree, notebook, compact, activePagePath, onOpen }: {
  tree: VaultNotebook[];
  notebook: VaultNotebook;
  compact: boolean;
  activePagePath?: string | null;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const papers = notebookReferencedPapers(tree, notebook.path);
  return <div data-testid={`notebook-bibliography-${notebook.path}`}>
    <button
      type="button"
      className={cn("flex w-full items-center gap-1.5 rounded px-1 text-left text-muted-foreground hover:bg-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", compact ? "min-h-[var(--desktop-tree-section-row-height)]" : "min-h-11")}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <PaperIcon className="size-3.5" /><span className="text-base">Bibliography</span>
    </button>
    {open && <div className="pl-4">
      {papers.length ? papers.map((paper) => <PaperListRow key={paper.path} page={paper} active={paper.path === activePagePath} compact={compact} onOpen={onOpen} testId={`notebook-bibliography-paper-${String(paper.metadata?.paper_id ?? paper.path)}`} />)
        : <p className="px-2 py-1 text-xs text-muted-foreground">No papers referenced in this notebook.</p>}
    </div>}
  </div>;
}

/** Auto child row under a referring page (#17); a link to the canonical paper page. */
export function PaperChildRow({ page, indentPx, compact, active, onOpen }: {
  page: VaultPage;
  indentPx: number | string;
  compact: boolean;
  active: boolean;
  onOpen: (path: string, parent: string) => void;
}) {
  const reference = page.paperReference!;
  return <div
    className={cn(
      "relative flex items-center gap-1 rounded pr-1 transition",
      compact ? "min-h-[var(--desktop-tree-page-row-height)]" : "min-h-11 py-0.5",
      active ? `${activeRowClass} before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent` : "hover:bg-surface/70",
    )}
    style={{ paddingLeft: indentPx }}
    data-selected={active ? "true" : "false"}
  >
    {/* Spacer columns match the page row's grip + disclosure so the icon aligns. */}
    <span className="size-3 shrink-0" /><span className="size-3 shrink-0" />
    <button
      type="button"
      className={cn("flex min-w-0 flex-1 items-center gap-1.5 px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground", compact ? "min-h-[var(--desktop-tree-page-row-height)]" : "min-h-11")}
      disabled={reference.missing}
      aria-current={active ? "page" : undefined}
      onClick={() => onOpen(reference.canonicalPath, reference.parentPath)}
      data-testid={`paper-child-${reference.id}`}
    >
      <PaperIcon className="size-3" /><span className={cn("min-w-0 truncate font-medium", compact ? "text-[13px]" : "text-sm")}>{page.title}</span>
    </button>
  </div>;
}
