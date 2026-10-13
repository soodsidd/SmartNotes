/**
 * SN-297: rule / grid line page background — setting model, frontmatter
 * mapping, CSS background rendering, and the per-browser new-page default.
 */
import {
  DEFAULT_PAGE_LINES,
  NEW_PAGE_LINES_STORAGE_KEY,
  PAGE_LINES_METADATA_KEY,
  applyPageLinesMetadata,
  normalizePageLines,
  pageLinesBackgroundStyle,
  pageLinesForNewPage,
  pageLinesFromMetadata,
  readNewPageLinesDefault,
  writeNewPageLinesDefault,
} from "@/lib/page-lines";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("page lines setting", () => {
  it("normalizes unknown or partial values to the default", () => {
    expect(normalizePageLines(undefined)).toEqual(DEFAULT_PAGE_LINES);
    expect(normalizePageLines("rule-college")).toEqual(DEFAULT_PAGE_LINES);
    expect(normalizePageLines({ style: "plaid", color: "magenta" })).toEqual(DEFAULT_PAGE_LINES);
    expect(normalizePageLines({ style: "grid-large" })).toEqual({ style: "grid-large", color: "light-blue" });
    expect(normalizePageLines({ style: "rule-wide", color: "green" })).toEqual({ style: "rule-wide", color: "green" });
  });

  it("round-trips through page frontmatter and omits the default", () => {
    const base = { title: "Page", comments: [] as unknown[] };
    const withLines = applyPageLinesMetadata(base, { style: "rule-college-margin", color: "lavender" });
    expect(withLines[PAGE_LINES_METADATA_KEY]).toEqual({ style: "rule-college-margin", color: "lavender" });
    expect(withLines.title).toBe("Page");
    expect(pageLinesFromMetadata(withLines)).toEqual({ style: "rule-college-margin", color: "lavender" });

    const cleared = applyPageLinesMetadata(withLines, DEFAULT_PAGE_LINES);
    expect(PAGE_LINES_METADATA_KEY in cleared).toBe(false);
    expect(pageLinesFromMetadata(cleared)).toEqual(DEFAULT_PAGE_LINES);
    // Input object is never mutated.
    expect(PAGE_LINES_METADATA_KEY in base).toBe(false);
  });

  it("keeps a non-default color even when lines are off", () => {
    const meta = applyPageLinesMetadata({}, { style: "none", color: "grey" });
    expect(meta[PAGE_LINES_METADATA_KEY]).toEqual({ style: "none", color: "grey" });
  });
});

describe("page lines background rendering", () => {
  it("renders nothing for None", () => {
    expect(pageLinesBackgroundStyle(DEFAULT_PAGE_LINES)).toBeUndefined();
  });

  it("renders ruled lines from spacing and color tokens", () => {
    const style = pageLinesBackgroundStyle({ style: "rule-narrow", color: "blue" });
    expect(style?.backgroundImage).toContain("var(--page-line-blue)");
    expect(style?.backgroundImage).toContain("var(--page-rule-narrow)");
    expect(style?.backgroundSize).toBe("100% var(--page-rule-narrow)");
    expect(style?.backgroundImage).not.toContain("--page-line-margin");
  });

  it("adds the red margin line only for the margin preset", () => {
    const style = pageLinesBackgroundStyle({ style: "rule-college-margin", color: "light-blue" });
    expect(style?.backgroundImage).toContain("var(--page-line-margin)");
    expect(style?.backgroundImage).toContain("var(--page-rule-margin-inset)");
    expect(style?.backgroundImage).toContain("var(--page-rule-college)");
    expect(style?.backgroundRepeat).toBe("no-repeat, repeat");
  });

  it("renders grids as horizontal + vertical lines on square cells", () => {
    const sizes = ["grid-small", "grid-medium", "grid-large", "grid-xlarge"] as const;
    for (const size of sizes) {
      const style = pageLinesBackgroundStyle({ style: size, color: "green" });
      const token = `var(--page-${size})`;
      expect(style?.backgroundSize).toBe(`${token} ${token}`);
      expect(style?.backgroundImage).toContain("to bottom");
      expect(style?.backgroundImage).toContain("to right");
    }
  });

  it("only sets background properties, never layout", () => {
    for (const style of ["rule-wide", "rule-college-margin", "grid-small"] as const) {
      const css = pageLinesBackgroundStyle({ style, color: "grey" }) ?? {};
      for (const key of Object.keys(css)) {
        expect(key.startsWith("background")).toBe(true);
      }
    }
  });
});

describe("always-create default (per browser)", () => {
  it("is off until written and clears on remove", () => {
    const storage = memoryStorage();
    expect(readNewPageLinesDefault(storage)).toBeNull();
    writeNewPageLinesDefault({ style: "grid-medium", color: "lavender" }, storage);
    expect(JSON.parse(storage.map.get(NEW_PAGE_LINES_STORAGE_KEY)!)).toEqual({
      style: "grid-medium",
      color: "lavender",
    });
    expect(readNewPageLinesDefault(storage)).toEqual({ style: "grid-medium", color: "lavender" });
    writeNewPageLinesDefault(null, storage);
    expect(readNewPageLinesDefault(storage)).toBeNull();
  });

  it("tolerates corrupt storage", () => {
    const storage = memoryStorage();
    storage.setItem(NEW_PAGE_LINES_STORAGE_KEY, "{not json");
    expect(readNewPageLinesDefault(storage)).toBeNull();
  });

  it("applies only to new text pages", () => {
    const storage = memoryStorage();
    expect(pageLinesForNewPage(undefined, storage)).toBeNull();
    writeNewPageLinesDefault({ style: "rule-wide", color: "blue" }, storage);
    expect(pageLinesForNewPage(undefined, storage)).toEqual({ style: "rule-wide", color: "blue" });
    expect(pageLinesForNewPage("text", storage)).toEqual({ style: "rule-wide", color: "blue" });
    for (const other of ["ink", "log", "jupyter", "design", "app", "spreadsheet"]) {
      expect(pageLinesForNewPage(other, storage)).toBeNull();
    }
  });

  it("returns null when the toggle is on but the default is no lines", () => {
    const storage = memoryStorage();
    writeNewPageLinesDefault(DEFAULT_PAGE_LINES, storage);
    expect(readNewPageLinesDefault(storage)).toEqual(DEFAULT_PAGE_LINES);
    expect(pageLinesForNewPage("text", storage)).toBeNull();
  });
});
