/**
 * @jest-environment jsdom
 */
import {
  fileNameFromHref,
  resolvePdfAttachmentTarget,
} from "@/lib/pdf-attachment";

const HREF = "/vault/Notebook/Section/rich.assets/Catalogue(Final).pdf";

function renderPdfChip(): HTMLElement {
  const host = document.createElement("div");
  // Mirrors FileAttachment.renderHTML for a PDF chip.
  host.innerHTML = `
    <span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf">
      <span class="file-attachment-icon" aria-hidden="true">PDF</span>
      <span class="file-attachment-name" data-href="${HREF}">Catalogue(Final).pdf</span>
    </span>`;
  return host;
}

describe("resolvePdfAttachmentTarget", () => {
  test("launches from a click on the chip label", () => {
    const host = renderPdfChip();
    const label = host.querySelector(".file-attachment-name")!;
    expect(resolvePdfAttachmentTarget(label)).toEqual({
      href: HREF,
      fileName: "Catalogue(Final).pdf",
    });
  });

  test("launches from a click on the chip icon (child element)", () => {
    const host = renderPdfChip();
    const icon = host.querySelector(".file-attachment-icon")!;
    expect(resolvePdfAttachmentTarget(icon)).toEqual({
      href: HREF,
      fileName: "Catalogue(Final).pdf",
    });
  });

  test("falls back to href basename when the chip has no label text", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf">
        <span class="file-attachment-name" data-href="${HREF}"></span>
      </span>`;
    const chip = host.querySelector('[data-file-type="pdf"]')!;
    expect(resolvePdfAttachmentTarget(chip)).toEqual({
      href: HREF,
      fileName: "Catalogue(Final).pdf",
    });
  });

  test("returns null for a non-PDF file chip", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <span data-file-attachment="" data-file-type="file" class="file-attachment-chip">
        <a href="/vault/x.assets/report.docx" class="file-attachment-name">report.docx</a>
      </span>`;
    const link = host.querySelector("a")!;
    expect(resolvePdfAttachmentTarget(link)).toBeNull();
  });

  test("returns null when clicking outside any chip", () => {
    const host = document.createElement("div");
    host.innerHTML = `<p>just some text</p>`;
    expect(resolvePdfAttachmentTarget(host.querySelector("p"))).toBeNull();
  });

  test("returns null for nullish input", () => {
    expect(resolvePdfAttachmentTarget(null)).toBeNull();
    expect(resolvePdfAttachmentTarget(undefined)).toBeNull();
  });
});

describe("fileNameFromHref", () => {
  test("decodes the basename and strips query", () => {
    expect(fileNameFromHref("/vault/a.assets/My%20Doc.pdf?v=2")).toBe("My Doc.pdf");
  });

  test("falls back to PDF when there is no basename", () => {
    expect(fileNameFromHref("")).toBe("PDF");
  });
});
