/**
 * Server-side normalization of LaTeX dollar-sign syntax to Tiptap math nodes.
 *
 * Agents write $...$ (inline) and $$...$$ (block) in HTML bodies.
 * This module converts those patterns to the HTML attributes the
 * Tiptap Mathematics extension expects on load:
 *   inline → <span data-type="inline-math" data-latex="..."></span>
 *   block  → <div  data-type="block-math"  data-latex="..."></div>
 *
 * Content inside <code> and <pre> elements is never processed.
 * Inline `$` uses the shared currency-safe rule in `@/lib/math-delimiters`
 * (SN-274 / SN-369) so money amounts stay literal.
 */

import { replaceInlineDollarMath } from "@/lib/math-delimiters";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Elements whose text content must not be treated as math.
const SKIP_RE =
  /(<(?:code|pre)[^>]*>[\s\S]*?<\/(?:code|pre)>|<(?:span|div)[^>]*data-type="(?:inline-math|block-math)"[^>]*>[\s\S]*?<\/(?:span|div)>)/gi;

function replaceMath(fragment: string): string {
  let out = fragment;

  // Block math: full <p>$$...$$</p> → block-math div (avoids invalid <div> inside <p>)
  out = out.replace(/<p([^>]*)>\s*\$\$([^<]*?)\$\$\s*<\/p>/g, (_, _attrs, latex) =>
    `<div data-type="block-math" data-latex="${escapeAttr(latex.trim())}"></div>`
  );

  // Block math: remaining $$...$$ (never spans an HTML tag)
  out = out.replace(/\$\$([^<$]+?)\$\$/g, (_, latex) =>
    `<div data-type="block-math" data-latex="${escapeAttr(latex.trim())}"></div>`
  );

  // Inline math (SN-274): shared currency-safe rule, applied per text run so a
  // span never crosses an HTML tag ("<strong>$5</strong> … <strong>$175" stays text).
  return out
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith("<")
        ? part
        : replaceInlineDollarMath(part, (latex) =>
            `<span data-type="inline-math" data-latex="${escapeAttr(latex)}"></span>`
          )
    )
    .join("");
}

/**
 * Normalize dollar-sign LaTeX in an HTML body to Tiptap math node markup.
 * Returns the input unchanged when no dollar signs are present.
 */
export function normalizeMathInHtml(html: string): string {
  if (!html.includes("$")) return html;

  const segments: Array<{ text: string; skip: boolean }> = [];
  let last = 0;
  SKIP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SKIP_RE.exec(html)) !== null) {
    if (m.index > last) segments.push({ text: html.slice(last, m.index), skip: false });
    segments.push({ text: m[0], skip: true });
    last = m.index + m[0].length;
  }
  if (last < html.length) segments.push({ text: html.slice(last), skip: false });

  return segments.map((s) => (s.skip ? s.text : replaceMath(s.text))).join("");
}
