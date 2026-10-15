/**
 * SN-310: companion comments on design pages reuse the page comments contract
 * (PUT/GET /api/page/comments → page `comments`), so page_get sees them the
 * same way as text-page comments. Linked designs keep comments in the
 * .design-link.json sidecar and never frontmatter-wrap the ordinary HTML.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, PUT } from "@/app/api/page/comments/route";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import {
  invalidateVaultTreeCacheForTesting,
  linkDesignPage,
  readPage,
  readPageComments,
  savePage,
  type StoredComment,
} from "@/server/vault/pages";
import { registerPortableNotebook } from "@/server/vault/notebook-registry";
import { resetRenderTokensForTesting } from "@/server/vault/page-render-token";

const DESIGN_BODY = '<section class="hero"><h1>Jane Doe</h1><p>Price: $9.99 each</p></section>';

const anchored: StoredComment = {
  id: "cmt_design_1",
  quote: "Jane Doe",
  text: "Make the name larger",
  createdAt: "2026-10-14T10:00:00.000Z",
  resolvedAt: null,
  target: { kind: "design-element", path: [0, 0], tag: "h1" },
};
const pageLevel: StoredComment = {
  id: "cmt_design_2",
  quote: "",
  text: "Tighten to one page",
  createdAt: "2026-10-14T10:01:00.000Z",
  resolvedAt: null,
};

async function withFixture(
  run: (ctx: { vaultRoot: string; targetRepo: string; stateDir: string }) => Promise<void>
) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousStateDir = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn310-vault-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn310-state-"));
  const targetRepo = await fs.mkdtemp(path.join(os.tmpdir(), "sn310-repo-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  invalidateVaultTreeCacheForTesting();
  resetRenderTokensForTesting();
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await run({ vaultRoot, targetRepo, stateDir });
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    if (previousStateDir) process.env.SMART_NOTES_STATE_DIR = previousStateDir;
    else delete process.env.SMART_NOTES_STATE_DIR;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(targetRepo, { recursive: true, force: true });
    invalidateVaultTreeCacheForTesting();
    resetRenderTokensForTesting();
  }
}

async function putComments(pagePath: string, comments: StoredComment[], pageBody?: string) {
  const response = await PUT(
    new Request("http://localhost/api/page/comments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pagePath, comments, pageBody }),
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { comments: StoredComment[] };
}

async function getComments(pagePath: string) {
  const response = await GET(
    new Request(`http://localhost/api/page/comments?path=${encodeURIComponent(pagePath)}`)
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { comments: StoredComment[] }).comments;
}

async function pageGet(pagePath: string) {
  const result = await executeVaultCommand({ group: "page", action: "get", args: { path: pagePath } });
  return result.data as { comments: StoredComment[] };
}

describe("design page companion comments (SN-310)", () => {
  it("persists anchored + page-level comments on a vault design page and exposes them to page_get", async () => {
    await withFixture(async ({ vaultRoot }) => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: "Notebook/Section", title: "Resume", noteType: "design", content: DESIGN_BODY },
      });
      const pagePath = (created.data as { page: { path: string } }).page.path;

      await putComments(pagePath, [anchored, pageLevel], DESIGN_BODY);

      // Survives a fresh read (reload) through both the API and the companion tool.
      expect(await getComments(pagePath)).toEqual([anchored, pageLevel]);
      expect((await pageGet(pagePath)).comments).toEqual([anchored, pageLevel]);

      const page = await readPage(pagePath);
      expect(page.metadata.note_type).toBe("design");
      // Raw design body is untouched by the comment save (no Tiptap/math normalization).
      expect(page.body.trim()).toBe(DESIGN_BODY);
      const raw = await fs.readFile(path.join(vaultRoot, pagePath), "utf8");
      expect(raw).toContain("design-element");
    });
  });

  it("resolve / edit / delete round-trip through the same API", async () => {
    await withFixture(async () => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: "Notebook/Section", title: "Portfolio", noteType: "design", content: DESIGN_BODY },
      });
      const pagePath = (created.data as { page: { path: string } }).page.path;
      await putComments(pagePath, [anchored, pageLevel]);

      const resolvedAt = "2026-10-14T11:00:00.000Z";
      await putComments(pagePath, [{ ...anchored, text: "Larger and bolder", resolvedAt }]);
      expect(await readPageComments(pagePath)).toEqual([{ ...anchored, text: "Larger and bolder", resolvedAt }]);

      await putComments(pagePath, []);
      expect(await readPageComments(pagePath)).toEqual([]);
      expect((await readPage(pagePath)).metadata.comments).toBeUndefined();
    });
  });

  it("stores linked-design comments in the .design-link.json sidecar without touching the HTML", async () => {
    await withFixture(async ({ targetRepo, stateDir }) => {
      registerPortableNotebook(targetRepo, "Career", stateDir);
      const sectionAbs = path.join(targetRepo, "Resumes");
      await fs.mkdir(sectionAbs, { recursive: true });
      const htmlAbs = path.join(sectionAbs, "resume.html");
      const html = `<!doctype html><html><head><title>Resume</title></head><body>${DESIGN_BODY}</body></html>`;
      await fs.writeFile(htmlAbs, html, "utf8");
      const linked = await linkDesignPage({ sourcePath: htmlAbs });

      // pageBody is ignored for linked designs; the HTML is ground truth.
      await putComments(linked.path, [anchored, pageLevel], "<p>stale editor body</p>");

      expect(await fs.readFile(htmlAbs, "utf8")).toBe(html);
      const sidecar = JSON.parse(await fs.readFile(htmlAbs.replace(/\.html$/, ".design-link.json"), "utf8"));
      expect(sidecar.comments).toEqual([anchored, pageLevel]);
      expect(sidecar.linked).toBe(true);

      expect(await getComments(linked.path)).toEqual([anchored, pageLevel]);
      expect((await pageGet(linked.path)).comments).toEqual([anchored, pageLevel]);

      // A later body save (autosave) keeps the sidecar comments.
      await savePage({ path: linked.path, title: "Resume", body: html.replace("Jane", "Janet") });
      expect(await readPageComments(linked.path)).toEqual([anchored, pageLevel]);

      // Clearing removes the key so the sidecar stays clean.
      await putComments(linked.path, []);
      const cleared = JSON.parse(await fs.readFile(htmlAbs.replace(/\.html$/, ".design-link.json"), "utf8"));
      expect(cleared).not.toHaveProperty("comments");
      expect((await fs.readFile(htmlAbs, "utf8")).startsWith("---")).toBe(false);
    });
  });

  it("serializes a comment save with a concurrent linked-design body save", async () => {
    await withFixture(async ({ targetRepo, stateDir }) => {
      registerPortableNotebook(targetRepo, "Career", stateDir);
      const htmlAbs = path.join(targetRepo, "resume.html");
      await fs.writeFile(htmlAbs, `<html><body>${DESIGN_BODY}</body></html>`, "utf8");
      const linked = await linkDesignPage({ sourcePath: htmlAbs });

      await Promise.all([
        savePage({ path: linked.path, title: "Resume v2", body: `<html><body>v2</body></html>` }),
        putComments(linked.path, [anchored]),
      ]);

      const sidecar = JSON.parse(await fs.readFile(htmlAbs.replace(/\.html$/, ".design-link.json"), "utf8"));
      expect(sidecar.title).toBe("Resume v2");
      expect(sidecar.comments).toEqual([anchored]);
    });
  });
});
