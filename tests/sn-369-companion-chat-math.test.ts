/**
 * SN-369 (absorbs SN-274): currency-safe equation rendering in the Companion
 * sidebar and on companion page writes — one shared rule for both paths.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { findInlineDollarMath, normalizeChatMath } from "@/lib/math-delimiters";
import { normalizeMathInHtml } from "@/server/vault/math-normalize";

/** Render through the real react-markdown + remark-math + rehype-katex stack. */
function renderChat(inputs: string[]): string[] {
  const result = spawnSync(
    process.execPath,
    ["--no-warnings", path.join(__dirname, "fixtures", "render-chat-markdown.mjs")],
    { input: JSON.stringify(inputs), encoding: "utf8", cwd: path.join(__dirname, "..") }
  );
  if (result.status !== 0) throw new Error(result.stderr || "render helper failed");
  return JSON.parse(result.stdout) as string[];
}

const katexCount = (html: string) => (html.match(/class="katex"/g) ?? []).length;
const displayCount = (html: string) => (html.match(/class="katex-display"/g) ?? []).length;

describe("findInlineDollarMath (shared rule)", () => {
  test.each([
    ["Hims would bill $5 every 150 days, then Hims charged $175 twice.", 0],
    ["I paid $564.08 for the tow, although the $80 storage charge was waived.", 0],
    ["The $5/150-day plan and the $175 charges", 0],
    ["Prices range $5-$10 per item", 0],
    ["US$5 and US$10", 0],
    ["It costs 5$ or 10$ in total", 0],
    ["Escaped \\$x\\$ stays literal", 0],
    ["unclosed $x^2 here", 0],
    ["Energy $E = mc^2$ holds", 1],
    ["Both $\\alpha + \\beta$ and $x_1$", 2],
    ["Paid $5 and computed $x^2$", 1],
    ["padded TeX $ \\frac{a}{b} $ is accepted", 1],
    ["padded plain $ 5 and 6 $ is not", 0],
  ])("%s → %i span(s)", (text, count) => {
    expect(findInlineDollarMath(text)).toHaveLength(count);
  });

  test("returns trimmed latex", () => {
    expect(findInlineDollarMath("a $x^2$ b")[0].latex).toBe("x^2");
  });
});

describe("normalizeChatMath", () => {
  test("rewrites only intentional math to explicit $$ text math", () => {
    expect(normalizeChatMath("Paid $5 and $x^2$.")).toBe("Paid $5 and $$x^2$$.");
  });

  test("converts \\( \\) inline and \\[ \\] display delimiters", () => {
    expect(normalizeChatMath("see \\(a+b\\) now")).toBe("see $$a+b$$ now");
    expect(normalizeChatMath("before\n\\[\n\\int_0^1 x\\,dx\n\\]\nafter")).toContain("$$\n\\int_0^1 x\\,dx\n$$");
  });

  test("never touches code spans or fenced code blocks", () => {
    const text = "Use `$x$` literally.\n\n```bash\necho $HOME $PATH\nprice=$5$\n```\nThen $y$.";
    const out = normalizeChatMath(text);
    expect(out).toContain("`$x$`");
    expect(out).toContain("echo $HOME $PATH\nprice=$5$");
    expect(out).toContain("Then $$y$$.");
  });

  test("escapes an unclosed $$ fence in a finished message but keeps it while streaming", () => {
    expect(normalizeChatMath("Here:\n$$\nx^2\nand more text")).toContain("\\$\\$");
    expect(normalizeChatMath("Here:\n$$\nx^2", { streaming: true })).toBe("Here:\n$$\nx^2");
  });

  test("leaves closed $$ display blocks untouched", () => {
    const text = "Block:\n$$\n\\sum_{i=1}^n i\n$$\nDone";
    expect(normalizeChatMath(text)).toBe(text);
  });
});

describe("Companion chat render (real remark-math + rehype-katex pipeline)", () => {
  const [
    towEmail,
    himsChat,
    inline,
    display,
    texDelims,
    code,
    rawLatex,
    unclosed,
    mixed,
  ] = renderChat([
    "I paid $564.08 for the tow, although the $80 storage charge was waived.",
    "Hims would bill **$5 every 150 days**, then charged **$175** and $175 again.",
    "The identity $e^{i\\pi} + 1 = 0$ is famous.",
    "Quadratic formula:\n\n$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$",
    "Inline \\(a^2+b^2=c^2\\) and display:\n\\[\n\\int_0^1 x\\,dx\n\\]",
    "Shell: `echo $HOME $USER` and\n\n```\ncost=$5$\n```",
    "Bare \\frac{a}{b} without delimiters",
    "An unclosed $x^2 and $$ y",
    "Budget $1,200 vs. growth rate $r = 0.05$ per year, total $1,260.",
  ]);

  test("SN-274 currency cases stay literal text (no KaTeX)", () => {
    expect(katexCount(towEmail)).toBe(0);
    expect(towEmail).toContain("$564.08");
    expect(towEmail).toContain("$80");
    expect(katexCount(himsChat)).toBe(0);
    expect(himsChat).toContain("<strong>$5 every 150 days</strong>");
  });

  test("intentional inline and block equations render via KaTeX", () => {
    expect(katexCount(inline)).toBe(1);
    expect(inline).not.toContain("$e^");
    expect(displayCount(display)).toBe(1);
  });

  test("\\( \\) and \\[ \\] agent variants render", () => {
    expect(katexCount(texDelims)).toBe(2);
    expect(displayCount(texDelims)).toBe(1);
  });

  test("dollars inside code stay untouched", () => {
    expect(katexCount(code)).toBe(0);
    expect(code).toContain("echo $HOME $USER");
    expect(code).toContain("cost=$5$");
  });

  test("raw LaTeX without delimiters and unclosed $ stay plain text", () => {
    expect(katexCount(rawLatex)).toBe(0);
    expect(rawLatex).toContain("\\frac{a}{b}");
    expect(katexCount(unclosed)).toBe(0);
    expect(unclosed).toContain("$x^2");
  });

  test("currency and math in one message: only the equation renders", () => {
    expect(katexCount(mixed)).toBe(1);
    expect(mixed).toContain("$1,200");
    expect(mixed).toContain("$1,260");
  });
});

describe("normalizeMathInHtml (SN-274 page-write path)", () => {
  const himsDocs =
    "<p>Hims would bill <strong>$5 every 150 days</strong> for the plan. Then Hims charged <strong>$175</strong> without notice.</p>" +
    "<p>The $5/150-day terms and $175 charges were never disclosed.</p>";

  test("Hims docs fixture survives unchanged", () => {
    expect(normalizeMathInHtml(himsDocs)).toBe(himsDocs);
  });

  test("re-normalizing a page with several dollar amounts is idempotent", () => {
    const once = normalizeMathInHtml(himsDocs + "<p>Rate $r^2$.</p>");
    expect(normalizeMathInHtml(once)).toBe(once);
    expect(once.match(/data-type="inline-math"/g)).toHaveLength(1);
  });

  test("math never spans HTML tags", () => {
    const html = "<p>a $x <em>y</em> z$ b</p>";
    expect(normalizeMathInHtml(html)).toBe(html);
  });

  test("genuine inline and $$ block math still convert", () => {
    const out = normalizeMathInHtml("<p>$x^2$ and $\\alpha + \\beta$</p><p>$$\\frac{a}{b}$$</p>");
    expect(out.match(/data-type="inline-math"/g)).toHaveLength(2);
    expect(out).toContain('data-type="block-math" data-latex="\\frac{a}{b}"');
  });
});
