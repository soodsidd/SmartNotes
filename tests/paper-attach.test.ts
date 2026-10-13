import { createPaperAndAttach, filterAndSortPapers, paperHasPdf, type PaperEntry } from "@/lib/paper-attach";

const entry = (title: string, options: { pdf?: boolean; ref?: string; source?: string; updated?: string } = {}): PaperEntry => ({
  id: title,
  page: {
    id: title, path: `.bibliography/${title}.html`, slug: title, title,
    content: options.pdf ? '<span data-file-type="pdf">file</span>' : "<p>Notes on microscopy</p>",
    createdAt: null, updatedAt: options.updated ?? null, preview: "", parentId: null,
    metadata: { paper_source: options.source ?? "" },
  },
  referrers: options.ref ? [{ path: `${options.ref}/page.html`, title: "Page", notebookPath: options.ref, notebookName: options.ref }] : [],
});

const papers = [
  entry("Zeta", { pdf: true, ref: "Research", source: "https://doi.org/10.1/z", updated: "2026-10-04" }),
  entry("Alpha", { ref: "General", updated: "2026-10-03" }),
  entry("Beta", { updated: "2026-10-02" }),
];
const defaults = { query: "", notebook: "", pdf: "", references: "", sort: "title" };

describe("Attach paper picker", () => {
  it("searches title, notes and source, and combines notebook, PDF and reference filters", () => {
    expect(filterAndSortPapers(papers, { ...defaults, query: "MICROSCOPY" }).map((paper) => paper.id)).toEqual(["Alpha", "Beta"]);
    expect(filterAndSortPapers(papers, { ...defaults, query: "10.1/z" }).map((paper) => paper.id)).toEqual(["Zeta"]);
    expect(filterAndSortPapers(papers, { ...defaults, notebook: "Research", pdf: "with", references: "referenced" }).map((paper) => paper.id)).toEqual(["Zeta"]);
    expect(filterAndSortPapers(papers, { ...defaults, pdf: "without", references: "unreferenced" }).map((paper) => paper.id)).toEqual(["Beta"]);
    expect(paperHasPdf(papers[0])).toBe(true);
  });

  it("sorts by title or latest update without mutating the catalogue", () => {
    expect(filterAndSortPapers(papers, defaults).map((paper) => paper.id)).toEqual(["Alpha", "Beta", "Zeta"]);
    expect(filterAndSortPapers(papers, { ...defaults, sort: "recent" }).map((paper) => paper.id)).toEqual(["Zeta", "Alpha", "Beta"]);
    expect(papers.map((paper) => paper.id)).toEqual(["Zeta", "Alpha", "Beta"]);
  });

  it("creates in the chosen home, attaches an optional PDF, refreshes and inserts the chip", async () => {
    const calls: string[] = [];
    const pdf = new File(["%PDF-1.7"], "article.pdf", { type: "application/pdf" });
    const result = await createPaperAndAttach({ title: "  New paper  ", homeNotebookPath: "Research", sourceLink: " https://doi.org/10.1/new ", pdf }, {
      create: async (input) => { expect(input).toEqual({ title: "New paper", homeNotebookPath: "Research", sourceLink: "https://doi.org/10.1/new" }); calls.push("create"); return { id: "paper-id", path: ".bibliography/paper-id.html", title: input.title }; },
      attachPdf: async (_, file) => { expect(file).toBe(pdf); calls.push("pdf"); },
      refresh: async () => { calls.push("refresh"); },
      insertReference: (id) => { expect(id).toBe("paper-id"); calls.push("insert"); return true; },
    });
    expect(result).toEqual({ pdfError: false });
    expect(calls).toEqual(["create", "pdf", "refresh", "insert"]);
  });

  it("keeps the canonical paper attachable when its optional PDF fails", async () => {
    const pdf = new File(["%PDF"], "article.pdf", { type: "application/pdf" });
    const insert = jest.fn(() => true);
    const result = await createPaperAndAttach({ title: "Paper", homeNotebookPath: "General", sourceLink: "", pdf }, {
      create: async () => ({ id: "id", path: "path", title: "Paper" }),
      attachPdf: async () => { throw new Error("upload failed"); },
      refresh: async () => {}, insertReference: insert,
    });
    expect(result.pdfError).toBe(true);
    expect(insert).toHaveBeenCalledWith("id");
  });
});
