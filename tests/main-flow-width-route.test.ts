/**
 * SN-318: the main flow column width persists per page in frontmatter
 * (parallel to page_lines), restores on open, and never touches the body.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, PATCH, PUT } from "@/app/api/page/route";

const BODY = "<h1>Width</h1><p>Body text stays byte-for-byte.</p>\n";
const PAGE = "Notebook/Section/width.html";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-width-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "width.html"),
      `---\ntitle: Width\ncreated: 2026-10-15T18:00:00Z\nupdated: 2026-10-15T18:00:00Z\npage_lines:\n  style: rule-wide\n  color: blue\n---\n${BODY}`,
      "utf8"
    );
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "ink.html"),
      "---\ntitle: Ink\nnote_type: ink\ncreated: 2026-10-15T18:00:00Z\nupdated: 2026-10-15T18:00:00Z\n---\n",
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

function patchWidth(pagePath: string, mainFlowWidth: unknown) {
  return PATCH(
    new Request("http://localhost/api/page", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mainFlowWidth", path: pagePath, mainFlowWidth }),
    })
  );
}

async function readMetadata(pagePath: string) {
  const response = await GET(new Request(`http://localhost/api/page?path=${pagePath}`));
  return ((await response.json()) as { page: { metadata: Record<string, unknown> } }).page.metadata;
}

function bodyOf(source: string) {
  return source.slice(source.indexOf("\n---\n") + "\n---\n".length);
}

describe("main flow width route", () => {
  it("stores the width in frontmatter, restores it on open, and keeps the body and page lines", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const file = path.join(vaultRoot, "Notebook", "Section", "width.html");
      const response = await patchWidth(PAGE, 904);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ page: { metadata: { main_flow_width: 904 } } });

      const source = await fs.readFile(file, "utf8");
      expect(source).toMatch(/^main_flow_width: 904$/m);
      expect(source).toContain("style: rule-wide");
      expect(bodyOf(source)).toBe(BODY);
      expect(await readMetadata(PAGE)).toMatchObject({ main_flow_width: 904 });
    });
  });

  it("survives a body autosave, clamps, and clears back to the default", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const file = path.join(vaultRoot, "Notebook", "Section", "width.html");
      await patchWidth(PAGE, 20);
      expect(await readMetadata(PAGE)).toMatchObject({ main_flow_width: 360 });

      const put = await PUT(
        new Request("http://localhost/api/page", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: PAGE, title: "Width", content: "<p>Edited.</p>" }),
        })
      );
      expect(put.status).toBe(200);
      let source = await fs.readFile(file, "utf8");
      expect(source).toMatch(/^main_flow_width: 360$/m);
      expect(bodyOf(source)).toBe("<p>Edited.</p>");

      const reset = await patchWidth(PAGE, 672);
      expect(reset.status).toBe(200);
      source = await fs.readFile(file, "utf8");
      expect(source).not.toContain("main_flow_width");
      expect(bodyOf(source)).toBe("<p>Edited.</p>");
    });
  });

  it("rejects non-numeric widths and non-text pages", async () => {
    await withVaultFixture(async () => {
      expect((await patchWidth(PAGE, "wide")).status).toBe(400);
      expect((await patchWidth(PAGE, null)).status).toBe(400);
      expect((await patchWidth("Notebook/Section/ink.html", 900)).status).toBe(400);
    });
  });
});
