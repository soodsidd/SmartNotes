import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, POST } from "@/app/api/agent/vault/route";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import {
  executeVaultTool,
  formatVaultToolsPrompt,
  getVaultToolDefinition,
} from "@/server/vault/agent-tools";
import { createPage, invalidateVaultTreeCacheForTesting, readLogDocument, readPage } from "@/server/vault/pages";
import { listPageVersions } from "@/server/vault/versions";

const SEED_PATH = "Notebook/Section/seed.html";
let mockPdfPages = new Map<number, string>();
let mockPdfTotalPages = 1;

jest.mock("pdf-parse", () => ({
  PDFParse: class {
    async getText(options?: { partial?: number[]; first?: number; last?: number }) {
      const page = options?.partial?.[0] ?? options?.first ?? 1;
      const text = mockPdfPages.get(page) ?? "";
      return {
        text,
        total: mockPdfTotalPages,
        getPageText: (requestedPage: number) => mockPdfPages.get(requestedPage) ?? "",
      };
    }
    async getInfo() {
      return { total: mockPdfTotalPages };
    }
    async destroy() {}
  },
}));

const SEED_CONTENT = `---
title: Seed
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
tags:
  - optics
comments:
  - id: cmt_seed
    quote: seed page body
    text: Please clarify this paragraph.
    createdAt: 2026-06-01T22:00:00Z
    resolvedAt: null
---
<p>This is the seed page body for testing agent commands.</p>
`;

async function withVaultFixture(run: () => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousStateDir = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-agent-cmd-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-state-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  // Isolate the notebook registry so portable notebooks from the real app don't
  // bleed into tests (SN-84: pre-existing test isolation bug).
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  // Clear the module-level vault tree cache so stale data from a previous
  // fixture (different vault root) doesn't leak into this run.
  invalidateVaultTreeCacheForTesting();

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, SEED_PATH), SEED_CONTENT, "utf8");
    await run();
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    if (previousStateDir) {
      process.env.SMART_NOTES_STATE_DIR = previousStateDir;
    } else {
      delete process.env.SMART_NOTES_STATE_DIR;
    }
    mockPdfPages = new Map();
    mockPdfTotalPages = 1;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

describe("vault tool catalog prompt for log authoring (SN-181)", () => {
  it("describes validated form metadata on log_form_get and log_form_put", () => {
    expect(getVaultToolDefinition("log_form_get")?.description).toContain("historySuggestion");
    expect(getVaultToolDefinition("log_form_get")?.description).toContain("named views");
    expect(getVaultToolDefinition("log_form_get")?.description).toContain("rowCount without rows");

    expect(getVaultToolDefinition("log_form_put")?.description).toContain("open-history");
    expect(getVaultToolDefinition("log_form_put")?.description).toContain("preserves existing rows by field id");
    expect(getVaultToolDefinition("log_form_put")?.parameters.form.description).toContain("historySuggestion?");
    expect(getVaultToolDefinition("log_form_put")?.parameters.form.description).toContain("views?");
    expect(getVaultToolDefinition("log_form_put")?.parameters.form.description).toContain("actions?");
  });

  it("teaches History, suggestions, named links, and allowlisted actions without weakening query limits", () => {
    const prompt = formatVaultToolsPrompt();

    expect(prompt).toContain("History is the human-readable reading surface");
    expect(prompt).toContain("Table is the correction surface");
    expect(prompt).toContain("form.views");
    expect(prompt).toContain("stable live, JSON, and CSV links");
    expect(prompt).toContain("form.historySuggestion");
    expect(prompt).toContain("matchFields");
    expect(prompt).toContain("copyFields");
    expect(prompt).toContain("exact top-level schema property ids");
    expect(prompt).toContain("Suggestions never auto-fill the draft");
    expect(prompt).toContain("Attachments, ids, timestamps, and date fields are opt-in");
    expect(prompt).toContain('{ type: "open-history", label, view }');
    expect(prompt).toContain("validated form.views id");
    expect(prompt).toContain("Arbitrary URLs, HTML, CSS, callbacks");
    expect(prompt).toContain('"project"');
    expect(prompt).toContain('"status"');
    expect(prompt).toContain('"notes"');
    expect(prompt).toContain("never edit .form.json or .log.json sidecars directly");
    expect(prompt).toContain("never an unbounded row dump");
    expect(prompt).toContain("one path plus either a bounded query object or saved view id");
    expect(prompt).toContain("SQL and executable presentation code are not accepted");
  });

  it("requires the bounded vault PDF toolkit for PDF page questions", () => {
    const prompt = formatVaultToolsPrompt();
    expect(prompt).toContain("Vault PDF rule (mandatory)");
    expect(prompt).toContain("pdf_read_page");
    expect(prompt).toContain("pdf_read_pages");
    expect(prompt).toContain("pdf_page_count");
    expect(prompt).toContain("Never use bash/shell, direct disk reads, pdftoppm, Computer");
    expect(prompt).toContain("Never ask the owner to paste page text unless");
  });
});

describe("vault agent commands — page", () => {
  it("creates, gets, drafts, writes, patches, and searches pages", async () => {
    await withVaultFixture(async () => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: "Notebook/Section", title: "Agent Page", content: "# Agent\n\nBody." },
      });
      expect(created.treeChanged).toBe(true);
      const createdPath = (created.data as { page: { path: string } }).page.path;

      const got = await executeVaultCommand({
        group: "page",
        action: "get",
        args: { path: createdPath },
      });
      expect((got.data as { page: { body: string } }).page.body).toContain("Body.");

      const draft = await executeVaultCommand({
        group: "page",
        action: "draft",
        args: { path: createdPath },
      });
      expect((draft.data as { annotatedBody: string }).annotatedBody).toContain("| # Agent");

      await executeVaultCommand({
        group: "page",
        action: "write",
        args: { path: createdPath, body: "# Agent\n\nRewritten body." },
      });
      const rewritten = await readPage(createdPath);
      expect(rewritten.body).toContain("Rewritten body.");

      await executeVaultCommand({
        group: "page",
        action: "append",
        args: { path: createdPath, text: "Appended paragraph." },
      });
      const appended = await readPage(createdPath);
      expect(appended.body).toContain("Appended paragraph.");

      await executeVaultCommand({
        group: "page",
        action: "prepend",
        args: { path: createdPath, text: "Intro paragraph." },
      });
      const prepended = await readPage(createdPath);
      expect(prepended.body.startsWith("<p>Intro paragraph.</p>")).toBe(true);

      await executeVaultCommand({
        group: "page",
        action: "patch",
        args: { path: createdPath, search: "Appended paragraph.", replacement: "Patched paragraph." },
      });
      const patched = await readPage(createdPath);
      expect(patched.body).toContain("Patched paragraph.");

      const search = await executeVaultCommand({
        group: "page",
        action: "search",
        args: { query: "Patched" },
      });
      expect((search.data as { matches: Array<{ path: string }> }).matches.length).toBeGreaterThan(0);

      const excerpt = await executeVaultCommand({
        group: "page",
        action: "excerpt",
        args: { path: SEED_PATH, maxChars: 40 },
      });
      expect((excerpt.data as { excerpt: string }).excerpt.length).toBeLessThanOrEqual(40);

      const renamed = await executeVaultCommand({
        group: "page",
        action: "rename",
        args: { path: createdPath, title: "Renamed Agent Page" },
      });
      const renamedPath = (renamed.data as { page: { path: string } }).page.path;
      expect(renamedPath).toContain("renamed-agent-page");

      const moved = await executeVaultCommand({
        group: "page",
        action: "move",
        args: { path: renamedPath, sectionPath: "Notebook/Section" },
      });
      expect((moved.data as { page: { path: string } }).page.path).toBe(renamedPath);

      await executeVaultCommand({ group: "page", action: "delete", args: { path: renamedPath } });
      await expect(readPage(renamedPath)).rejects.toThrow("Page not found");
    });
  });

  it("manages tags and frontmatter", async () => {
    await withVaultFixture(async () => {
      await executeVaultCommand({
        group: "page",
        action: "tag_add",
        args: { path: SEED_PATH, tag: "agent" },
      });
      await executeVaultCommand({
        group: "page",
        action: "tag_remove",
        args: { path: SEED_PATH, tag: "optics" },
      });

      const fmGet = await executeVaultCommand({
        group: "page",
        action: "frontmatter_get",
        args: { path: SEED_PATH, key: "title" },
      });
      expect((fmGet.data as { value: string }).value).toBe("Seed");

      await executeVaultCommand({
        group: "page",
        action: "frontmatter_set",
        args: { path: SEED_PATH, key: "stage", value: "beta" },
      });
      const page = await readPage(SEED_PATH);
      expect(page.metadata.stage).toBe("beta");
      expect(page.metadata.tags).toEqual(["agent"]);
    });
  });

  it("lists pages globally and by section", async () => {
    await withVaultFixture(async () => {
      const all = await executeVaultCommand({ group: "page", action: "list", args: {} });
      expect((all.data as { notebooks: unknown[] }).notebooks.length).toBe(1);

      const section = await executeVaultCommand({
        group: "page",
        action: "list",
        args: { sectionPath: "Notebook/Section" },
      });
      expect((section.data as { pages: unknown[] }).pages.length).toBe(1);
    });
  });
});

describe("vault agent commands — log forms", () => {
  it("gets and replaces a log form while preserving rows, and places image bytes in page assets", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "Workout", noteType: "log" });
      const before = await readLogDocument(page.path);
      await executeVaultCommand({ group: "log", action: "get", args: { path: page.path } });
      const put = await executeVaultTool("log_form_put", {
        path: page.path,
        form: {
          version: 1,
          schema: { type: "object", properties: { poses: { type: "array", items: { type: "string", format: "image" } } } },
          uischema: { type: "VerticalLayout", elements: [{ type: "Control", scope: "#/properties/poses" }] },
        },
      });
      expect(put.ok).toBe(true);
      const asset = await executeVaultTool("log_form_asset_put", {
        path: page.path,
        fileName: "pose.png",
        dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      });
      expect(asset.ok).toBe(true);
      if (!asset.ok) throw new Error(asset.error);
      expect((asset.result.data as { asset: { url: string } }).asset.url).toContain("/workout.assets/pose.png");
      const after = await readLogDocument(page.path);
      expect(after.rows).toEqual(before.rows);
      expect(after.schema.fields[0].type).toBe("image-sequence");
    });
  });

  it("round-trips saved views, never dumps rows from form tools, and queries only through the bounded tool", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "Analytics", noteType: "log" });
      const put = await executeVaultTool("log_form_put", {
        path: page.path,
        form: {
          version: 1,
          schema: { type: "object", properties: { amount: { type: "number", title: "Amount" } } },
          uischema: { type: "VerticalLayout", elements: [] },
          views: [{
            id: "totals",
            name: "Totals",
            columns: [{ field: "amount" }],
            summaries: [{ operator: "sum", field: "amount" }],
          }],
        },
      });
      expect(put.ok).toBe(true);
      if (!put.ok) throw new Error(put.error);
      expect(put.result.data).toMatchObject({ rowCount: 0, form: { views: [{ id: "totals" }] } });
      expect(put.result.data).not.toHaveProperty("rows");

      const get = await executeVaultTool("log_form_get", { path: page.path });
      expect(get.ok).toBe(true);
      if (!get.ok) throw new Error(get.error);
      expect(get.result.data).not.toHaveProperty("rows");

      const query = await executeVaultTool("log_query", { path: page.path, view: "totals" });
      expect(query.ok).toBe(true);
      if (!query.ok) throw new Error(query.error);
      expect(query.result.data).toMatchObject({
        returnedCount: 0,
        aggregates: { sum_amount: null },
        liveUrl: expect.stringContaining("&view=totals"),
      });
      const ambiguous = await executeVaultTool("log_query", {
        path: page.path,
        view: "totals",
        query: { limit: 1 },
      });
      expect(ambiguous).toMatchObject({ ok: false, code: "INVALID_LOG_QUERY", status: 400 });
    });
  });
});

describe("vault agent commands — notebook and section", () => {
  it("creates, lists, renames notebooks and sections", async () => {
    await withVaultFixture(async () => {
      const notebook = await executeVaultCommand({
        group: "notebook",
        action: "create",
        args: { name: "Research" },
      });
      expect((notebook.data as { notebook: { path: string } }).notebook.path).toBe("Research");

      const section = await executeVaultCommand({
        group: "section",
        action: "create",
        args: { notebookPath: "Research", name: "Notes" },
      });
      expect((section.data as { section: { path: string } }).section.path).toBe("Research/Notes");

      const notebooks = await executeVaultCommand({ group: "notebook", action: "list", args: {} });
      expect((notebooks.data as { notebooks: Array<{ path: string }> }).notebooks.map((n) => n.path)).toContain(
        "Research"
      );

      const sections = await executeVaultCommand({
        group: "section",
        action: "list",
        args: { notebookPath: "Research" },
      });
      expect((sections.data as { sections: Array<{ path: string }> }).sections.map((s) => s.path)).toContain(
        "Research/Notes"
      );

      await executeVaultCommand({
        group: "section",
        action: "rename",
        args: { path: "Research/Notes", name: "Primary" },
      });
      await executeVaultCommand({
        group: "notebook",
        action: "rename",
        args: { path: "Research", name: "Archive" },
      });
    });
  });

  it("requires force to delete non-empty notebook or section", async () => {
    await withVaultFixture(async () => {
      await expect(
        executeVaultCommand({ group: "section", action: "delete", args: { path: "Notebook/Section", force: false } })
      ).rejects.toThrow("force");

      await expect(
        executeVaultCommand({ group: "notebook", action: "delete", args: { path: "Notebook", force: false } })
      ).rejects.toThrow("force");

      await executeVaultCommand({
        group: "section",
        action: "delete",
        args: { path: "Notebook/Section", force: true },
      });
      await executeVaultCommand({
        group: "notebook",
        action: "delete",
        args: { path: "Notebook", force: true },
      });
    });
  });

  it("requires force to delete a notebook that only has root pages", async () => {
    await withVaultFixture(async () => {
      await fs.rm(path.join(process.env.SMART_NOTES_VAULT ?? "", "Notebook", "Section"), {
        recursive: true,
        force: true,
      });
      await createPage({ notebookPath: "Notebook", title: "Root Agent Page" });

      await expect(
        executeVaultCommand({ group: "notebook", action: "delete", args: { path: "Notebook", force: false } })
      ).rejects.toThrow("force");

      await executeVaultCommand({
        group: "notebook",
        action: "delete",
        args: { path: "Notebook", force: true },
      });
    });
  });
});

describe("vault agent commands — comments", () => {
  it("lists, contexts, addresses, resolves, and deletes comments", async () => {
    await withVaultFixture(async () => {
      const listed = await executeVaultCommand({
        group: "comment",
        action: "list",
        args: { path: SEED_PATH },
      });
      expect((listed.data as { comments: Array<{ id: string }> }).comments[0].id).toBe("cmt_seed");

      const context = await executeVaultCommand({
        group: "comment",
        action: "context",
        args: { path: SEED_PATH, id: "cmt_seed", lines: 1 },
      });
      expect((context.data as { context: { lineNumber: number } }).context.lineNumber).toBeGreaterThan(0);

      const addressed = await executeVaultCommand({
        group: "comment",
        action: "address",
        args: { path: SEED_PATH, id: "cmt_seed", replacement: "revised anchor text" },
      });
      const page = (addressed.data as { page: { body: string } }).page;
      expect(page.body).toContain("revised anchor text");
      expect(page.body).not.toContain("seed page body");
      expect((addressed.data as { comments: Array<{ resolvedAt: string | null }> }).comments[0].resolvedAt).toBeTruthy();

      await expect(
        executeVaultCommand({
          group: "comment",
          action: "address",
          args: { path: SEED_PATH, id: "cmt_seed", replacement: "nope" },
        })
      ).rejects.toThrow("no longer exists");
    });
  });

  it("resolves and deletes comments without touching unrelated body text", async () => {
    await withVaultFixture(async () => {
      await executeVaultCommand({
        group: "comment",
        action: "resolve",
        args: { path: SEED_PATH, id: "cmt_seed" },
      });
      const resolved = await executeVaultCommand({
        group: "comment",
        action: "get",
        args: { path: SEED_PATH, id: "cmt_seed" },
      });
      expect((resolved.data as { comment: { resolvedAt: string | null } }).comment.resolvedAt).toBeTruthy();

      await executeVaultCommand({
        group: "comment",
        action: "delete",
        args: { path: SEED_PATH, id: "cmt_seed" },
      });
      const listed = await executeVaultCommand({
        group: "comment",
        action: "list",
        args: { path: SEED_PATH },
      });
      expect((listed.data as { comments: unknown[] }).comments).toEqual([]);
    });
  });
});

describe("vault agent commands — version bridge", () => {
  it("snapshots on write, lists versions, and restores", async () => {
    await withVaultFixture(async () => {
      await executeVaultCommand({
        group: "page",
        action: "write",
        args: { path: SEED_PATH, body: "Version one body." },
      });
      await executeVaultCommand({
        group: "page",
        action: "write",
        args: { path: SEED_PATH, body: "Version two body." },
      });

      const versions = await listPageVersions(SEED_PATH);
      expect(versions.length).toBeGreaterThanOrEqual(1);

      const listed = await executeVaultCommand({
        group: "version",
        action: "page_versions",
        args: { path: SEED_PATH },
      });
      const versionId = (listed.data as { versions: Array<{ id: string }> }).versions[0]?.id;
      expect(versionId).toBeTruthy();

      await executeVaultCommand({
        group: "version",
        action: "page_restore",
        args: { path: SEED_PATH, version: versionId },
      });
      const restored = await readPage(SEED_PATH);
      expect(restored.body).toContain("Version one body.");
    });
  });
});

// ---------------------------------------------------------------------------
// SN-84: structured edit tools
// ---------------------------------------------------------------------------

describe("vault agent commands — SN-84 structured edit tools", () => {
  const SECTION_SEED_PATH = "Notebook/Section/section-seed.html";
  const SECTION_SEED_CONTENT = `---
title: Section Seed
---
<h2>Introduction</h2><p>Intro content here.</p><h2>Summary</h2><p>Old summary content.</p>
`;

  async function withSectionFixture(run: () => Promise<void>) {
    const previousVault = process.env.SMART_NOTES_VAULT;
    const previousStateDir = process.env.SMART_NOTES_STATE_DIR;
    const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-sn84-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-state-"));
    process.env.SMART_NOTES_VAULT = vaultRoot;
    process.env.SMART_NOTES_STATE_DIR = stateDir;
    invalidateVaultTreeCacheForTesting();
    try {
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, SECTION_SEED_PATH), SECTION_SEED_CONTENT, "utf8");
      await fs.writeFile(path.join(vaultRoot, SEED_PATH), SEED_CONTENT, "utf8");
      await run();
    } finally {
      if (previousVault) {
        process.env.SMART_NOTES_VAULT = previousVault;
      } else {
        delete process.env.SMART_NOTES_VAULT;
      }
      if (previousStateDir) {
        process.env.SMART_NOTES_STATE_DIR = previousStateDir;
      } else {
        delete process.env.SMART_NOTES_STATE_DIR;
      }
      await fs.rm(vaultRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  }

  it("page_edit applies multiple patches atomically", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultCommand({
        group: "page",
        action: "edit",
        args: {
          path: SEED_PATH,
          edits: [
            { search: "seed page body", replacement: "edited page body" },
            { search: "testing agent commands", replacement: "testing page_edit" },
          ],
        },
      });
      expect(result.ok).toBe(true);
      const data = result.data as { applied: number; total: number; page: { body: string } };
      expect(data.applied).toBe(2);
      expect(data.total).toBe(2);
      expect(data.page.body).toContain("edited page body");
      expect(data.page.body).toContain("testing page_edit");
    });
  });

  it("page_edit reports partial apply and still writes when some patches match", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultCommand({
        group: "page",
        action: "edit",
        args: {
          path: SEED_PATH,
          edits: [
            { search: "seed page body", replacement: "partial edit" },
            { search: "THIS DOES NOT EXIST", replacement: "nope" },
          ],
        },
      });
      expect(result.ok).toBe(true);
      const data = result.data as { applied: number; total: number };
      expect(data.applied).toBe(1);
      expect(data.total).toBe(2);
    });
  });

  it("page_edit throws PATCH_NOT_FOUND when no patches match", async () => {
    await withVaultFixture(async () => {
      await expect(
        executeVaultCommand({
          group: "page",
          action: "edit",
          args: {
            path: SEED_PATH,
            edits: [{ search: "NONEXISTENT TEXT", replacement: "x" }],
          },
        })
      ).rejects.toThrow("None of the search strings");
    });
  });

  it("page_replace_section replaces section body by heading", async () => {
    await withSectionFixture(async () => {
      const result = await executeVaultCommand({
        group: "page",
        action: "replace_section",
        args: {
          path: SECTION_SEED_PATH,
          heading: "Summary",
          content: "<p>New summary content.</p>",
        },
      });
      expect(result.ok).toBe(true);
      const page = (result.data as { page: { body: string } }).page;
      expect(page.body).toContain("New summary content.");
      expect(page.body).not.toContain("Old summary content.");
      // Heading itself is preserved
      expect(page.body).toContain("<h2>Summary</h2>");
      // Other sections are untouched
      expect(page.body).toContain("Intro content here.");
    });
  });

  it("page_replace_section throws PATCH_NOT_FOUND for unknown heading", async () => {
    await withSectionFixture(async () => {
      await expect(
        executeVaultCommand({
          group: "page",
          action: "replace_section",
          args: {
            path: SECTION_SEED_PATH,
            heading: "Nonexistent Section",
            content: "<p>x</p>",
          },
        })
      ).rejects.toThrow("not found in the page body");
    });
  });

  it("page_update_body replaces body only without touching frontmatter", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultCommand({
        group: "page",
        action: "update_body",
        args: {
          path: SEED_PATH,
          body: "<p>Replaced body content.</p>",
        },
      });
      expect(result.ok).toBe(true);
      const data = result.data as {
        page: { body: string; title: string };
        contentHash: string;
        updatedAt: string;
        resolvedDiskPath: string;
        vaultRelativePath: string;
      };
      // Body was replaced
      expect(data.page.body).toContain("Replaced body content.");
      expect(data.page.body).not.toContain("seed page body");
      // Title (frontmatter) was preserved
      expect(data.page.title).toBe("Seed");
      // Confirmation fields are present
      expect(typeof data.contentHash).toBe("string");
      expect(data.contentHash.length).toBeGreaterThan(0);
      expect(typeof data.updatedAt).toBe("string");
      expect(typeof data.resolvedDiskPath).toBe("string");
      expect(data.vaultRelativePath).toBe(SEED_PATH);
    });
  });

  it("page_update_body is exposed as a named vault tool", async () => {
    await withVaultFixture(async () => {
      const toolResult = await executeVaultTool("page_update_body", {
        path: SEED_PATH,
        body: "<p>Via named tool.</p>",
      });
      expect(toolResult.ok).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// SN-84: page_parent cross-machine parent_id resolution
// ---------------------------------------------------------------------------

describe("vault agent commands — SN-84 page_parent", () => {
  const PARENT_PATH = "Notebook/Section/seed.html";
  // A child page whose parent_id is set to an absolute path from a different machine.
  const CHILD_PATH = "Notebook/Section/child.html";

  it("page_parent resolves a vault-relative parent_id", async () => {
    await withVaultFixture(async () => {
      // Write a child page with parent_id set to a vault-relative path
      const childContent = `---
title: Child Page
parent_id: ${PARENT_PATH}
---
<p>Child body.</p>
`;
      const fs2 = await import("node:fs/promises");
      const pathMod = await import("node:path");
      await fs2.writeFile(
        pathMod.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", "child.html"),
        childContent,
        "utf8"
      );

      const result = await executeVaultCommand({
        group: "page",
        action: "parent",
        args: { path: CHILD_PATH },
      });
      expect(result.ok).toBe(true);
      const data = result.data as { parentPage: { title: string; path: string } | null; parentId: string | null };
      expect(data.parentPage).not.toBeNull();
      expect(data.parentPage!.title).toBe("Seed");
      expect(data.parentPage!.path).toBe(PARENT_PATH);
    });
  });

  it("page_parent resolves cross-machine absolute parent_id via last-3-segment fallback", async () => {
    await withVaultFixture(async () => {
      // Simulate a parent_id written on a different machine with a different vault root.
      // The path prefix doesn't match current vault root but the last 3 segments are correct.
      // Use YAML single-quotes so backslashes are treated as literal characters (not escape sequences).
      const childContent = `---
title: Child Page
parent_id: 'C:\\Users\\old-user\\Documents\\vault\\Notebook\\Section\\seed.html'
---
<p>Child body.</p>
`;
      const fs2 = await import("node:fs/promises");
      const pathMod = await import("node:path");
      await fs2.writeFile(
        pathMod.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", "child.html"),
        childContent,
        "utf8"
      );

      const result = await executeVaultCommand({
        group: "page",
        action: "parent",
        args: { path: CHILD_PATH },
      });
      expect(result.ok).toBe(true);
      const data = result.data as { parentPage: { title: string; path: string } | null; parentId: string | null };
      // Cross-machine path should resolve via the last-3-segment fallback
      expect(data.parentPage).not.toBeNull();
      expect(data.parentPage!.title).toBe("Seed");
    });
  });

  it("page_parent returns null parentPage when parent does not exist", async () => {
    await withVaultFixture(async () => {
      const childContent = `---
title: Child Page
parent_id: Notebook/Section/nonexistent.html
---
<p>Child body.</p>
`;
      const fs2 = await import("node:fs/promises");
      const pathMod = await import("node:path");
      await fs2.writeFile(
        pathMod.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", "child.html"),
        childContent,
        "utf8"
      );

      const result = await executeVaultCommand({
        group: "page",
        action: "parent",
        args: { path: CHILD_PATH },
      });
      expect(result.ok).toBe(true);
      const data = result.data as { parentPage: null; parentId: string | null; notebookPath: string; sectionPath: string };
      expect(data.parentPage).toBeNull();
      expect(data.parentId).toBeTruthy(); // still reports the id
      expect(data.notebookPath).toBe("Notebook");
      expect(data.sectionPath).toBe("Notebook/Section");
    });
  });

  it("page_parent returns section/notebook context when no parent_id is set", async () => {
    await withVaultFixture(async () => {
      // SEED_PATH has no parent_id
      const result = await executeVaultCommand({
        group: "page",
        action: "parent",
        args: { path: SEED_PATH },
      });
      expect(result.ok).toBe(true);
      const data = result.data as { parentPage: null; parentId: null; notebookPath: string; sectionPath: string; hint: string };
      expect(data.parentPage).toBeNull();
      expect(data.parentId).toBeNull();
      expect(data.notebookPath).toBe("Notebook");
      expect(data.sectionPath).toBe("Notebook/Section");
      expect(data.hint).toContain("No parent_id set");
    });
  });
});

// ---------------------------------------------------------------------------
// SN-84: navigation / search
// ---------------------------------------------------------------------------

describe("vault agent commands — SN-84 navigation and search", () => {
  it("vault_tree returns full structure", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultCommand({ group: "vault", action: "tree", args: {} });
      expect(result.ok).toBe(true);
      const data = result.data as { tree: Array<{ name: string; path: string; sections: Array<{ name: string; pages: Array<{ title: string; path: string }> }> }> };
      expect(data.tree.length).toBe(1);
      expect(data.tree[0].name).toBe("Notebook");
      expect(data.tree[0].sections[0].name).toBe("Section");
      expect(data.tree[0].sections[0].pages[0].title).toBe("Seed");
      expect(data.tree[0].sections[0].pages[0].path).toBe(SEED_PATH);
    });
  });

  it("page_find returns pages matching a partial title", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultCommand({
        group: "page",
        action: "find",
        args: { query: "seed" },
      });
      expect(result.ok).toBe(true);
      const data = result.data as { query: string; matches: Array<{ title: string; path: string; breadcrumb: string }> };
      expect(data.matches.length).toBe(1);
      expect(data.matches[0].title).toBe("Seed");
      expect(data.matches[0].path).toBe(SEED_PATH);
      expect(data.matches[0].breadcrumb).toBe("Notebook / Section");
    });
  });

  it("page_find returns empty matches and hint when no pages match", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultCommand({
        group: "page",
        action: "find",
        args: { query: "completely nonexistent xyz" },
      });
      expect(result.ok).toBe(true);
      const data = result.data as { matches: unknown[]; hint?: string };
      expect(data.matches).toHaveLength(0);
      expect(data.hint).toBeTruthy();
    });
  });

  it("page_find via named tool page_find works end-to-end", async () => {
    await withVaultFixture(async () => {
      const toolResult = await executeVaultTool("page_find", { query: "seed" });
      expect(toolResult.ok).toBe(true);
    });
  });

  it("vault_tree via named tool works end-to-end", async () => {
    await withVaultFixture(async () => {
      const toolResult = await executeVaultTool("vault_tree", {});
      expect(toolResult.ok).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// SN-84: path canonicalization — agent command integration
// ---------------------------------------------------------------------------

describe("vault agent commands — SN-84 path canonicalization", () => {
  it("page_get accepts path without .html extension", async () => {
    await withVaultFixture(async () => {
      // SEED_PATH is Notebook/Section/seed.html; pass without extension
      const result = await executeVaultCommand({
        group: "page",
        action: "get",
        args: { path: "Notebook/Section/seed" },
      });
      expect(result.ok).toBe(true);
      expect((result.data as { page: { title: string } }).page.title).toBe("Seed");
    });
  });

  it("page_get accepts path with legacy .md extension", async () => {
    await withVaultFixture(async () => {
      const result = await executeVaultCommand({
        group: "page",
        action: "get",
        args: { path: "Notebook/Section/seed.md" },
      });
      expect(result.ok).toBe(true);
      expect((result.data as { page: { title: string } }).page.title).toBe("Seed");
    });
  });
});

describe("vault agent tools and API route", () => {
  it("executes named tools and exposes catalog via GET", async () => {
    await withVaultFixture(async () => {
      const toolResult = await executeVaultTool("page_get", { path: SEED_PATH });
      expect(toolResult.ok).toBe(true);
      if (toolResult.ok) {
        expect((toolResult.result.data as { page: { title: string } }).page.title).toBe("Seed");
      }

      const getResponse = await GET();
      expect(getResponse.status).toBe(200);
      const catalog = await getResponse.json();
      expect(catalog.tools.length).toBeGreaterThan(0);
      expect(catalog.commands.page).toContain("write");
      expect(catalog.commands.pdf).toContain("read_page");
      expect(catalog.commands.pdf).toContain("read_pages");
      expect(catalog.commands.pdf).toContain("page_count");
      expect(catalog.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "pdf_read_page" }),
          expect.objectContaining({ name: "pdf_read_pages" }),
          expect.objectContaining({ name: "pdf_page_count" }),
        ])
      );
    });
  });

  it("reads capped PDF ranges and page-count metadata without whole-document output", async () => {
    await withVaultFixture(async () => {
      const href = "/vault/Notebook/Section/seed.assets/book.pdf";
      await fs.mkdir(path.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", "seed.assets"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", "seed.assets", "book.pdf"),
        "mock pdf"
      );
      mockPdfTotalPages = 622;
      mockPdfPages.set(91, "Previous page.");
      mockPdfPages.set(92, "Deep Learning page 92.");
      mockPdfPages.set(93, "Next page.");

      const count = await executeVaultTool("pdf_page_count", { href });
      expect(count.ok).toBe(true);
      if (count.ok) {
        expect(count.result.data).toEqual(
          expect.objectContaining({ href: "Notebook/Section/seed.assets/book.pdf", totalPages: 622 })
        );
        expect(count.result.data).not.toHaveProperty("text");
      }

      const range = await executeVaultTool("pdf_read_pages", {
        href,
        startPage: 91,
        endPage: 93,
      });
      expect(range.ok).toBe(true);
      if (range.ok) {
        expect(range.result.data).toEqual(
          expect.objectContaining({
            startPage: 91,
            endPage: 93,
            totalPages: 622,
            pages: [
              expect.objectContaining({ page: 91, text: "Previous page." }),
              expect.objectContaining({ page: 92, text: "Deep Learning page 92." }),
              expect.objectContaining({ page: 93, text: "Next page." }),
            ],
          })
        );
      }

      const tooWide = await executeVaultTool("pdf_read_pages", {
        href,
        startPage: 90,
        endPage: 93,
      });
      expect(tooWide).toEqual(
        expect.objectContaining({
          ok: false,
          code: "PDF_PAGE_RANGE_TOO_LARGE",
          error: expect.stringContaining("limited to 3 pages"),
        })
      );

      const outOfRange = await executeVaultTool("pdf_read_pages", {
        href,
        startPage: 621,
        endPage: 623,
      });
      expect(outOfRange).toEqual(
        expect.objectContaining({
          ok: false,
          code: "PDF_PAGE_OUT_OF_RANGE",
          error: expect.stringContaining("has 622 page(s)"),
        })
      );

      mockPdfPages = new Map();
      const empty = await executeVaultTool("pdf_read_pages", {
        href,
        startPage: 91,
        endPage: 93,
      });
      expect(empty).toEqual(
        expect.objectContaining({
          ok: false,
          code: "PDF_PAGE_EMPTY",
          error: expect.stringContaining("image-only"),
        })
      );
    });
  });

  it("keeps a multi-page response under one maxPdfTextChars bound", async () => {
    await withVaultFixture(async () => {
      const href = "/vault/Notebook/Section/seed.assets/large.pdf";
      await fs.mkdir(path.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", "seed.assets"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", "seed.assets", "large.pdf"),
        "mock pdf"
      );
      mockPdfTotalPages = 3;
      mockPdfPages.set(1, "A".repeat(30_000));
      mockPdfPages.set(2, "B".repeat(30_000));
      mockPdfPages.set(3, "C".repeat(30_000));

      const result = await executeVaultTool("pdf_read_pages", {
        href,
        startPage: 1,
        endPage: 3,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.result.data as {
          pages: Array<{ text: string }>;
          truncated: boolean;
          totalChars: number;
        };
        expect(data.pages.reduce((sum, page) => sum + page.text.length, 0)).toBe(60_000);
        expect(data.truncated).toBe(true);
        expect(data.totalChars).toBe(90_000);
      }
    });
  });

  it("reads exactly one bounded PDF page and reports page failures explicitly", async () => {
    await withVaultFixture(async () => {
      const href = "/vault/Notebook/Section/seed.assets/paper.pdf";
      await fs.mkdir(path.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", "seed.assets"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", "seed.assets", "paper.pdf"),
        "mock pdf"
      );
      mockPdfTotalPages = 4;
      mockPdfPages.set(2, "Bounded page two text.");
      mockPdfPages.set(4, "Z".repeat(70_000));

      const success = await executeVaultTool("pdf_read_page", { href, page: 2 });
      expect(success.ok).toBe(true);
      if (success.ok) {
        expect(success.result.data).toEqual(
          expect.objectContaining({
            href: "Notebook/Section/seed.assets/paper.pdf",
            page: 2,
            totalPages: 4,
            text: "Bounded page two text.",
          })
        );
      }

      const outOfRange = await executeVaultTool("pdf_read_page", { href, page: 9 });
      expect(outOfRange).toEqual(
        expect.objectContaining({
          ok: false,
          code: "PDF_PAGE_OUT_OF_RANGE",
          error: expect.stringContaining("has 4 page(s)"),
        })
      );

      const imageOnly = await executeVaultTool("pdf_read_page", { href, page: 3 });
      expect(imageOnly).toEqual(
        expect.objectContaining({
          ok: false,
          code: "PDF_PAGE_EMPTY",
          error: expect.stringContaining("No extractable text"),
        })
      );

      const oversized = await executeVaultTool("pdf_read_page", { href, page: 4 });
      expect(oversized.ok).toBe(true);
      if (oversized.ok) {
        const data = oversized.result.data as { text: string; truncated: boolean; totalChars: number };
        expect(data.text).toHaveLength(60_000);
        expect(data.truncated).toBe(true);
        expect(data.totalChars).toBe(70_000);
      }
    });
  });

  it("executes page_delete via named tool", async () => {
    await withVaultFixture(async () => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { sectionPath: "Notebook/Section", title: "Delete Via Tool" },
      });
      const createdPath = (created.data as { page: { path: string } }).page.path;

      const toolResult = await executeVaultTool("page_delete", { path: createdPath });
      expect(toolResult.ok).toBe(true);
      await expect(readPage(createdPath)).rejects.toThrow("Page not found");
    });
  });

  it("POST /api/agent/vault handles tool and raw command dispatch", async () => {
    await withVaultFixture(async () => {
      const toolRequest = new Request("http://localhost/api/agent/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "page_create",
          args: { sectionPath: "Notebook/Section", title: "Via API", content: "API body" },
        }),
      });
      const toolResponse = await POST(toolRequest);
      expect(toolResponse.status).toBe(200);
      const toolJson = await toolResponse.json();
      expect(toolJson.ok).toBe(true);

      const cmdRequest = new Request("http://localhost/api/agent/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group: "comment",
          action: "list",
          args: { path: SEED_PATH },
        }),
      });
      const cmdResponse = await POST(cmdRequest);
      expect(cmdResponse.status).toBe(200);
      const cmdJson = await cmdResponse.json();
      expect(cmdJson.ok).toBe(true);
      expect(cmdJson.result.data.comments).toHaveLength(1);
    });
  });
});
