import {
  expandLatexShortcutOnSpace,
  expandFracTemplateOnSpace,
  expandSlashFractionOnSpace,
  handleInlineMathSpace,
  inferInlineMathResumePos,
} from "@/lib/inline-math-compose";

describe("inline math compose (SN-111)", () => {
  test("\\lambda converts to λ on space boundary", () => {
    expect(expandLatexShortcutOnSpace("\\lambda")).toBe("λ");
  });

  test("lone \\lambda + space commits converted symbol", () => {
    const result = handleInlineMathSpace("\\lambda");
    expect(result).toEqual({ latex: "λ", commit: true });
  });

  test("\\frac + space opens fraction template with caret in numerator", () => {
    const result = expandFracTemplateOnSpace("\\frac");
    expect(result).toEqual({
      latex: "\\frac{}{}",
      commit: false,
      cursorPos: "\\frac{".length,
    });
  });

  test("a/b + space expands to stacked fraction latex", () => {
    const result = expandSlashFractionOnSpace("a/b");
    expect(result).toEqual({
      latex: "\\frac{a}{b}",
      commit: false,
      cursorPos: "\\frac{a}{b}".length,
    });
  });

  test("space in longer expressions expands shortcut and keeps composing", () => {
    const result = handleInlineMathSpace("x+\\alpha");
    expect(result).toEqual({ latex: "x+α ", commit: false, cursorPos: 4 });
  });

  test("plain space appends without commit", () => {
    const result = handleInlineMathSpace("E=mc^2");
    expect(result).toEqual({ latex: "E=mc^2 ", commit: false, cursorPos: 7 });
  });

  test("resume position returns to approach side of inline math", () => {
    expect(inferInlineMathResumePos(5, 1, 4)).toBe(5);
    expect(inferInlineMathResumePos(5, 1, 6)).toBe(6);
    expect(inferInlineMathResumePos(5, 1, null, "after")).toBe(6);
  });
});
