import type { PdfAttachmentTarget } from "@/lib/pdf-attachment";

/**
 * The tab retains one EmbedPDF host after close. Reopening the same href keeps
 * its mounted document tree; opening another href replaces that single slot.
 */
export interface RetainedPdfReaderState {
  target: PdfAttachmentTarget | null;
  open: boolean;
}

export function createRetainedPdfReaderState(
  restoredTarget: PdfAttachmentTarget | null
): RetainedPdfReaderState {
  return {
    target: restoredTarget,
    open: restoredTarget !== null,
  };
}

export function openRetainedPdfReader(
  current: RetainedPdfReaderState,
  target: PdfAttachmentTarget
): RetainedPdfReaderState {
  if (current.target?.href === target.href) {
    return { ...current, open: true };
  }
  return { target, open: true };
}

export function closeRetainedPdfReader(
  current: RetainedPdfReaderState
): RetainedPdfReaderState {
  return { ...current, open: false };
}
