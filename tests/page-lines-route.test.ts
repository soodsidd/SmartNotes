/**
 * SN-297: page lines persist in page frontmatter (survive reload / other
 * devices) and never alter the saved HTML body.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, PATCH, POST, PUT } from "@/app/api/page/route";

const BODY = "<h1>Lines</h1><p>Body text stays byte-for-byte.</p>\n";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-lines-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "lines.html"),
      `---\ntitle: Lines\ncreated: 2026-10-12T18:00:00Z\nupdated: 2026-10-12T18:00:00Z\n---\n${BODY}`,
      "utf8"
    );
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "ink.html"),
      "---\ntitle: Ink\nnote_type: ink\ncreated: 2026-10-12T18:00:00Z\nupdated: 2026-10-12T18:00:00Z\n---\n",
      "utf8"
    );
    await run(vaultRoot);
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    delete (global as Record<string, unknown>)["_smartNotesIo"];
  }
}

function patchLines(pagePath: string, pageLines: unknown) {
  return PATCH(
    new Request("http://localhost/api/page", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pageLines", path: pagePath, pageLines }),
    })
  );
}

function bodyOf(source: string) {
  return source.slice(source.indexOf("\n---\n") + "\n---\n".length);
}

describe("page lines route", () => {
  it("stores lines in frontmatter without touching the HTML body", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const file = path.join(vaultRoot, "Notebook", "Section", "lines.html");
      const response = await patchLines("Notebook/Section/lines.html", {
        style: "rule-college-margin",
        color: "green",
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        page: { metadata: { page_lines: { style: "rule-college-margin", color: "green" } } },
      });

      const source = await fs.readFile(file, "utf8");
      expect(source).toMatch(/page_lines:\n\s+style: rule-college-margin\n\s+color: green/);
      expect(bodyOf(source)).toBe(BODY);

      // Reload (another device) reads the same setting.
      const reload = await GET(new Request("http://localhost/api/page?path=Notebook/Section/lines.html"));
      const { page } = (await reload.json()) as { page: { metadata: Record<string, unknown>; content: string } };
      expect(page.metadata.page_lines).toEqual({ style: "rule-college-margin", color: "green" });
      expect(page.content).not.toContain("page_lines");
      expect(page.content).not.toContain("rule-college-margin");
    });
  });

  it("survives a body autosave and clears back to no lines", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const file = path.join(vaultRoot, "Notebook", "Section", "lines.html");
      await patchLines("Notebook/Section/lines.html", { style: "grid-small", color: "blue" });

      const put = await PUT(
        new Request("http://localhost/api/page", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "Notebook/Section/lines.html", title: "Lines", content: "<p>Edited.</p>" }),
        })
      );
      expect(put.status).toBe(200);
      let source = await fs.readFile(file, "utf8");
      expect(source).toContain("style: grid-small");
      expect(bodyOf(source)).toBe("<p>Edited.</p>");

      const cleared = await patchLines("Notebook/Section/lines.html", { style: "none", color: "light-blue" });
      expect(cleared.status).toBe(200);
      source = await fs.readFile(file, "utf8");
      expect(source).not.toContain("page_lines");
      expect(bodyOf(source)).toBe("<p>Edited.</p>");
    });
  });

  it("sanitizes unknown values and rejects non-text pages", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const junk = await patchLines("Notebook/Section/lines.html", { style: "<script>", color: "rgb(0,0,0)" });
      expect(junk.status).toBe(200);
      const source = await fs.readFile(path.join(vaultRoot, "Notebook", "Section", "lines.html"), "utf8");
      expect(source).not.toContain("page_lines");
      expect(source).not.toContain("script");

      const missing = await patchLines("Notebook/Section/lines.html", "rule-wide");
      expect(missing.status).toBe(400);

      const ink = await patchLines("Notebook/Section/ink.html", { style: "rule-wide", color: "blue" });
      expect(ink.status).toBe(400);
    });
  });

  it("stamps the browser default on new text pages only", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const created = await POST(
        new Request("http://localhost/api/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionPath: "Notebook/Section",
            title: "Fresh",
            pageLines: { style: "rule-wide", color: "lavender" },
          }),
        })
      );
      expect(created.status).toBe(201);
      const { page } = (await created.json()) as { page: { path: string; content: string } };
      const source = await fs.readFile(path.join(vaultRoot, ...page.path.split("/")), "utf8");
      expect(source).toContain("style: rule-wide");
      expect(source).toContain("color: lavender");
      expect(page.content).toBe("");

      const inkCreated = await POST(
        new Request("http://localhost/api/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionPath: "Notebook/Section",
            title: "Sketch",
            noteType: "ink",
            pageLines: { style: "rule-wide", color: "lavender" },
          }),
        })
      );
      expect(inkCreated.status).toBe(201);
      const inkPage = ((await inkCreated.json()) as { page: { path: string } }).page;
      const inkSource = await fs.readFile(path.join(vaultRoot, ...inkPage.path.split("/")), "utf8");
      expect(inkSource).not.toContain("page_lines");
    });
  });
});
