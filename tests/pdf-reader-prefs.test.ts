/**
 * @jest-environment jsdom
 */
import {
  DEFAULT_PDF_READER_PREFS,
  clampReaderPage,
  parseJumpPage,
  parseZoomPercent,
  MIN_ZOOM_PERCENT,
  MAX_ZOOM_PERCENT,
  pdfReaderNightModeKey,
  pdfReaderPrefsKey,
  readPdfReaderNightModePref,
  readPdfReaderPrefs,
  resolvePdfReaderNightMode,
  writePdfReaderNightModePref,
  writePdfReaderPrefs,
} from "@/lib/pdf-reader-prefs";

const HREF = "/vault/Physics/quantum-notes.assets/catalogue.pdf";

describe("pdf-reader-prefs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("returns defaults when nothing is stored", () => {
    expect(readPdfReaderPrefs(HREF)).toEqual(DEFAULT_PDF_READER_PREFS);
    expect(DEFAULT_PDF_READER_PREFS).toEqual({ page: 1, zoom: "fit-width", spreadMode: false, spreadOffset: "even" });
  });

  test("persists and reads back last-read page and zoom per attachment", () => {
    writePdfReaderPrefs(HREF, { page: 12, zoom: 1.5 });
    expect(readPdfReaderPrefs(HREF)).toEqual({ ...DEFAULT_PDF_READER_PREFS, page: 12, zoom: 1.5 });

    // A different attachment is remembered independently.
    const other = "/vault/Notes/other.assets/spec.pdf";
    expect(readPdfReaderPrefs(other)).toEqual(DEFAULT_PDF_READER_PREFS);
    writePdfReaderPrefs(other, { page: 3, zoom: "fit-page" });
    expect(readPdfReaderPrefs(other)).toEqual({ ...DEFAULT_PDF_READER_PREFS, page: 3, zoom: "fit-page" });
    expect(readPdfReaderPrefs(HREF)).toEqual({ ...DEFAULT_PDF_READER_PREFS, page: 12, zoom: 1.5 });
  });

  test("uses a stable, href-scoped storage key", () => {
    writePdfReaderPrefs(HREF, { page: 5, zoom: "automatic" });
    const raw = window.localStorage.getItem(pdfReaderPrefsKey(HREF));
    expect(raw).toBe(JSON.stringify({ page: 5, zoom: "automatic", spreadMode: false, spreadOffset: "even" }));
  });

  test("normalizes invalid stored values back to defaults", () => {
    window.localStorage.setItem(
      pdfReaderPrefsKey(HREF),
      JSON.stringify({ page: -4, zoom: "banana" })
    );
    expect(readPdfReaderPrefs(HREF)).toEqual(DEFAULT_PDF_READER_PREFS);

    window.localStorage.setItem(pdfReaderPrefsKey(HREF), "not json{");
    expect(readPdfReaderPrefs(HREF)).toEqual(DEFAULT_PDF_READER_PREFS);
  });

  test("coerces invalid fields on write so future reads stay valid", () => {
    // @ts-expect-error deliberately invalid runtime input
    writePdfReaderPrefs(HREF, { page: 0, zoom: -2 });
    expect(readPdfReaderPrefs(HREF)).toEqual(DEFAULT_PDF_READER_PREFS);
  });

  test("empty href is a no-op and yields defaults", () => {
    writePdfReaderPrefs("", { page: 9, zoom: 2 });
    expect(readPdfReaderPrefs("")).toEqual(DEFAULT_PDF_READER_PREFS);
  });
});

describe("clampReaderPage", () => {
  test("returns 1 until the page count is known", () => {
    expect(clampReaderPage(8, 0)).toBe(1);
    expect(clampReaderPage(8, -1)).toBe(1);
  });

  test("keeps a valid remembered page", () => {
    expect(clampReaderPage(8, 40)).toBe(8);
    expect(clampReaderPage(1, 40)).toBe(1);
  });

  test("clamps a stale page beyond the document to the last page", () => {
    expect(clampReaderPage(999, 40)).toBe(40);
  });

  test("floors fractional and rejects sub-1 pages", () => {
    expect(clampReaderPage(3.7, 40)).toBe(3);
    expect(clampReaderPage(0, 40)).toBe(1);
    expect(clampReaderPage(-5, 40)).toBe(1);
  });
});

describe("parseJumpPage (direct page-jump input)", () => {
  test("returns null until the page count is known", () => {
    expect(parseJumpPage("5", 0)).toBeNull();
    expect(parseJumpPage("5", -1)).toBeNull();
  });

  test("returns null for empty or non-numeric entries", () => {
    expect(parseJumpPage("", 600)).toBeNull();
    expect(parseJumpPage("   ", 600)).toBeNull();
    expect(parseJumpPage("abc", 600)).toBeNull();
    expect(parseJumpPage("12a", 600)).toBeNull();
    expect(parseJumpPage("-3", 600)).toBeNull();
    expect(parseJumpPage("1.5", 600)).toBeNull();
  });

  test("accepts an in-range page verbatim", () => {
    expect(parseJumpPage("1", 600)).toBe(1);
    expect(parseJumpPage("317", 600)).toBe(317);
    expect(parseJumpPage("600", 600)).toBe(600);
  });

  test("clamps out-of-range entries to the document range", () => {
    expect(parseJumpPage("0", 600)).toBe(1);
    expect(parseJumpPage("9999", 600)).toBe(600);
    expect(parseJumpPage("601", 600)).toBe(600);
  });

  test("tolerates surrounding whitespace", () => {
    expect(parseJumpPage("  42  ", 600)).toBe(42);
  });
});

describe("parseZoomPercent (manual zoom entry, SN-198)", () => {
  test("returns null for empty or non-numeric entries", () => {
    expect(parseZoomPercent("")).toBeNull();
    expect(parseZoomPercent("   ")).toBeNull();
    expect(parseZoomPercent("abc")).toBeNull();
    expect(parseZoomPercent("12a")).toBeNull();
    expect(parseZoomPercent("-50")).toBeNull();
    expect(parseZoomPercent("1.2.3")).toBeNull();
  });

  test("converts a valid percent to a scale factor", () => {
    expect(parseZoomPercent("100")).toBe(1);
    expect(parseZoomPercent("150")).toBe(1.5);
    expect(parseZoomPercent("25")).toBe(0.25);
    expect(parseZoomPercent("1000")).toBe(10);
    expect(parseZoomPercent("87.5")).toBe(0.875);
  });

  test("tolerates a trailing percent sign and whitespace", () => {
    expect(parseZoomPercent(" 125% ")).toBe(1.25);
    expect(parseZoomPercent("200%")).toBe(2);
  });

  test("clamps below-min and above-max to plugin bounds", () => {
    expect(parseZoomPercent("10")).toBe(MIN_ZOOM_PERCENT / 100);
    expect(parseZoomPercent("1")).toBe(MIN_ZOOM_PERCENT / 100);
    expect(parseZoomPercent("5000")).toBe(MAX_ZOOM_PERCENT / 100);
    expect(MIN_ZOOM_PERCENT).toBe(25);
    expect(MAX_ZOOM_PERCENT).toBe(1000);
  });

  test("persists a manually applied numeric zoom like toolbar zoom", () => {
    writePdfReaderPrefs(HREF, { page: 7, zoom: parseZoomPercent("175")! });
    expect(readPdfReaderPrefs(HREF)).toEqual({ ...DEFAULT_PDF_READER_PREFS, page: 7, zoom: 1.75 });
  });
});

describe("PDF reader night mode pref (SN-225)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("has no explicit choice until the reader control is toggled", () => {
    expect(readPdfReaderNightModePref()).toBeNull();
    expect(pdfReaderNightModeKey()).toBe("smart-notes:pdf-reader:night-mode");
  });

  test("follows Settings theme when the owner has never toggled night mode", () => {
    expect(resolvePdfReaderNightMode("dark")).toBe(true);
    expect(resolvePdfReaderNightMode("light")).toBe(false);
  });

  test("persists an explicit toggle across reopen and ignores theme after that", () => {
    writePdfReaderNightModePref(true);
    expect(readPdfReaderNightModePref()).toBe("on");
    expect(resolvePdfReaderNightMode("light")).toBe(true);
    expect(window.localStorage.getItem(pdfReaderNightModeKey())).toBe("on");

    writePdfReaderNightModePref(false);
    expect(readPdfReaderNightModePref()).toBe("off");
    expect(resolvePdfReaderNightMode("dark")).toBe(false);
  });

  test("does not mix night mode into per-attachment page/zoom prefs", () => {
    writePdfReaderPrefs(HREF, { page: 12, zoom: 1.5 });
    writePdfReaderNightModePref(true);
    expect(readPdfReaderPrefs(HREF)).toEqual({ ...DEFAULT_PDF_READER_PREFS, page: 12, zoom: 1.5 });
    expect(readPdfReaderNightModePref()).toBe("on");
  });

  test("round-trips spread mode and page-pairing offset per attachment", () => {
    writePdfReaderPrefs(HREF, { page: 8, zoom: "fit-width", spreadMode: true, spreadOffset: "odd" });
    expect(readPdfReaderPrefs(HREF)).toEqual({ page: 8, zoom: "fit-width", spreadMode: true, spreadOffset: "odd" });
  });

  test("preserves spread preferences when a caller updates only page and zoom", () => {
    writePdfReaderPrefs(HREF, { page: 8, zoom: "fit-width", spreadMode: true, spreadOffset: "odd" });
    writePdfReaderPrefs(HREF, { page: 10, zoom: 1.25 });

    expect(readPdfReaderPrefs(HREF)).toEqual({
      page: 10,
      zoom: 1.25,
      spreadMode: true,
      spreadOffset: "odd",
    });
  });

  test("treats invalid stored night-mode values as follow-theme", () => {
    window.localStorage.setItem(pdfReaderNightModeKey(), "banana");
    expect(readPdfReaderNightModePref()).toBeNull();
    expect(resolvePdfReaderNightMode("dark")).toBe(true);
  });
});
