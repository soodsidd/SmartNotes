/**
 * SN-369 / SN-274: one shared, currency-safe rule for dollar-sign math.
 *
 * Used by both the Companion chat renderer (`normalizeChatMath`, feeding
 * remark-math with `singleDollarTextMath: false`) and the server page-write
 * normalizer (`src/server/vault/math-normalize.ts`).
 *
 * Inline `$...$` follows Pandoc's tex_math_dollars rule:
 *   - the opening `$` is not escaped (`\$`) and is followed by a non-space;
 *   - the closing `$` is preceded by a non-space and NOT followed by a digit;
 *   - the span never crosses a newline and never contains another `$`.
 * So "$5 every 150 days … charged $175", "paid $564.08 … the $80" and
 * "$5-$10" stay literal while "$x^2$" and "$\alpha + \beta$" are math.
 *
 * One lenient extension for a common agent mistake: padded `$ \alpha $`
 * counts as math when the body is clearly TeX (a `\command`, `^`, `_`, `{`
 * or `}`), which currency prose never contains.
 */

export interface InlineMathSpan {
  /** Index of the opening `$`. */
  start: number;
  /** Index just past the closing `$`. */
  end: number;
  /** Trimmed TeX source between the delimiters. */
  latex: string;
}

const TEX_SIGNAL_RE = /\\[A-Za-z]+|[\^_{}]/;

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/**
 * Find currency-safe single-dollar inline math spans in one text run.
 * `$$` pairs are skipped (callers handle display math separately).
 */
export function findInlineDollarMath(text: string): InlineMathSpan[] {
  const spans: InlineMathSpan[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "$" || isEscaped(text, i)) {
      i += 1;
      continue;
    }
    if (text[i + 1] === "$") {
      // Skip a `$$` run entirely; it is display/explicit math, not ours.
      let j = i;
      while (text[j] === "$") j += 1;
      i = j;
      continue;
    }
    const open = i;
    const strictOpen = !isSpace(text[open + 1]);
    let close = -1;
    for (let j = open + 1; j < text.length; j += 1) {
      const ch = text[j];
      if (ch === "\n") break;
      if (ch !== "$" || isEscaped(text, j)) continue;
      close = j;
      break;
    }
    if (close === -1) {
      i = open + 1;
      continue;
    }
    if (text[close + 1] === "$") {
      // `$x$$` — ambiguous, treat the opener as literal.
      i = open + 1;
      continue;
    }
    const body = text.slice(open + 1, close);
    const strictClose = !isSpace(text[close - 1]) && !isDigit(text[close + 1]);
    const strict = strictOpen && strictClose && body.length > 0;
    const padded =
      !strict &&
      !isDigit(text[close + 1]) &&
      body.trim().length > 0 &&
      TEX_SIGNAL_RE.test(body);
    if (strict || padded) {
      spans.push({ start: open, end: close + 1, latex: body.trim() });
      i = close + 1;
    } else {
      // The closer may still open a later valid span ("$5 and $x$").
      i = open + 1;
    }
  }
  return spans;
}

/** Replace every currency-safe inline `$...$` span in a single text run. */
export function replaceInlineDollarMath(
  text: string,
  render: (latex: string) => string
): string {
  if (!text.includes("$")) return text;
  const spans = findInlineDollarMath(text);
  if (spans.length === 0) return text;
  let out = "";
  let last = 0;
  for (const span of spans) {
    out += text.slice(last, span.start) + render(span.latex);
    last = span.end;
  }
  return out + text.slice(last);
}

// ---------------------------------------------------------------------------
// Companion chat (markdown) normalization
// ---------------------------------------------------------------------------

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_FENCE_RE = /^ {0,3}\$\$\s*$/;

/** Rewrite one non-code text run (may span lines) for remark-math. */
function normalizeProse(text: string): string {
  // \[ ... \] display math (may span lines) → $$ flow block.
  let out = text.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`);
  // \( ... \) inline math → explicit $$...$$ text math.
  out = out.replace(/\\\(([^\n]+?)\\\)/g, (_m, body: string) => `$$${body.trim()}$$`);
  // Currency-safe single-dollar math → explicit $$...$$ text math. Lone `$`
  // stays literal because remark-math runs with singleDollarTextMath: false.
  return out
    .split("\n")
    .map((line) => replaceInlineDollarMath(line, (latex) => `$$${latex}$$`))
    .join("\n");
}

/** Split a non-fenced text block on inline code spans and normalize the prose parts. */
function normalizeOutsideInlineCode(text: string): string {
  let out = "";
  let i = 0;
  let proseStart = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      i += 1;
      continue;
    }
    let runEnd = i;
    while (text[runEnd] === "`") runEnd += 1;
    const ticks = text.slice(i, runEnd);
    const closeAt = findClosingTicks(text, runEnd, ticks.length);
    if (closeAt === -1) {
      i = runEnd;
      continue;
    }
    out += normalizeProse(text.slice(proseStart, i)) + text.slice(i, closeAt + ticks.length);
    i = closeAt + ticks.length;
    proseStart = i;
  }
  return out + normalizeProse(text.slice(proseStart));
}

function findClosingTicks(text: string, from: number, count: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] !== "`") {
      i += 1;
      continue;
    }
    let runEnd = i;
    while (text[runEnd] === "`") runEnd += 1;
    if (runEnd - i === count) return i;
    i = runEnd;
  }
  return -1;
}

/**
 * Prepare an assistant chat message for ReactMarkdown + remark-math
 * (configured with `singleDollarTextMath: false`):
 *   - `$x$` (currency-safe) and `\(x\)` → `$$x$$` inline math;
 *   - `\[x\]` → a `$$` display block; existing `$$` blocks pass through;
 *   - an unclosed `$$` display fence is escaped so it cannot swallow the
 *     rest of the message (unless `streaming`, where it may still close);
 *   - fenced code blocks and inline code spans are never touched;
 *   - currency / prose dollars stay literal text.
 */
export function normalizeChatMath(markdown: string, options: { streaming?: boolean } = {}): string {
  if (!markdown || (!markdown.includes("$") && !markdown.includes("\\(") && !markdown.includes("\\["))) {
    return markdown;
  }
  const lines = markdown.split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  const flushProse = () => {
    if (prose.length > 0) out.push(normalizeOutsideInlineCode(prose.join("\n")));
    prose = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushProse();
      const marker = fence[1];
      const block = [line];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        block.push(lines[j]);
        if (new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[j])) break;
      }
      out.push(block.join("\n"));
      i = j;
      continue;
    }
    if (MATH_FENCE_RE.test(line)) {
      let j = i + 1;
      while (j < lines.length && !MATH_FENCE_RE.test(lines[j])) j += 1;
      if (j < lines.length || options.streaming) {
        flushProse();
        out.push(lines.slice(i, Math.min(j + 1, lines.length)).join("\n"));
        i = j;
        continue;
      }
      // Unclosed display fence in a finished message: keep it literal.
      prose.push(line.replace("$$", "\\$\\$"));
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return out.join("\n");
}

/** remark-math options that pair with `normalizeChatMath`. */
export const CHAT_REMARK_MATH_OPTIONS = { singleDollarTextMath: false } as const;
