import type { VaultNotebook } from "./vault-contract";
import { bibliographyEntries } from "./papers";
import { fileNameFromHref } from "./pdf-attachment";

export type PaperEntry = ReturnType<typeof bibliographyEntries>[number];

export interface PaperFilters {
  query: string;
  notebook: string;
  pdf: string;
  references: string;
  sort: string;
}

export interface PagePdfChip {
  href: string;
  fileName: string;
}

export function paperHasPdf(entry: PaperEntry): boolean {
  return /data-file-type=["']pdf["']|\.pdf(?:["'?#])/i.test(entry.page.content);
}

/** Title default for promote-to-paper: filename without a trailing .pdf. */
export function defaultPaperTitleFromPdfName(fileName: string): string {
  const base = fileName.trim() || "Untitled paper";
  const withoutExt = base.replace(/\.pdf$/i, "").trim();
  return withoutExt || "Untitled paper";
}

/** Collect PDF attachment chips from page HTML (client-safe, DOMParser when available). */
export function listPagePdfChips(html: string): PagePdfChip[] {
  if (!html || typeof html !== "string") return [];
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chips: PagePdfChip[] = [];
    const seen = new Set<string>();
    for (const chip of Array.from(doc.querySelectorAll('[data-file-type="pdf"]'))) {
      const href =
        chip.getAttribute("href") ||
        chip.querySelector("[data-href]")?.getAttribute("data-href") ||
        chip.querySelector("a")?.getAttribute("href") ||
        "";
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const label = chip.querySelector(".file-attachment-name")?.textContent?.trim();
      chips.push({ href, fileName: label && label.length > 0 ? label : fileNameFromHref(href) });
    }
    return chips;
  }
  const chips: PagePdfChip[] = [];
  const seen = new Set<string>();
  // Node fallback: opening attrs may list href before data-file-type; name lives in a nested span.
  for (const match of html.matchAll(/<span\b([^>]*\bdata-file-type=["']pdf["'][^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const tail = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 800);
    const href =
      attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] ||
      tail.match(/\bdata-href=["']([^"']+)["']/i)?.[1] ||
      "";
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const label = tail.match(/file-attachment-name[^>]*>([^<]*)</i)?.[1]?.trim();
    chips.push({ href, fileName: label && label.length > 0 ? label : fileNameFromHref(href) });
  }
  return chips;
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
  /** SN-302: promote a PDF chip already on the current page instead of uploading a File. */
  pagePdfHref?: string | null;
  /** Page that owns the PDF chip; required when pagePdfHref is set. */
  referenceFromPath?: string;
  replaceChip?: boolean;
}

export interface PromotePdfInput {
  href: string;
  title: string;
  homeNotebookPath: string;
  referenceFromPath: string;
  replaceChip?: boolean;
}

export async function createPaperAndAttach(
  input: CreatePaperInput,
  operations: {
    create: (input: Omit<CreatePaperInput, "pdf" | "pagePdfHref" | "replaceChip" | "referenceFromPath">) => Promise<{ id: string; path: string; title: string }>;
    attachPdf: (paper: { id: string; path: string; title: string }, pdf: File) => Promise<void>;
    promotePagePdf?: (input: PromotePdfInput) => Promise<{ id: string; created: boolean }>;
    refresh: () => Promise<void>;
    insertReference: (id: string) => boolean;
  },
): Promise<{ pdfError: boolean; promoted?: boolean }> {
  const title = input.title.trim();
  if (!title || !input.homeNotebookPath) throw new Error("Choose a notebook and enter a title.");
  if (input.pagePdfHref) {
    if (!operations.promotePagePdf) throw new Error("Promoting a page PDF is unavailable.");
    if (!input.referenceFromPath?.trim()) throw new Error("Promoting a page PDF requires the current page path.");
    await operations.promotePagePdf({
      href: input.pagePdfHref,
      title,
      homeNotebookPath: input.homeNotebookPath,
      referenceFromPath: input.referenceFromPath.trim(),
      replaceChip: input.replaceChip === true,
    });
    // Server wrote the paper reference (and optional chip removal); refresh reloads the editor.
    await operations.refresh();
    return { pdfError: false, promoted: true };
  }
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

/** Call the shared SN-302 promote primitive via the agent vault surface. */
export async function promoteVaultPdfViaApi(
  input: PromotePdfInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; path: string; title: string; created: boolean; replacedChip: boolean }> {
  const title = input.title.trim();
  if (!title || !input.homeNotebookPath) throw new Error("Choose a notebook and enter a title.");
  if (!input.href.trim()) throw new Error("Choose a PDF on this page.");
  const response = await fetchImpl("/api/agent/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tool: "paper_create_from_pdf",
      args: {
        href: input.href,
        title,
        homeNotebookPath: input.homeNotebookPath,
        ...(input.referenceFromPath ? { referenceFromPath: input.referenceFromPath } : {}),
        replaceChip: input.replaceChip === true,
      },
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Could not promote PDF to a paper.");
  }
  const outcome = await response.json() as {
    ok?: boolean;
    result?: { data?: { paper?: { id?: string; path?: string; title?: string }; created?: boolean; replacedChip?: boolean } };
  };
  const data = outcome.result?.data;
  const paper = data?.paper;
  if (!paper?.id || !paper.path) throw new Error("Promote succeeded without a paper id.");
  return {
    id: String(paper.id),
    path: String(paper.path),
    title: String(paper.title ?? title),
    created: data?.created !== false,
    replacedChip: data?.replacedChip === true,
  };
}
