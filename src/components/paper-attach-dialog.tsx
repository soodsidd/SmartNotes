"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { bibliographyEntries } from "@/lib/papers";
import { availablePaperHomes, filterAndSortPapers, paperHasPdf, type CreatePaperInput } from "@/lib/paper-attach";
import type { VaultNotebook } from "@/lib/vault-contract";

const selectClass = "min-h-11 w-full rounded-md border border-input bg-background px-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:min-h-8 xl:text-xs";

export function PaperAttachDialog({ open, onOpenChange, tree, vaultName, onAttach, onCreate }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: VaultNotebook[];
  vaultName: string;
  onAttach: (id: string) => void;
  onCreate: (input: CreatePaperInput) => Promise<void>;
}) {
  const notebooks = availablePaperHomes(tree);
  const entries = bibliographyEntries(tree);
  const [query, setQuery] = React.useState("");
  const [notebook, setNotebook] = React.useState("");
  const [pdf, setPdf] = React.useState("");
  const [references, setReferences] = React.useState("");
  const [sort, setSort] = React.useState("title");
  const [expandedRefs, setExpandedRefs] = React.useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = React.useState(false);
  const [home, setHome] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [sourceLink, setSourceLink] = React.useState("");
  const [selectedPdf, setSelectedPdf] = React.useState<File | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const selectedHome = home || notebooks[0]?.path || "";
  const results = filterAndSortPapers(entries, { query, notebook, pdf, references, sort });

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-[920px] flex-col gap-3 overflow-hidden p-4 sm:max-w-[920px] sm:p-6" data-testid="attach-paper-dialog">
      <DialogHeader>
        <DialogTitle>Attach paper</DialogTitle>
        <DialogDescription>Paper pages use the native editor, ink and Companion. References open the same page, never a copy.</DialogDescription>
      </DialogHeader>
      <Input autoFocus className="focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Search paper titles, notes and sources" placeholder="Search paper titles, notes and sources…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <label className="text-xs text-muted-foreground">Referenced in<select className={selectClass} value={notebook} onChange={(event) => setNotebook(event.target.value)}><option value="">All notebooks</option>{notebooks.map((entry) => <option key={entry.path} value={entry.path}>{entry.name}</option>)}</select></label>
        <label className="text-xs text-muted-foreground">PDF availability<select className={selectClass} value={pdf} onChange={(event) => setPdf(event.target.value)}><option value="">With or without PDF</option><option value="with">With PDF</option><option value="without">Without PDF</option></select></label>
        <label className="text-xs text-muted-foreground">References<select className={selectClass} value={references} onChange={(event) => setReferences(event.target.value)}><option value="">All papers</option><option value="referenced">Referenced</option><option value="unreferenced">Unreferenced</option></select></label>
        <label className="text-xs text-muted-foreground">Sort<select className={selectClass} value={sort} onChange={(event) => setSort(event.target.value)}><option value="title">Title A-Z</option><option value="recent">Recently updated</option></select></label>
      </div>
      <div className="min-h-0 overflow-y-auto" data-testid="attach-paper-results">
        <p className="mb-2 text-xs text-muted-foreground">{results.length} of {entries.length} papers</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {results.map((entry) => {
            const hasPdf = paperHasPdf(entry);
            const refsOpen = expandedRefs.has(entry.id);
            return <article key={entry.id} className="rounded-md border border-border bg-surface p-3 text-sm" data-testid={`attach-paper-card-${entry.id}`}>
              <h3 className="font-semibold">{entry.page.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{hasPdf ? "PDF available" : "No PDF"} · Stored in {vaultName} · {entry.referrers.length} referencing {entry.referrers.length === 1 ? "page" : "pages"}</p>
              <p className="text-xs text-muted-foreground">Updated {entry.page.updatedAt?.slice(0, 10) ?? "—"}</p>
              {typeof entry.page.metadata?.paper_source === "string" && <p className="truncate text-xs text-muted-foreground">Source: {entry.page.metadata.paper_source}</p>}
              <Button variant="ghost" size="sm" onClick={() => { onAttach(entry.id); onOpenChange(false); }}>Attach paper</Button>
              <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground" aria-expanded={refsOpen} onClick={() => setExpandedRefs((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })}>{refsOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}Referenced by</button>
              {refsOpen && <ul className="pl-4 text-xs text-muted-foreground">{entry.referrers.length ? entry.referrers.map((referrer) => <li key={referrer.path}>{referrer.notebookName} / {referrer.title}</li>) : <li>No referencing pages</li>}</ul>}
            </article>;
          })}
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <button type="button" className="flex items-center gap-1 text-sm font-medium" aria-expanded={createOpen} onClick={() => setCreateOpen(!createOpen)}>{createOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}Create a paper</button>
          {createOpen && <form className="mt-3 grid gap-3" onSubmit={async (event) => {
            event.preventDefault(); setPending(true); setError("");
            try { await onCreate({ title, homeNotebookPath: selectedHome, sourceLink, pdf: selectedPdf }); setTitle(""); setSourceLink(""); setSelectedPdf(null); onOpenChange(false); }
            catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create paper."); }
            finally { setPending(false); }
          }}>
            <label className="text-xs text-muted-foreground">Save new paper in<select className={selectClass} value={selectedHome} onChange={(event) => setHome(event.target.value)}>{notebooks.map((entry) => <option key={entry.path} value={entry.path}>{entry.name}</option>)}</select></label>
            <label className="text-xs text-muted-foreground">Title<Input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="text-xs text-muted-foreground">DOI or source link (optional)<Input value={sourceLink} onChange={(event) => setSourceLink(event.target.value)} /></label>
            <label className="text-xs text-muted-foreground">PDF (optional)<Input type="file" accept="application/pdf,.pdf" onChange={(event) => setSelectedPdf(event.target.files?.[0] ?? null)} /></label>
            <p className="text-xs text-muted-foreground">Stored once in the selected notebook and browsed in the central Bibliography. Notebook shortcuts show referenced papers only. Ordinary PDF attachments stay unchanged.</p>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="justify-self-start" disabled={pending || !selectedHome}>{pending ? "Creating…" : "Create and attach"}</Button>
          </form>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
