"use client";

import * as React from "react";
import { FileBadge } from "lucide-react";
import { cn } from "@/lib/utils";
import { bibliographyEntries } from "@/lib/papers";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

/** SN-292: the single paper glyph used by every Bibliography row (#12, #17). */
export function PaperIcon({ className }: { className?: string }) {
  return <FileBadge className={cn("shrink-0 text-paper", className)} aria-hidden />;
}

const activeRowClass = "bg-accent/10 text-foreground ring-1 ring-inset ring-accent/30";

export function PaperCountButton({ page, count, compact, onClick }: { page: VaultPage; count: number; compact: boolean; onClick: () => void }) {
  if (!count) return null;
  return <button
    type="button"
    className={cn("inline-flex shrink-0 items-center justify-center gap-1 rounded text-paper hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", compact ? "min-w-[var(--desktop-tree-affordance-size)] min-h-[var(--desktop-tree-affordance-size)]" : "min-h-11 min-w-11")}
    aria-label={`Show ${count} ${count === 1 ? "paper" : "papers"} referenced by ${page.title}`}
    onClick={(event) => { event.stopPropagation(); onClick(); }}
    data-testid={`page-paper-count-${page.path}`}
  >
    <PaperIcon className="size-3.5" /><span className="text-xs font-medium">{count}</span>
  </button>;
}

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
    <PaperIcon className="size-3" /><span className={cn("min-w-0 truncate text-sm", active ? "font-medium" : "font-normal")}>{page.title}</span>
  </button>;
}

/**
 * SN-292 (#12, #17): pinned top-level Bibliography under Open workspace — the
 * central catalogue of every paper. Activating it lists all papers A–Z;
 * papers are created from Insert → Attach paper… (or Companion), never here.
 */
export function Bibliography({ tree, loading, compact, activePagePath, onOpen, open, filterPage, onToggle, onClearFilter }: {
  tree: VaultNotebook[];
  loading: boolean;
  compact: boolean;
  activePagePath?: string | null;
  onOpen: (path: string) => void;
  open: boolean;
  filterPage: { path: string; title: string } | null;
  onToggle: () => void;
  onClearFilter: () => void;
}) {
  const papers = bibliographyEntries(tree)
    .filter((entry) => !filterPage || entry.referrers.some((referrer) => referrer.path === filterPage.path))
    .map((entry) => entry.page).sort((a, b) => a.title.localeCompare(b.title));
  return <section className="mb-2" aria-label="Bibliography">
    <button
      type="button"
      className={cn("flex w-full items-center gap-2 rounded px-1.5 text-left text-foreground hover:bg-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", compact ? "min-h-8" : "min-h-11")}
      aria-expanded={open}
      onClick={onToggle}
      data-testid="bibliography-toggle"
    >
      <PaperIcon className="size-4 text-muted-foreground" /><span className="text-sm font-normal text-muted-foreground">Bibliography</span>
    </button>
    {open && <div className="mt-0.5 pl-4" data-testid="bibliography-library">
      {filterPage && <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground" data-testid="bibliography-page-filter">
        <span className="min-w-0 flex-1 truncate">Papers referenced by {filterPage.title}</span>
        <button type="button" className="shrink-0 rounded px-1.5 py-1 text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClearFilter}>Clear filter</button>
      </div>}
      {loading ? <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Loading papers…</p>
        : papers.length ? papers.map((page) => <PaperListRow key={page.path} page={page} active={page.path === activePagePath} compact={compact} onOpen={onOpen} testId={`bibliography-paper-${String(page.metadata?.paper_id ?? page.path)}`} />)
          : <p className="px-2 py-1 text-xs text-muted-foreground">{filterPage ? "No papers referenced by this page." : "No papers yet. Use Insert → Attach paper… on any page."}</p>}
    </div>}
  </section>;
}
