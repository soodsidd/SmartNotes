import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCompanionPageContext } from "@/server/vault/companion-context";
import { invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";

let mockPdfText = "PDF readable text from the embedded page asset.";
let mockPdfPages = new Map<number, string>();
let mockPdfTotalPages = 1;

jest.mock("pdf-parse", () => ({
  PDFParse: class {
    async getText(options?: { partial?: number[]; first?: number; last?: number }) {
      if (options?.partial) {
        const page = options.partial[0] ?? 1;
        const text = mockPdfPages.get(page) ?? "";
        return {
          text,
          total: mockPdfTotalPages,
          getPageText: (requestedPage: number) => mockPdfPages.get(requestedPage) ?? "",
        };
      }
      if (options?.first && options?.last) {
        return {
          text: "",
          total: mockPdfTotalPages,
          getPageText: (requestedPage: number) => mockPdfPages.get(requestedPage) ?? "",
        };
      }
      return { text: mockPdfText, total: mockPdfTotalPages };
    }
    async getInfo() {
      return { total: mockPdfTotalPages };
    }
    async destroy() {}
  },
}));

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-companion-context-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  invalidateVaultTreeCacheForTesting();

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await run(vaultRoot);
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    mockPdfText = "PDF readable text from the embedded page asset.";
    mockPdfPages = new Map();
    mockPdfTotalPages = 1;
    invalidateVaultTreeCacheForTesting();
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

describe("companion page context", () => {
  it("extracts readable text from PDFs embedded on the active page", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "seed.assets"), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "seed.assets", "paper.pdf"), "mock pdf");
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        `---
title: Seed
---
<p>Page body.</p><a href="/vault/Notebook/Section/seed.assets/paper.pdf">paper.pdf</a>`,
        "utf8"
      );

      const context = await buildCompanionPageContext({
        path: "Notebook/Section/seed.html",
        basePageContext: "<p>Live draft body.</p>",
      });

      expect(context.pageContext).toContain("<p>Live draft body.</p>");
      expect(context.pageContext).toContain("Embedded PDF page context");
      expect(context.pageContext).toContain("paper.pdf");
      expect(context.pageContext).toContain("PDF readable text from the embedded page asset.");
    });
  });

  it("injects only the live immersive-reader page for the active PDF", async () => {
    await withVaultFixture(async (vaultRoot) => {
      mockPdfText = "WHOLE DOCUMENT TEXT MUST NOT BE READ";
      mockPdfTotalPages = 12;
      mockPdfPages.set(7, "Text visible on page seven.");
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "seed.assets"), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "seed.assets", "paper.pdf"), "mock pdf");
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        `---\ntitle: Seed\n---\n<a href="/vault/Notebook/Section/seed.assets/paper.pdf">paper.pdf</a>`,
        "utf8"
      );

      const context = await buildCompanionPageContext({
        path: "Notebook/Section/seed.html",
        basePageContext: "Base",
        activePdfHref: "/vault/Notebook/Section/seed.assets/paper.pdf",
        activePdfFileName: "Deep Learning.pdf",
        pdfPage: 7,
        pdfPageCount: 12,
      });

      expect(context.pageContext).toContain("## Current PDF page (7)");
      expect(context.pageContext).toContain('"fileName":"Deep Learning.pdf"');
      expect(context.pageContext).toContain('"currentPage":7');
      expect(context.pageContext).toContain('"pageCount":12');
      expect(context.pageContext).toContain("Path: Notebook/Section/seed.assets/paper.pdf");
      expect(context.pageContext).toContain("Text visible on page seven.");
      expect(context.pageContext).not.toContain("WHOLE DOCUMENT TEXT MUST NOT BE READ");
    });
  });

  it("never falls back to whole-document text when live reader href is not in saved page HTML", async () => {
    await withVaultFixture(async (vaultRoot) => {
      mockPdfText = "WHOLE DOCUMENT TEXT MUST NOT BE READ";
      mockPdfTotalPages = 100;
      mockPdfPages.set(92, "Actual live page ninety-two text.");
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "seed.assets"), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "seed.assets", "book.pdf"), "mock pdf");
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        "---\ntitle: Seed\n---\n<p>Saved body does not yet contain the attachment.</p>",
        "utf8"
      );

      const context = await buildCompanionPageContext({
        path: "Notebook/Section/seed.html",
        basePageContext: "Base",
        activePdfHref: "/vault/Notebook/Section/seed.assets/book.pdf",
        activePdfFileName: "Deep Learning Book.pdf",
        pdfPage: 92,
        pdfPageCount: 100,
      });

      expect(context.pageContext).toContain("## Current PDF page (92)");
      expect(context.pageContext).toContain("Actual live page ninety-two text.");
      expect(context.pageContext).not.toContain("WHOLE DOCUMENT TEXT MUST NOT BE READ");
    });
  });

  it("bounds oversized current-page text and explicitly marks image-only pages", async () => {
    await withVaultFixture(async (vaultRoot) => {
      mockPdfTotalPages = 3;
      mockPdfPages.set(2, "X".repeat(100));
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "seed.assets"), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "seed.assets", "scan.pdf"), "mock pdf");
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        `---\ntitle: Seed\n---\n<a href="/vault/Notebook/Section/seed.assets/scan.pdf">scan.pdf</a>`,
        "utf8"
      );

      const bounded = await buildCompanionPageContext({
        path: "Notebook/Section/seed.html",
        basePageContext: "",
        activePdfHref: "/vault/Notebook/Section/seed.assets/scan.pdf",
        pdfPage: 2,
        pdfMaxChars: 20,
      });
      expect(bounded.pageContext).toContain("X".repeat(20));
      expect(bounded.pageContext).not.toContain("X".repeat(21));
      expect(bounded.pageContext).toContain("PDF page text truncated");

      const empty = await buildCompanionPageContext({
        path: "Notebook/Section/seed.html",
        basePageContext: "",
        activePdfHref: "/vault/Notebook/Section/seed.assets/scan.pdf",
        pdfPage: 3,
      });
      expect(empty.pageContext).toContain("No extractable text was found on PDF page 3");
      expect(empty.pageContext).toContain("image-only");
    });
  });

  it("includes the full PDF text when it fits within the 60 000-char default limit", async () => {
    await withVaultFixture(async (vaultRoot) => {
      mockPdfText = "A".repeat(50_000); // well within 60 000
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "seed.assets"), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "seed.assets", "report.pdf"), "mock pdf");
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        `---\ntitle: Seed\n---\n<a href="/vault/Notebook/Section/seed.assets/report.pdf">report.pdf</a>`,
        "utf8"
      );

      const context = await buildCompanionPageContext({
        path: "Notebook/Section/seed.html",
        basePageContext: "",
      });

      expect(context.pageContext).toContain("A".repeat(1_000));
      expect(context.pageContext).not.toContain("truncated");
    });
  });

  it("truncates oversized PDF text and includes offset hint for the next chunk", async () => {
    await withVaultFixture(async (vaultRoot) => {
      mockPdfText = "B".repeat(80_000); // larger than 60 000 default
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "seed.assets"), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "seed.assets", "large.pdf"), "mock pdf");
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        `---\ntitle: Seed\n---\n<a href="/vault/Notebook/Section/seed.assets/large.pdf">large.pdf</a>`,
        "utf8"
      );

      const context = await buildCompanionPageContext({
        path: "Notebook/Section/seed.html",
        basePageContext: "",
      });

      expect(context.pageContext).toContain("PDF text truncated");
      expect(context.pageContext).toContain("of 80000 characters");
      expect(context.pageContext).toContain("pdfChunkOffset=60000");
    });
  });

  it("reads the second chunk of a large PDF when pdfChunkOffset is provided", async () => {
    await withVaultFixture(async (vaultRoot) => {
      mockPdfText = "A".repeat(30_000) + "B".repeat(30_000) + "C".repeat(20_000);
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "seed.assets"), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "seed.assets", "big.pdf"), "mock pdf");
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        `---\ntitle: Seed\n---\n<a href="/vault/Notebook/Section/seed.assets/big.pdf">big.pdf</a>`,
        "utf8"
      );

      // Second chunk starts at 60 000 where the Cs begin.
      const context = await buildCompanionPageContext({
        path: "Notebook/Section/seed.html",
        basePageContext: "",
        pdfChunkOffset: 60_000,
      });

      expect(context.pageContext).toContain("C".repeat(100));
      expect(context.pageContext).toContain("Showing characters 60000");
      expect(context.pageContext).not.toContain("pdfChunkOffset=80000"); // no further truncation
    });
  });

  it("marks image-only or unreadable PDFs as degraded context", async () => {
    await withVaultFixture(async (vaultRoot) => {
      mockPdfText = "";
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "seed.assets"), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, "Notebook", "Section", "seed.assets", "scan.pdf"), "mock pdf");
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        `---
title: Seed
---
<span data-href="./seed.assets/scan.pdf">scan.pdf</span>`,
        "utf8"
      );

      const context = await buildCompanionPageContext({
        path: "Notebook/Section/seed.html",
        basePageContext: "Base",
      });

      expect(context.pageContext).toContain("No readable text was extracted");
      expect(context.pageContext).not.toContain("undefined");
    });
  });

  it("serializes Jupyter markdown, code source, and recent text outputs with bounds", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "analysis.html"),
        `---
title: Analysis
note_type: jupyter
---
`,
        "utf8"
      );
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter"), { recursive: true });
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "analysis.jupyter", "notebook.ipynb"),
        JSON.stringify({
          cells: [
            { id: "plan-cell", cell_type: "markdown", metadata: {}, source: ["# Plan\n", "Explain the analysis."] },
            {
              id: "result-cell",
              cell_type: "code",
              execution_count: 3,
              metadata: {},
              source: ["print('result')\n"],
              outputs: [{ output_type: "stream", name: "stdout", text: ["result\n"] }],
            },
          ],
          metadata: { kernelspec: { name: "python3" } },
          nbformat: 4,
          nbformat_minor: 5,
        }),
        "utf8"
      );

      const context = await buildCompanionPageContext({
        path: "Notebook/Section/analysis.html",
        basePageContext: "",
      });

      expect(context.pageContext).toContain("Jupyter notebook context");
      expect(context.pageContext).toContain("Cell 0 (markdown)");
      expect(context.pageContext).toContain("Cell id: plan-cell");
      expect(context.pageContext).toContain("# Plan");
      expect(context.pageContext).toContain("Cell 1 (code)");
      expect(context.pageContext).toContain("print('result')");
      expect(context.pageContext).toContain("result");
    });
  });

  it("prioritizes the live saved cell when normal notebook bounds would omit it", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "focused.html"),
        `---
title: Focused
note_type: jupyter
---
`,
        "utf8"
      );
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "focused.jupyter"), { recursive: true });
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "focused.jupyter", "notebook.ipynb"),
        JSON.stringify({
          cells: Array.from({ length: 21 }, (_value, index) => ({
            id: `cell-${index}`,
            cell_type: "code",
            execution_count: null,
            metadata: {},
            source: [`value_${index} = ${index}\n`],
            outputs: [],
          })),
          metadata: {},
          nbformat: 4,
          nbformat_minor: 5,
        }),
        "utf8"
      );

      const context = await buildCompanionPageContext({
        path: "Notebook/Section/focused.html",
        basePageContext: "",
        activeJupyterCellIndex: 20,
        activeJupyterCellId: "cell-20",
      });

      expect(context.pageContext).toContain("Live focused saved cell: index=20 (zero-based), id=cell-20");
      expect(context.pageContext).toContain("Cell 20 (code)");
      expect(context.pageContext).toContain("value_20 = 20");
      expect(context.pageContext).toContain("Notebook context truncated: showing 20 of 21 cells");
    });
  });

  it("states immediately when live focus is not present in the saved notebook", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "unsaved-focus.html"),
        `---
title: Unsaved focus
note_type: jupyter
---
`,
        "utf8"
      );
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section", "unsaved-focus.jupyter"), { recursive: true });
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "unsaved-focus.jupyter", "notebook.ipynb"),
        JSON.stringify({
          cells: [0, 1].map((index) => ({
            id: `cell-${index}`,
            cell_type: "code",
            metadata: {},
            source: [`saved_${index} = ${index}\n`],
          })),
          metadata: {},
          nbformat: 4,
          nbformat_minor: 5,
        }),
        "utf8"
      );

      const context = await buildCompanionPageContext({
        path: "Notebook/Section/unsaved-focus.html",
        basePageContext: "",
        activeJupyterCellIndex: 2,
        activeJupyterCellId: "cell-2",
      });

      expect(context.pageContext).toContain("Live focused cell (index=2, id=cell-2) is not present in the saved notebook");
      expect(context.pageContext).toContain("Do not infer its contents");
      expect(context.pageContext).not.toContain("Cell 2 (code)");
    });
  });
});
