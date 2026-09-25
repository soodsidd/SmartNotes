import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeMathInHtml } from "@/server/vault/math-normalize";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import { readPage } from "@/server/vault/pages";

// ---------------------------------------------------------------------------
// normalizeMathInHtml — unit tests
// ---------------------------------------------------------------------------

describe("normalizeMathInHtml", () => {
  test("returns HTML unchanged when no dollar signs present", () => {
    const html = "<p>No math here.</p>";
    expect(normalizeMathInHtml(html)).toBe(html);
  });

  test("converts inline $...$ to inline-math span", () => {
    const result = normalizeMathInHtml("<p>The formula $E = mc^2$ is famous.</p>");
    expect(result).toContain('data-type="inline-math"');
    expect(result).toContain('data-latex="E = mc^2"');
    expect(result).not.toContain("$E");
  });

  test("converts block $$...$$ paragraph to block-math div", () => {
    const result = normalizeMathInHtml("<p>$$\\frac{a}{b}$$</p>");
    expect(result).toContain('data-type="block-math"');
    expect(result).toContain("data-latex");
    expect(result).not.toContain("<p>");
  });

  test("converts standalone $$...$$ outside paragraph to block-math div", () => {
    const result = normalizeMathInHtml("$$E = mc^2$$");
    expect(result).toContain('data-type="block-math"');
    expect(result).toContain('data-latex="E = mc^2"');
  });

  test("handles mixed inline and block math", () => {
    const html =
      "<p>Inline: $x^2$.</p><p>$$\\sum_{i=0}^n i$$</p><p>More $\\alpha$ text.</p>";
    const result = normalizeMathInHtml(html);
    expect(result.match(/data-type="inline-math"/g)?.length).toBe(2);
    expect(result.match(/data-type="block-math"/g)?.length).toBe(1);
  });

  test("does not process dollar signs inside <code> elements", () => {
    const html = "<p>Text and <code>$not_math$</code> here.</p>";
    const result = normalizeMathInHtml(html);
    expect(result).not.toContain("inline-math");
    expect(result).toContain("<code>$not_math$</code>");
  });

  test("does not process dollar signs inside <pre> elements", () => {
    const html = "<pre><code>$$x = 1$$</code></pre>";
    const result = normalizeMathInHtml(html);
    expect(result).not.toContain("block-math");
    expect(result).toContain("$$x = 1$$");
  });

  test("does not double-convert existing math nodes", () => {
    const html = '<span data-type="inline-math" data-latex="x^2"></span>';
    expect(normalizeMathInHtml(html)).toBe(html);
  });

  test("preserves surrounding HTML structure", () => {
    const result = normalizeMathInHtml("<h1>Title</h1><p>Value: $42$.</p>");
    expect(result).toContain("<h1>Title</h1>");
    expect(result).toContain('data-type="inline-math"');
    expect(result).toContain("Value:");
  });

  test("trims whitespace from extracted latex", () => {
    const result = normalizeMathInHtml("<p>$  x + y  $</p>");
    expect(result).toContain('data-latex="x + y"');
  });

  test("escapes double-quotes in latex attribute", () => {
    const result = normalizeMathInHtml('<p>$\\text{"hello"}$</p>');
    expect(result).toContain("&quot;");
    // The captured attribute value should not contain a raw " character
    const m = result.match(/data-latex="([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain('"');
  });

  test("handles multiline block math", () => {
    const html = "<p>$$\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n$$</p>";
    const result = normalizeMathInHtml(html);
    expect(result).toContain('data-type="block-math"');
    expect(result).toContain("begin{pmatrix}");
  });
});

// ---------------------------------------------------------------------------
// Round-trip: page_write normalizes and page body is readable after save
// ---------------------------------------------------------------------------

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const prev = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn-math-norm-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    const stub = `---\ntitle: Math Test\ncreated: 2026-06-01T00:00:00Z\nupdated: 2026-06-01T00:00:00Z\n---\n<p>stub</p>\n`;
    await fs.writeFile(path.join(vaultRoot, "Notebook/Section/math-test.html"), stub, "utf8");
    await run(vaultRoot);
  } finally {
    if (prev) process.env.SMART_NOTES_VAULT = prev;
    else delete process.env.SMART_NOTES_VAULT;
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

describe("page_write math normalization round-trip", () => {
  it("normalizes inline and block math before persisting", async () => {
    await withVaultFixture(async () => {
      const body = "<p>Inline $E = mc^2$ and block:</p><p>$$\\frac{a}{b}$$</p>";
      await executeVaultCommand({
        group: "page",
        action: "write",
        args: { path: "Notebook/Section/math-test.html", body },
      });

      const page = await readPage("Notebook/Section/math-test.html");
      expect(page.body).toContain('data-type="inline-math"');
      expect(page.body).toContain('data-latex="E = mc^2"');
      expect(page.body).toContain('data-type="block-math"');
      expect(page.body).not.toContain("$E");
    });
  });

  it("preserves HTML without dollar signs unchanged (no normalization overhead)", async () => {
    await withVaultFixture(async () => {
      const body = "<h1>Title</h1><p>No math here.</p>";
      await executeVaultCommand({
        group: "page",
        action: "write",
        args: { path: "Notebook/Section/math-test.html", body },
      });
      const page = await readPage("Notebook/Section/math-test.html");
      expect(page.body.trim()).toBe(body.trim());
    });
  });
});

describe("page_append math normalization", () => {
  it("normalizes inline math in appended text before persisting", async () => {
    await withVaultFixture(async () => {
      await executeVaultCommand({
        group: "page",
        action: "append",
        args: { path: "Notebook/Section/math-test.html", text: "The formula $E = mc^2$ is famous." },
      });
      const page = await readPage("Notebook/Section/math-test.html");
      expect(page.body).toContain('data-type="inline-math"');
      expect(page.body).toContain('data-latex="E = mc^2"');
      expect(page.body).not.toContain("$E");
    });
  });

  it("normalizes block math in appended text before persisting", async () => {
    await withVaultFixture(async () => {
      await executeVaultCommand({
        group: "page",
        action: "append",
        args: { path: "Notebook/Section/math-test.html", text: "$$\\frac{a}{b}$$" },
      });
      const page = await readPage("Notebook/Section/math-test.html");
      expect(page.body).toContain('data-type="block-math"');
    });
  });
});
