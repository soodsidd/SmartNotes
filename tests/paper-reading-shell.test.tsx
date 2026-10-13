/**
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PaperNotesDock } from "@/components/paper-notes-dock";
import {
  PAPER_NOTES_DEFAULT_WIDTH,
  PAPER_NOTES_KEYBOARD_STEP,
  PAPER_NOTES_MIN_WIDTH,
  PAPER_NOTES_WIDTH_STORAGE_KEY,
  PAPER_READER_MIN_WIDTH,
  PAPER_SPLIT_MIN_VIEWPORT,
  clampPaperNotesWidth,
  isPaperOpenPdfMessage,
  paperNotesFrameSrc,
  paperShellLayout,
  readPaperNotesOpen,
  readPaperNotesWidth,
  writePaperNotesOpen,
  writePaperNotesWidth,
  type PaperShellLayout,
} from "@/lib/paper-reading-shell";
import { closeRetainedPdfReader, createRetainedPdfReaderState, openRetainedPdfReader } from "@/lib/pdf-reader-session";

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const SHELL_SOURCE = read("src/components/notebook-shell-reliable.tsx");
const TOKENS_SOURCE = read("src/styles/tokens.css");
const GLOBALS_SOURCE = read("src/app/globals.css");
const PAPER = ".bibliography/0b7a3c1e-4f2d-4a8b-9c3d-2e1f0a9b8c7d.html";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

function zToken(name: string): number {
  const match = TOKENS_SOURCE.match(new RegExp(`--${name}:\\s*(\\d+)`));
  if (!match) throw new Error(`missing token --${name}`);
  return Number(match[1]);
}

describe("paper reading shell layout", () => {
  it("docks notes on the right at the persisted width and insets the PDF by exactly that width", () => {
    expect(paperShellLayout({ viewportWidth: 1440, notesWidth: 520, notesOpen: true })).toEqual({
      mode: "split",
      readerInsetRight: 520,
      notesWidth: 520,
    });
  });

  it("clamps notes so both frames keep their minimum width", () => {
    expect(clampPaperNotesWidth(100, 1440)).toBe(PAPER_NOTES_MIN_WIDTH);
    expect(clampPaperNotesWidth(5000, 1440)).toBe(1440 - PAPER_READER_MIN_WIDTH);
    expect(clampPaperNotesWidth(Number.NaN, 1440)).toBe(PAPER_NOTES_DEFAULT_WIDTH);
    const layout = paperShellLayout({ viewportWidth: 900, notesWidth: 800, notesOpen: true });
    expect(900 - layout.readerInsetRight).toBeGreaterThanOrEqual(PAPER_READER_MIN_WIDTH);
  });

  it("gives the whole viewport to the PDF when notes are hidden", () => {
    expect(paperShellLayout({ viewportWidth: 1440, notesWidth: 520, notesOpen: false })).toEqual({
      mode: "hidden",
      readerInsetRight: 0,
      notesWidth: null,
    });
  });

  it("uses a full-width notes layer on narrow viewports, hidden until requested", () => {
    const narrow = PAPER_SPLIT_MIN_VIEWPORT - 1;
    expect(paperShellLayout({ viewportWidth: narrow, notesWidth: 520, notesOpen: true }).mode).toBe("hidden");
    expect(paperShellLayout({ viewportWidth: narrow, notesWidth: 520, notesOpen: true, overlayOpen: true })).toEqual({
      mode: "overlay",
      readerInsetRight: 0,
      notesWidth: null,
    });
  });
});

describe("paper notes width persistence", () => {
  it("round-trips the width and open preference", () => {
    const storage = memoryStorage();
    expect(readPaperNotesWidth(storage)).toBe(PAPER_NOTES_DEFAULT_WIDTH);
    expect(readPaperNotesOpen(storage)).toBe(true);
    writePaperNotesWidth(storage, 611.6);
    writePaperNotesOpen(storage, false);
    expect(storage.values.get(PAPER_NOTES_WIDTH_STORAGE_KEY)).toBe("612");
    expect(readPaperNotesWidth(storage)).toBe(612);
    expect(readPaperNotesOpen(storage)).toBe(false);
  });

  it("keeps a wide preference unclamped in storage and rejects corrupt values", () => {
    expect(readPaperNotesWidth(memoryStorage({ [PAPER_NOTES_WIDTH_STORAGE_KEY]: "1200" }))).toBe(1200);
    expect(readPaperNotesWidth(memoryStorage({ [PAPER_NOTES_WIDTH_STORAGE_KEY]: "abc" }))).toBe(PAPER_NOTES_DEFAULT_WIDTH);
    expect(readPaperNotesWidth(memoryStorage({ [PAPER_NOTES_WIDTH_STORAGE_KEY]: "12" }))).toBe(PAPER_NOTES_DEFAULT_WIDTH);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readPaperNotesWidth(throwing)).toBe(PAPER_NOTES_DEFAULT_WIDTH);
    expect(() => writePaperNotesWidth(throwing, 500)).not.toThrow();
  });
});

describe("companion overlay z-order and non-displacement", () => {
  it("orders reader < paper notes dock < companion rail < companion floating layers", () => {
    expect(zToken("z-pdf-reader")).toBeLessThan(zToken("z-paper-notes"));
    expect(zToken("z-paper-notes")).toBeLessThan(zToken("z-companion-rail"));
    expect(zToken("z-companion-rail")).toBeLessThan(zToken("z-companion-overlay"));
    expect(GLOBALS_SOURCE).toMatch(/\.paper-notes-dock\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*var\(--z-paper-notes\);/);
  });

  it("derives frame geometry without any Companion input", () => {
    const base = { viewportWidth: 1440, notesWidth: 480, notesOpen: true };
    const withCompanion = { ...base, companionOpen: true, companionWidth: 360 } as Parameters<typeof paperShellLayout>[0];
    expect(paperShellLayout(withCompanion)).toEqual(paperShellLayout(base));
  });

  it("renders Companion over the reader as a fixed right overlay and feeds the reader only the notes inset", () => {
    // Over the reader the rail is position:fixed on the companion-rail layer, so
    // it cannot take width from the in-flow PDF or notes frames.
    expect(SHELL_SOURCE).toContain('"fixed inset-y-0 right-0 z-[var(--z-companion-rail)] shadow-lg"');
    expect(SHELL_SOURCE).toContain("const companionOverReader = Boolean(pdfReaderOpen);");
    expect(SHELL_SOURCE).toContain("insetRight={paperShellPath ? paperLayout.readerInsetRight : 0}");
    const layoutCall = SHELL_SOURCE.match(/const paperLayout = paperShellLayout\(\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(layoutCall).not.toBe("");
    expect(layoutCall).not.toMatch(/aiOpen|aiSidebarWidth|companion/i);
  });
});

describe("PaperNotesDock", () => {
  function renderDock(layout: PaperShellLayout, overrides: Partial<React.ComponentProps<typeof PaperNotesDock>> = {}) {
    const onWidthCommit = jest.fn();
    const onHide = jest.fn();
    const frameRef = React.createRef<HTMLIFrameElement>();
    render(
      <PaperNotesDock
        paperPath={PAPER}
        title="Attention Is All You Need"
        layout={layout}
        preferredWidth={480}
        frameReady
        error={null}
        frameRef={frameRef}
        onHide={onHide}
        onWidthCommit={onWidthCommit}
        {...overrides}
      />
    );
    return { onWidthCommit, onHide, frameRef };
  }

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  });

  it("docks the canonical paper frame at the layout width with a keyboard-resizable separator", () => {
    const { onWidthCommit, frameRef } = renderDock({ mode: "split", readerInsetRight: 480, notesWidth: 480 });
    const dock = screen.getByTestId("paper-notes-dock");
    expect(dock).toHaveStyle({ width: "480px" });
    expect(dock).toHaveAttribute("data-mode", "split");
    expect(frameRef.current).toHaveAttribute("src", paperNotesFrameSrc(PAPER));
    const separator = screen.getByRole("separator", { name: "Resize paper notes" });
    expect(separator).toHaveAttribute("aria-valuenow", "480");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onWidthCommit).toHaveBeenLastCalledWith(480 + PAPER_NOTES_KEYBOARD_STEP);
    fireEvent.keyDown(separator, { key: "Home" });
    expect(onWidthCommit).toHaveBeenLastCalledWith(PAPER_NOTES_MIN_WIDTH);
  });

  it("keeps the frame mounted while hidden so unsaved notes survive toggling", () => {
    renderDock({ mode: "hidden", readerInsetRight: 0, notesWidth: null });
    expect(screen.getByTestId("paper-notes-dock")).not.toBeVisible();
    expect(screen.getByTestId("paper-notes-frame")).toBeInTheDocument();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("offers Back to PDF on the narrow overlay and surfaces save failures", () => {
    const { onHide } = renderDock(
      { mode: "overlay", readerInsetRight: 0, notesWidth: null },
      { error: "Paper notes could not be saved." }
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Paper notes could not be saved.");
    fireEvent.click(screen.getByRole("button", { name: "Back to PDF" }));
    expect(onHide).toHaveBeenCalled();
  });

  it("offers Hide paper notes on the wide split dock (landscape phones land here)", () => {
    const { onHide } = renderDock({ mode: "split", readerInsetRight: 400, notesWidth: 400 });
    fireEvent.click(screen.getByRole("button", { name: "Hide paper notes" }));
    expect(onHide).toHaveBeenCalled();
  });

  it("keeps the PDF toolbar notes toggle visible while the paper shell is open", () => {
    expect(GLOBALS_SOURCE).not.toMatch(
      /\.pdf-reader\[data-paper-shell="true"\]\s*\[data-testid="pdf-reader-paper-notes-toggle"\]\s*\{\s*display:\s*none/
    );
  });

  it("waits for the host save before loading the notes frame", () => {
    renderDock({ mode: "split", readerInsetRight: 480, notesWidth: 480 }, { frameReady: false });
    expect(screen.queryByTestId("paper-notes-frame")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Saving open notes");
  });
});

describe("paper PDF hand-off", () => {
  it("accepts only Bibliography paper open-PDF messages", () => {
    const target = { href: "/vault/.bibliography/a.assets/a.pdf", fileName: "a.pdf" };
    expect(isPaperOpenPdfMessage({ type: "paper-open-pdf", paperPath: PAPER, target })).toBe(true);
    expect(isPaperOpenPdfMessage({ type: "paper-open-pdf", paperPath: "Notebook/page.html", target })).toBe(false);
    expect(isPaperOpenPdfMessage({ type: "paper-open-pdf", paperPath: PAPER })).toBe(false);
    expect(isPaperOpenPdfMessage(null)).toBe(false);
  });

  it("retains the reader host for the same PDF while updating its paper ownership", () => {
    const pdf = { href: "/vault/a.pdf", fileName: "a.pdf" };
    const hidden = closeRetainedPdfReader(openRetainedPdfReader(createRetainedPdfReaderState(null), pdf));
    const asPaper = openRetainedPdfReader(hidden, { ...pdf, paperPath: PAPER });
    expect(asPaper).toEqual({ target: { ...pdf, paperPath: PAPER }, open: true });
    const again = openRetainedPdfReader(closeRetainedPdfReader(asPaper), { ...pdf, paperPath: PAPER });
    expect(again.target).toBe(asPaper.target);
    expect(openRetainedPdfReader(closeRetainedPdfReader(asPaper), pdf).target?.paperPath).toBeUndefined();
  });
});
