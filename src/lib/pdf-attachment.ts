/**
 * Resolving a PDF attachment chip to an immersive-reader launch target
 * (SN-135). Kept as a pure DOM helper so the launch path is unit-testable
 * without mounting the full rich-text editor.
 */

export interface PdfAttachmentTarget {
  /** The `/vault/...` href of the PDF attachment. */
  href: string;
  /** Best-effort display name for the attachment. */
  fileName: string;
  /** Live 1-based page while this target is open in the immersive reader. */
  page?: number;
  /** Authoritative page count reported by the loaded immersive reader document. */
  pageCount?: number;
}

/** Derive a display name from a `/vault/...` href when the chip lacks a label. */
export function fileNameFromHref(href: string): string {
  try {
    return decodeURIComponent(href.split("/").pop()?.split("?")[0] ?? "") || "PDF";
  } catch {
    return "PDF";
  }
}

/**
 * Given any element under (or equal to) a PDF attachment chip, resolve the
 * launch target for the immersive reader. Returns `null` when the element is
 * not part of a PDF chip or has no resolvable href.
 *
 * A chip is identified by `[data-file-type="pdf"]`; the href is read from the
 * `[data-href]` marker (falling back to a nested anchor), and the label from
 * `.file-attachment-name` (falling back to the href basename).
 */
export function resolvePdfAttachmentTarget(
  element: Element | null | undefined
): PdfAttachmentTarget | null {
  if (!element) return null;
  const chip = element.closest('[data-file-type="pdf"]');
  if (!chip) return null;

  const href =
    chip.querySelector("[data-href]")?.getAttribute("data-href") ??
    chip.querySelector("a")?.getAttribute("href") ??
    null;
  if (!href) return null;

  const label = chip.querySelector(".file-attachment-name")?.textContent?.trim();
  const fileName = label && label.length > 0 ? label : fileNameFromHref(href);

  return { href, fileName };
}
