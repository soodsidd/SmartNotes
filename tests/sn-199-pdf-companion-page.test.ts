import fs from "node:fs";
import path from "node:path";

const READER_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../src/components/immersive-pdf-reader.tsx"),
  "utf8"
);
const SHELL_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
  "utf8"
);

describe("SN-199 live PDF companion context wiring", () => {
  it("reports the reader's live 1-based page to its shell owner", () => {
    expect(READER_SOURCE).toContain("onPageChange?: (page: number, pageCount?: number) => void");
    expect(READER_SOURCE).toContain("onPageChange?.(currentPage, totalPages || undefined)");
    expect(READER_SOURCE).toContain("[currentPage, totalPages, onPageChange]");
  });

  it("stores the live page beside the active href and sends both only while open", () => {
    expect(SHELL_SOURCE).toContain("const nextTarget = { ...current.target, page, pageCount }");
    expect(SHELL_SOURCE).toContain("writeActivePdfReaderSession(nextTarget)");
    expect(SHELL_SOURCE).toContain("onPageChange={handlePdfReaderPageChange}");
    expect(SHELL_SOURCE).toContain("activePdfHref: pdfReaderOpen ? pdfReader?.href : undefined");
    expect(SHELL_SOURCE).toContain("activePdfFileName: pdfReaderOpen ? pdfReader?.fileName : undefined");
    expect(SHELL_SOURCE).toContain("pdfPage: pdfReaderOpen ? pdfReader?.page : undefined");
    expect(SHELL_SOURCE).toContain("pdfPageCount: pdfReaderOpen ? pdfReader?.pageCount : undefined");
    expect(SHELL_SOURCE).toContain("activePdfPageCount: pdfReaderOpen ? pdfReader?.pageCount : undefined");
    expect(SHELL_SOURCE).toContain("setPdfReaderState(closeRetainedPdfReader)");
  });
});
