/**
 * @jest-environment node
 */

import {
  closeRetainedPdfReader,
  createRetainedPdfReaderState,
  openRetainedPdfReader,
} from "@/lib/pdf-reader-session";

describe("retained PDF reader session", () => {
  const book = { href: "/vault/book.pdf", fileName: "book.pdf" };
  const paper = { href: "/vault/paper.pdf", fileName: "paper.pdf" };

  it("keeps the same PDF target after close so reopen can reuse its mounted host", () => {
    const loaded = openRetainedPdfReader(
      createRetainedPdfReaderState(null),
      book
    );
    const hidden = closeRetainedPdfReader(loaded);
    const reopened = openRetainedPdfReader(hidden, book);

    expect(hidden).toEqual({ target: book, open: false });
    expect(reopened).toEqual({ target: book, open: true });
    expect(reopened.target).toBe(loaded.target);
  });

  it("bounds retention to one slot by replacing the prior PDF target", () => {
    const hiddenBook = closeRetainedPdfReader(
      openRetainedPdfReader(createRetainedPdfReaderState(null), book)
    );
    const openedPaper = openRetainedPdfReader(hiddenBook, paper);

    expect(openedPaper).toEqual({ target: paper, open: true });
    expect(openedPaper.target?.href).not.toBe(book.href);
  });
});
