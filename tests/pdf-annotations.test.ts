/**
 * @jest-environment node
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildPdfAnnotationSidecar,
  collectPdfHighlightQuoteTargets,
  filterUserAuthoredAnnotationItems,
  formatPdfAnnotationCompanionContext,
  parsePdfAnnotationSidecar,
  pdfAnnotationSidecarPath,
  reconstructMarkedText,
  summarizePdfAnnotationsForCompanion,
  vaultHrefToPdfPath,
  type HighlightGeometryTextItem,
} from "@/lib/pdf-annotations";
import { extractPdfPageTextItems } from "@/server/vault/pdf-text-geometry";
import {
  hashPdfBytes,
  readPdfAnnotations,
  savePdfAnnotations,
} from "@/server/vault/pdf-annotations";
import { GET, PUT } from "@/app/api/pdf-annotations/route";

const MINIMAL_PDF = `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000068 00000 n 
0000000125 00000 n 
trailer<< /Size 4 /Root 1 0 R >>
startxref
203
%%EOF
`;

const SAMPLE_ITEMS = [
  {
    annotation: {
      id: "anno-ink-1",
      type: 15,
      pageIndex: 0,
      rect: { origin: { x: 10, y: 20 }, size: { width: 40, height: 12 } },
      inkList: [{ points: [{ x: 10, y: 20 }, { x: 50, y: 32 }] }],
      color: "#e11d48",
      opacity: 1,
      strokeWidth: 2,
    },
  },
  {
    annotation: {
      id: "anno-hl-1",
      type: 9,
      pageIndex: 0,
      rect: { origin: { x: 8, y: 80 }, size: { width: 60, height: 14 } },
      color: "#facc15",
      opacity: 0.45,
      segmentRects: [{ origin: { x: 8, y: 80 }, size: { width: 60, height: 14 } }],
    },
  },
];

async function withVaultFixture(run: (ctx: {
  vaultRoot: string;
  pdfRelative: string;
  pdfAbsolute: string;
}) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-pdf-anno-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;

  try {
    const assetsDir = path.join(vaultRoot, "Notebook", "Section", "note.assets");
    await fs.mkdir(assetsDir, { recursive: true });
    const pdfAbsolute = path.join(assetsDir, "paper.pdf");
    await fs.writeFile(pdfAbsolute, MINIMAL_PDF, "utf8");
    await run({
      vaultRoot,
      pdfRelative: "Notebook/Section/note.assets/paper.pdf",
      pdfAbsolute,
    });
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

describe("pdf annotation path helpers", () => {
  test("vaultHrefToPdfPath decodes /vault URLs", () => {
    expect(vaultHrefToPdfPath("/vault/Notebook/Section/note.assets/paper.pdf")).toBe(
      "Notebook/Section/note.assets/paper.pdf"
    );
    expect(
      vaultHrefToPdfPath("/vault/%2B8d9fbe2b/Config/page.assets/Catalogue(Final).pdf")
    ).toBe("+8d9fbe2b/Config/page.assets/Catalogue(Final).pdf");
    expect(vaultHrefToPdfPath("/vault/note.html")).toBeNull();
    expect(vaultHrefToPdfPath("https://example.com/a.pdf")).toBeNull();
  });

  test("summarizePdfAnnotationsForCompanion includes highlight comments", () => {
    const sidecar = buildPdfAnnotationSidecar([
      ...SAMPLE_ITEMS,
      {
        annotation: {
          id: "anno-hl-note",
          type: 9,
          pageIndex: 2,
          contents: "  revisit this claim  ",
          rect: { origin: { x: 1, y: 1 }, size: { width: 10, height: 10 } },
          segmentRects: [],
          opacity: 0.4,
        },
      },
    ]);
    const summary = summarizePdfAnnotationsForCompanion(sidecar);
    expect(summary.inkCount).toBe(1);
    expect(summary.highlightCount).toBe(2);
    expect(summary.commentedHighlights).toEqual([
      { pageIndex: 2, note: "revisit this claim" },
    ]);
    // The commented highlight is listed with its page + comment even when no
    // quote resolver is supplied; the plain (uncommented) highlight is counted.
    expect(summary.highlights).toEqual([{ pageIndex: 2, note: "revisit this claim" }]);
    const block = formatPdfAnnotationCompanionContext(
      "paper.pdf",
      "Notebook/Section/note.assets/paper.pdf",
      summary
    );
    expect(block).toContain("Highlighted passages");
    expect(block).toContain("(page 3)");
    expect(block).toContain("comment: revisit this claim");
  });

  test("summarize surfaces reconstructed marked text per highlight (SN-218)", () => {
    const sidecar = buildPdfAnnotationSidecar([
      {
        annotation: {
          id: "anno-hl-quote",
          type: 9,
          pageIndex: 0,
          contents: "key result",
          segmentRects: [{ origin: { x: 8, y: 80 }, size: { width: 60, height: 14 } }],
          opacity: 0.4,
        },
      },
      {
        // Commented but image-only: reported honestly as unavailable, not invented.
        annotation: {
          id: "anno-hl-imageonly-commented",
          type: 9,
          pageIndex: 3,
          contents: "check this figure",
          segmentRects: [{ origin: { x: 5, y: 5 }, size: { width: 40, height: 12 } }],
          opacity: 0.4,
        },
      },
      {
        // Uncommented and unrecoverable: covered by the honest count, not listed
        // individually, so a scanned book cannot flood the context.
        annotation: {
          id: "anno-hl-imageonly-bare",
          type: 9,
          pageIndex: 6,
          segmentRects: [{ origin: { x: 5, y: 5 }, size: { width: 40, height: 12 } }],
          opacity: 0.4,
        },
      },
    ]);

    const summary = summarizePdfAnnotationsForCompanion(sidecar, {
      resolveHighlightQuote: ({ pageIndex }) =>
        pageIndex === 0 ? { text: "diffusion models scale", truncated: false } : null,
    });

    expect(summary.highlightCount).toBe(3);
    expect(summary.highlights).toEqual([
      { pageIndex: 0, quote: "diffusion models scale", note: "key result" },
      { pageIndex: 3, note: "check this figure", quoteUnavailable: true },
    ]);

    const block = formatPdfAnnotationCompanionContext("p.pdf", "a/p.pdf", summary);
    expect(block).toContain("(page 1) “diffusion models scale” — comment: key result");
    expect(block).toContain("(page 4) [marked text unavailable");
    expect(block).toContain("comment: check this figure");
    // Never invents text for the unrecoverable highlights.
    expect(block).not.toContain("(page 4) “");
    expect(block).not.toContain("(page 7)");
  });

  test("summarize prefers a persisted custom.quote over reconstruction", () => {
    const sidecar = buildPdfAnnotationSidecar([
      {
        annotation: {
          id: "anno-hl-persisted",
          type: 9,
          pageIndex: 1,
          custom: { quote: "  persisted marked text  " },
          segmentRects: [{ origin: { x: 1, y: 1 }, size: { width: 10, height: 10 } }],
          opacity: 0.4,
        },
      },
    ]);

    const resolveHighlightQuote = jest.fn(() => ({ text: "should not be used", truncated: false }));
    const summary = summarizePdfAnnotationsForCompanion(sidecar, { resolveHighlightQuote });
    expect(summary.highlights).toEqual([{ pageIndex: 1, quote: "persisted marked text" }]);
    // A persisted quote short-circuits geometry reconstruction entirely.
    expect(resolveHighlightQuote).not.toHaveBeenCalled();
    // ...and such a highlight is not a quote target for prefetching.
    expect(collectPdfHighlightQuoteTargets(sidecar)).toEqual([]);
  });

  test("summarize truncates an over-long quote with an explicit marker", () => {
    const long = "x".repeat(400);
    const sidecar = buildPdfAnnotationSidecar([
      {
        annotation: {
          id: "anno-hl-long",
          type: 9,
          pageIndex: 0,
          custom: { quote: long },
          segmentRects: [{ origin: { x: 1, y: 1 }, size: { width: 10, height: 10 } }],
          opacity: 0.4,
        },
      },
    ]);
    const summary = summarizePdfAnnotationsForCompanion(sidecar, { maxQuoteChars: 50 });
    const entry = summary.highlights[0]!;
    expect(entry.quoteTruncated).toBe(true);
    expect(entry.quote!.length).toBeLessThanOrEqual(51); // 50 chars + ellipsis
    const block = formatPdfAnnotationCompanionContext("p.pdf", "a/p.pdf", summary);
    expect(block).toContain("(marked text truncated)");
  });

  describe("reconstructMarkedText geometry matcher", () => {
    const items: HighlightGeometryTextItem[] = [
      { text: "Diffusion", x: 20, y: 100, width: 60, height: 12 },
      { text: "models", x: 84, y: 100, width: 45, height: 12 },
      { text: "elsewhere", x: 20, y: 200, width: 70, height: 12 },
    ];

    test("returns marked runs in reading order", () => {
      const result = reconstructMarkedText(
        [{ origin: { x: 18, y: 99 }, size: { width: 115, height: 13 } }],
        items
      );
      expect(result).toEqual({ text: "Diffusion models", truncated: false });
    });

    test("ignores runs that do not overlap the highlight", () => {
      const result = reconstructMarkedText(
        [{ origin: { x: 18, y: 99 }, size: { width: 65, height: 13 } }],
        items
      );
      expect(result).toEqual({ text: "Diffusion", truncated: false });
    });

    test("returns null when nothing overlaps or geometry is missing", () => {
      expect(
        reconstructMarkedText(
          [{ origin: { x: 500, y: 500 }, size: { width: 10, height: 10 } }],
          items
        )
      ).toBeNull();
      expect(reconstructMarkedText([], items)).toBeNull();
      expect(reconstructMarkedText([{ origin: { x: 0, y: 0 }, size: { width: 5, height: 5 } }], [])).toBeNull();
    });

    test("truncates to the character budget", () => {
      const wide: HighlightGeometryTextItem[] = [
        { text: "abcdefghij".repeat(5), x: 0, y: 0, width: 500, height: 12 },
      ];
      const result = reconstructMarkedText(
        [{ origin: { x: 0, y: 0 }, size: { width: 500, height: 12 } }],
        wide,
        { maxChars: 10 }
      );
      expect(result?.truncated).toBe(true);
      expect(result?.text.endsWith("…")).toBe(true);
    });
  });

  test("pdfAnnotationSidecarPath sits beside the PDF", () => {
    expect(pdfAnnotationSidecarPath("Notebook/Section/note.assets/paper.pdf")).toBe(
      "Notebook/Section/note.assets/paper.pdf.annotations.json"
    );
  });

  test("parsePdfAnnotationSidecar rejects corrupt payloads safely", () => {
    expect(parsePdfAnnotationSidecar(null).items).toEqual([]);
    expect(parsePdfAnnotationSidecar({ items: "nope" }).items).toEqual([]);
    expect(
      parsePdfAnnotationSidecar({
        items: [
          { annotation: { id: "a", type: 15 } },
          { annotation: "bad" },
          null,
        ],
      }).items
    ).toEqual([{ annotation: { id: "a", type: 15 } }]);
  });

  test("sidecar keeps only user-authored subtypes (SN-151 link flood)", () => {
    // A link-heavy book exported thousands of native LINK annotations whose
    // re-import froze every open. Only ink (15) and highlight (9) persist.
    const nativeLink = { annotation: { id: "link-1", type: 2, pageIndex: 3 } };
    const untyped = { annotation: { id: "mystery" } };
    const parsed = parsePdfAnnotationSidecar({
      items: [nativeLink, ...SAMPLE_ITEMS, untyped],
    });
    expect(parsed.items).toEqual(SAMPLE_ITEMS);

    const built = buildPdfAnnotationSidecar([nativeLink, ...SAMPLE_ITEMS]);
    expect(built.items).toEqual(SAMPLE_ITEMS);

    expect(
      filterUserAuthoredAnnotationItems([nativeLink, ...SAMPLE_ITEMS, untyped])
    ).toEqual(SAMPLE_ITEMS);
  });

  test("collectPdfHighlightQuoteTargets returns geometry-bearing highlights only", () => {
    const sidecar = buildPdfAnnotationSidecar([
      ...SAMPLE_ITEMS, // ink (skipped) + highlight with segmentRects on page 0
      {
        annotation: {
          id: "anno-hl-nogeo",
          type: 9,
          pageIndex: 4,
          segmentRects: [],
          opacity: 0.4,
        },
      },
    ]);
    const targets = collectPdfHighlightQuoteTargets(sidecar);
    expect(targets).toEqual([
      {
        pageIndex: 0,
        segmentRects: [{ origin: { x: 8, y: 80 }, size: { width: 60, height: 14 } }],
      },
    ]);
  });
});

describe("extractPdfPageTextItems adapter (SN-218)", () => {
  // The real pdfjs coordinate pipeline is verified out-of-band (a probe PDF with
  // text at user-space baseline (20,170) maps to top-left (x 20, yTop 18), which
  // matches EmbedPDF highlight geometry). Here we assert the safe-degradation
  // contract: any failure returns null so the companion honestly reports
  // "marked text unavailable" instead of inventing a passage.
  test("returns null for out-of-range page numbers", async () => {
    await expect(extractPdfPageTextItems("/nonexistent.pdf", 0)).resolves.toBeNull();
    await expect(extractPdfPageTextItems("/nonexistent.pdf", -3)).resolves.toBeNull();
  });

  test("returns null when the file cannot be read", async () => {
    await expect(
      extractPdfPageTextItems(path.join(os.tmpdir(), "sn218-missing-xyz.pdf"), 1)
    ).resolves.toBeNull();
  });
});

describe("pdf annotation sidecar persistence", () => {
  test("returns empty items when no sidecar exists", async () => {
    await withVaultFixture(async ({ pdfRelative }) => {
      const sidecar = await readPdfAnnotations(pdfRelative);
      expect(sidecar.items).toEqual([]);
      expect(sidecar.source).toBe("embedpdf-annotation");
      expect(sidecar.version).toBe(1);
    });
  });

  test("round-trips ink/highlight items and leaves PDF bytes unchanged", async () => {
    await withVaultFixture(async ({ pdfRelative, pdfAbsolute, vaultRoot }) => {
      const beforeHash = await hashPdfBytes(pdfRelative);
      const beforeBytes = await fs.readFile(pdfAbsolute);

      await savePdfAnnotations(pdfRelative, SAMPLE_ITEMS);
      const loaded = await readPdfAnnotations(pdfRelative);
      expect(loaded.items).toHaveLength(2);
      expect(loaded.items[0]?.annotation.id).toBe("anno-ink-1");
      expect(loaded.items[1]?.annotation.id).toBe("anno-hl-1");

      const sidecarAbs = path.join(
        vaultRoot,
        "Notebook",
        "Section",
        "note.assets",
        "paper.pdf.annotations.json"
      );
      const raw = JSON.parse(await fs.readFile(sidecarAbs, "utf8")) as {
        source: string;
        items: unknown[];
      };
      expect(raw.source).toBe("embedpdf-annotation");
      expect(raw.items).toHaveLength(2);

      const afterHash = await hashPdfBytes(pdfRelative);
      const afterBytes = await fs.readFile(pdfAbsolute);
      expect(afterHash).toBe(beforeHash);
      expect(afterBytes.equals(beforeBytes)).toBe(true);
    });
  });

  test("reopen restores prior annotations via read after save", async () => {
    await withVaultFixture(async ({ pdfRelative }) => {
      await savePdfAnnotations(pdfRelative, SAMPLE_ITEMS);
      // Simulate a fresh reader open: only read path, no in-memory state.
      const restored = await readPdfAnnotations(pdfRelative);
      expect(buildPdfAnnotationSidecar(restored.items).items).toEqual(
        buildPdfAnnotationSidecar(SAMPLE_ITEMS).items
      );
    });
  });

  test("empty save removes the sidecar file", async () => {
    await withVaultFixture(async ({ pdfRelative, vaultRoot }) => {
      await savePdfAnnotations(pdfRelative, SAMPLE_ITEMS);
      const sidecarAbs = path.join(
        vaultRoot,
        "Notebook",
        "Section",
        "note.assets",
        "paper.pdf.annotations.json"
      );
      await expect(fs.stat(sidecarAbs)).resolves.toBeTruthy();

      await savePdfAnnotations(pdfRelative, []);
      await expect(fs.stat(sidecarAbs)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await readPdfAnnotations(pdfRelative)).items).toEqual([]);
    });
  });

  test("GET/PUT /api/pdf-annotations round-trip", async () => {
    await withVaultFixture(async ({ pdfRelative, pdfAbsolute }) => {
      const beforeHash = await hashPdfBytes(pdfRelative);

      const putResponse = await PUT(
        new Request("http://localhost/api/pdf-annotations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: pdfRelative, items: SAMPLE_ITEMS }),
        })
      );
      expect(putResponse.status).toBe(200);

      const getResponse = await GET(
        new Request(
          `http://localhost/api/pdf-annotations?path=${encodeURIComponent(pdfRelative)}`
        )
      );
      expect(getResponse.status).toBe(200);
      const payload = (await getResponse.json()) as { items: Array<{ annotation: { id: string } }> };
      expect(payload.items.map((i) => i.annotation.id)).toEqual(["anno-ink-1", "anno-hl-1"]);

      expect(await hashPdfBytes(pdfRelative)).toBe(beforeHash);
      expect(await fs.readFile(pdfAbsolute, "utf8")).toBe(MINIMAL_PDF);
    });
  });
});
