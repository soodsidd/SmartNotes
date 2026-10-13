import type { VaultNotebook } from "./vault-contract";
import { bibliographyEntries } from "./papers";

export type PaperEntry = ReturnType<typeof bibliographyEntries>[number];

export interface PaperFilters {
  query: string;
  notebook: string;
  pdf: string;
  references: string;
  sort: string;
}

export function paperHasPdf(entry: PaperEntry): boolean {
  return /data-file-type=["']pdf["']|\.pdf(?:["'?#])/i.test(entry.page.content);
}

export function filterAndSortPapers(entries: PaperEntry[], filters: PaperFilters): PaperEntry[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    const searchable = `${entry.page.title} ${entry.page.content} ${String(entry.page.metadata?.paper_source ?? "")}`.toLocaleLowerCase();
    return searchable.includes(query)
      && (!filters.notebook || entry.referrers.some((referrer) => referrer.notebookPath === filters.notebook))
      && (!filters.pdf || (filters.pdf === "with") === paperHasPdf(entry))
      && (!filters.references || (filters.references === "referenced") === (entry.referrers.length > 0));
  }).sort((a, b) => filters.sort === "recent"
    ? (b.page.updatedAt ?? "").localeCompare(a.page.updatedAt ?? "") || a.page.title.localeCompare(b.page.title)
    : a.page.title.localeCompare(b.page.title));
}

export function availablePaperHomes(tree: VaultNotebook[]): VaultNotebook[] {
  return tree.filter((notebook) => notebook.path !== ".bibliography");
}

export interface CreatePaperInput {
  title: string;
  homeNotebookPath: string;
  sourceLink: string;
  pdf: File | null;
}

export async function createPaperAndAttach(
  input: CreatePaperInput,
  operations: {
    create: (input: Omit<CreatePaperInput, "pdf">) => Promise<{ id: string; path: string; title: string }>;
    attachPdf: (paper: { id: string; path: string; title: string }, pdf: File) => Promise<void>;
    refresh: () => Promise<void>;
    insertReference: (id: string) => boolean;
  },
): Promise<{ pdfError: boolean }> {
  const title = input.title.trim();
  if (!title || !input.homeNotebookPath) throw new Error("Choose a notebook and enter a title.");
  if (input.pdf && input.pdf.type !== "application/pdf" && !/\.pdf$/i.test(input.pdf.name)) throw new Error("Choose a PDF file.");
  const paper = await operations.create({ title, homeNotebookPath: input.homeNotebookPath, sourceLink: input.sourceLink.trim() });
  let pdfError = false;
  if (input.pdf) {
    try { await operations.attachPdf(paper, input.pdf); }
    catch { pdfError = true; }
  }
  await operations.refresh();
  if (!operations.insertReference(paper.id)) throw new Error("Paper created, but its reference could not be inserted. Attach it from the Bibliography.");
  return { pdfError };
}
