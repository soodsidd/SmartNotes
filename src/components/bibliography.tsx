"use client";

import * as React from "react";
import { BookOpen, ChevronDown, ChevronRight, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bibliographyEntries, type PaperReferrer } from "@/lib/papers";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:min-h-8 xl:text-xs";

export function Bibliography({ tree, loading, onOpen, onCreate }: {
  tree: VaultNotebook[]; loading: boolean;
  onOpen: (path: string) => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState("title");
  const [notebook, setNotebook] = React.useState("");
  const [referrer, setReferrer] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const entries = bibliographyEntries(tree);
  const referrers = new Map<string, PaperReferrer>();
  entries.forEach((entry) => entry.referrers.forEach((item) => referrers.set(item.path, item)));
  const results = entries.filter((entry) =>
    entry.page.title.toLowerCase().includes(query.toLowerCase()) &&
    (!notebook || entry.referrers.some((item) => item.notebookPath === notebook)) &&
    (!referrer || entry.referrers.some((item) => item.path === referrer))
  ).sort((a, b) => sort === "recent"
    ? (b.page.updatedAt ?? "").localeCompare(a.page.updatedAt ?? "")
    : a.page.title.localeCompare(b.page.title));

  return <section className="mb-2 border-b border-border pb-2" aria-label="Bibliography">
    <Button variant="ghost" className="min-h-11 w-full justify-start gap-2 xl:min-h-8" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="bibliography-toggle">
      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}<BookOpen className="size-4" />Bibliography
    </Button>
    {open && <div className="space-y-2 px-1" data-testid="bibliography-library">
      <p className="text-xs text-muted-foreground">Shared paper notes live here. References open the same page.</p>
      <Input aria-label="Search papers" placeholder="Search papers…" value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 text-base xl:min-h-8 xl:text-xs" />
      <select aria-label="Sort papers" value={sort} onChange={(event) => setSort(event.target.value)} className={selectClass}>
        <option value="title">Title A–Z</option><option value="recent">Recently updated</option>
      </select>
      <select aria-label="Referencing notebook" value={notebook} onChange={(event) => { setNotebook(event.target.value); setReferrer(""); }} className={selectClass}>
        <option value="">All referencing notebooks</option>
        {[...new Map([...referrers.values()].map((item) => [item.notebookPath, item.notebookName])).entries()].map(([path, name]) => <option key={path} value={path}>{name}</option>)}
      </select>
      <select aria-label="Referencing page" value={referrer} onChange={(event) => setReferrer(event.target.value)} className={selectClass}>
        <option value="">All referencing pages</option>
        {[...referrers.values()].filter((item) => !notebook || item.notebookPath === notebook).map((item) => <option key={item.path} value={item.path}>{item.notebookName} / {item.title}</option>)}
      </select>
      {loading ? <p role="status" className="text-sm">Loading papers…</p> : results.length ? <ul className="space-y-1">
        {results.map(({ page, id, referrers: refs }) => <li key={id}>
          <button type="button" className="min-h-11 w-full rounded-md px-2 py-2 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(page.path)} data-testid={`bibliography-paper-${id}`}>
            <span className="block break-words text-sm">{page.title}</span>
            <span className="text-xs text-muted-foreground">{refs.length} referring {refs.length === 1 ? "page" : "pages"}</span>
          </button>
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">{entries.length ? "No papers match these filters." : "No papers yet. Create your first shared paper below."}</p>}
      <form className="space-y-2" onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setError(null);
        try { await onCreate(title); setTitle(""); } catch (err) { setError(err instanceof Error ? err.message : "Could not create paper. Try again."); } finally { setPending(false); }
      }}>
        <Input aria-label="New paper title" placeholder="New paper title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending} className="min-h-11 text-base xl:min-h-8 xl:text-xs" />
        <Button type="submit" variant="outline" className="min-h-11 w-full gap-2" disabled={pending || !title.trim()}><Plus className="size-4" />{pending ? "Creating…" : "New paper"}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    </div>}
  </section>;
}

export function PaperReferencePicker({ papers, onInsert, disabled }: { papers: VaultPage[]; onInsert: (id: string) => void; disabled: boolean }) {
  const [id, setId] = React.useState("");
  return <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2" data-testid="paper-reference-picker">
    <label className="text-xs text-muted-foreground" htmlFor="paper-reference-select">Paper reference</label>
    <select id="paper-reference-select" className={`${selectClass} flex-1`} value={id} onChange={(event) => setId(event.target.value)} disabled={disabled || !papers.length}>
      <option value="">{papers.length ? "Choose a Bibliography paper…" : "Create a paper in Bibliography first"}</option>
      {papers.map((paper) => <option key={paper.path} value={String(paper.metadata?.paper_id)}>{paper.title}</option>)}
    </select>
    <Button size="sm" variant="outline" className="min-h-11 gap-2 xl:min-h-8" disabled={disabled || !id} onClick={() => { onInsert(id); setId(""); }}><Link2 className="size-4" />Insert reference</Button>
  </div>;
}

export function PaperChildRow({ page, depth, onOpen }: { page: VaultPage; depth: number; onOpen: (path: string, parent: string) => void }) {
  const reference = page.paperReference!;
  return <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:min-h-[var(--desktop-tree-page-row-height)] xl:text-xs" style={{ paddingLeft: `calc(${depth + 1} * var(--desktop-tree-indent-step))` }} disabled={reference.missing} onClick={() => onOpen(reference.canonicalPath, reference.parentPath)} data-testid={`paper-child-${reference.id}`}>
    <Link2 className="size-3 shrink-0 text-accent" /><span className="min-w-0 break-words">{page.title}<span className="block text-xs text-muted-foreground">Shared · Bibliography</span></span>
  </button>;
}
