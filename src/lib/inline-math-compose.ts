/** LaTeX command → Unicode symbol expansions applied on space commit boundaries. */
export const LATEX_SHORTCUTS: Record<string, string> = {
  "\\lambda": "λ",
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\pi": "π",
  "\\sigma": "σ",
  "\\theta": "θ",
  "\\infty": "∞",
  "\\pm": "±",
  "\\times": "×",
  "\\cdot": "·",
  "\\leq": "≤",
  "\\geq": "≥",
  "\\neq": "≠",
  "\\approx": "≈",
};

export type InlineMathComposeState = {
  /** Document position for insert, or existing node position when editing. */
  pos: number;
  latex: string;
  anchorTop: number;
  anchorLeft: number;
  /** When set, commit updates the math node at this position instead of inserting. */
  editPos?: number;
  /** Text cursor position to restore after committing an edit. */
  resumePos?: number;
  /**
   * Whether the anchored editor is editing a block (`$$…$$`) equation rather than
   * an inline one. Commit must keep the node's original inline/block type (SN-158).
   */
  block?: boolean;
};

/** Infer where the caret should return after editing an inline math node. */
export function inferInlineMathResumePos(
  nodePos: number,
  nodeSize: number,
  lastTextPos: number | null,
  fallback: "before" | "after" = "after"
): number {
  if (lastTextPos === null) {
    return fallback === "before" ? nodePos : nodePos + nodeSize;
  }
  if (lastTextPos <= nodePos) return nodePos;
  if (lastTextPos >= nodePos + nodeSize) return nodePos + nodeSize;
  return nodePos + nodeSize;
}

/** Expand a trailing `\command` token when the user presses Space. */
export function expandLatexShortcutOnSpace(latex: string): string {
  const match = latex.match(/\\[a-zA-Z]+$/);
  if (!match) return latex;
  const shortcut = match[0];
  const symbol = LATEX_SHORTCUTS[shortcut];
  if (!symbol) return latex;
  return latex.slice(0, -shortcut.length) + symbol;
}

export type InlineMathSpaceResult = {
  latex: string;
  commit: boolean;
  /** Caret index inside the compose input after the space action. */
  cursorPos?: number;
};

/**
 * Word-style `\frac` + space opens a fraction template with the caret in the
 * numerator braces.
 */
export function expandFracTemplateOnSpace(latex: string): InlineMathSpaceResult | null {
  const trimmedEnd = latex.replace(/\s+$/, "");
  if (!/^\\frac$/i.test(trimmedEnd)) return null;
  const template = "\\frac{}{}";
  return { latex: template, commit: false, cursorPos: "\\frac{".length };
}

/**
 * Simple `a/b` + space becomes `\frac{a}{b}` so KaTeX renders a stacked fraction.
 */
export function expandSlashFractionOnSpace(latex: string): InlineMathSpaceResult | null {
  const trimmedEnd = latex.replace(/\s+$/, "");
  if (trimmedEnd.includes("\\")) return null;
  const match = trimmedEnd.match(/^(.+)\/([^/]+)$/);
  if (!match) return null;
  const [, numerator, denominator] = match;
  if (!numerator || !denominator) return null;
  return {
    latex: `\\frac{${numerator}}{${denominator}}`,
    commit: false,
    cursorPos: `\\frac{${numerator}}{${denominator}}`.length,
  };
}

/**
 * Space: expand shortcuts; commit immediately when the buffer was a lone command
 * (e.g. `\lambda` → `λ`). Otherwise append a space and keep composing.
 */
export function handleInlineMathSpace(latex: string): InlineMathSpaceResult {
  const fracTemplate = expandFracTemplateOnSpace(latex);
  if (fracTemplate) return fracTemplate;

  const slashFraction = expandSlashFractionOnSpace(latex);
  if (slashFraction) return slashFraction;

  const trimmedEnd = latex.replace(/\s+$/, "");
  const loneCommand = /^\\[a-zA-Z]+$/.test(trimmedEnd);
  const expanded = expandLatexShortcutOnSpace(trimmedEnd);
  if (loneCommand && expanded !== trimmedEnd) {
    return { latex: expanded, commit: true };
  }
  if (expanded !== trimmedEnd) {
    return { latex: `${expanded} `, commit: false, cursorPos: expanded.length + 1 };
  }
  return { latex: `${latex} `, commit: false, cursorPos: latex.length + 1 };
}
