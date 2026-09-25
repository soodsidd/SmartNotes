import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { VaultError } from "./errors";
import { parseFrontmatterDocument, serializeFrontmatterDocument } from "./frontmatter";
import {
  createNotebook,
  createPage,
  createSection,
  deleteNotebook,
  deletePage,
  deleteSection,
  movePage,
  readPage,
  readPageComments,
  readVaultTree,
  renameNotebook,
  renamePage,
  renameSection,
  savePage,
  savePageComments,
  type StoredComment,
  readLogDocument,
  readLogFormDefinition,
  saveLogFormDefinition,
} from "./pages";
import { resolveVaultPath, canonicalizePagePath, isPageFileName } from "./paths";
import type { FrontmatterData, FrontmatterValue } from "./types";
import {
  listPageVersions,
  restorePageVersion,
  snapshotPageContent,
  snapshotSpreadsheetContent,
} from "./versions";
import { appendHtmlBlock, prependHtmlBlock } from "./page-format";
import { escapeHtml, htmlContainsPlainText, replacePlainTextInHtml, stripHtml } from "./html-utils";
import { normalizeMathInHtml } from "./math-normalize";
import { searchVault } from "./search";
import { renderLogFormToPng, renderPageToPng, renderUiToPng, resolveUiViewportWidth } from "./page-render";
import { uploadPageAsset } from "./assets";
import { queryLogPage, queryNamedLogView } from "./log-query";
import {
  createNotebookCell,
  deleteNotebookCell,
  editNotebookCell,
  readNotebookContext,
  reorderNotebookCell,
  requireCellType,
} from "./jupyter-notebook";
import { getAppTemplate, listAppTemplates, APP_TEMPLATE_CATALOG_VERSION } from "./app-templates";
import { getAppInventoryEntry, listAppInventory } from "./app-inventory";
import { queryAppTableForCompanion, saveAppManifest, seedOwnedAppTable } from "./app-runtime";
import { deliverCompanionAppMessage } from "./companion-app-channel";
import {
  readVaultPdfPage,
  readVaultPdfPageCount,
  readVaultPdfPages,
} from "./companion-context";
import { readSpreadsheetWorkbook, writeSpreadsheetWorkbook } from "./spreadsheet";
import {
  applyCellWrites,
  listWorksheets,
  readCellRange,
  SpreadsheetCellError,
  summarizeCells,
  type SheetSelector,
} from "@/lib/spreadsheet-cells";

export type VaultCommandGroup = "page" | "notebook" | "section" | "comment" | "version" | "vault" | "pdf" | "jupyter" | "log" | "design" | "app" | "spreadsheet";

export interface VaultCommandRequest {
  group: VaultCommandGroup;
  action: string;
  args?: Record<string, unknown>;
}

export interface VaultCommandResult {
  ok: true;
  group: VaultCommandGroup;
  action: string;
  data: unknown;
  /** When true, clients should refresh the vault tree. */
  treeChanged?: boolean;
  /** When set, emit file_updated for multi-tab sync. */
  fileUpdated?: { path: string; content: string; kind?: "log_form" | "spreadsheet" };
  /** When set, emit jupyter_notebook_updated so active embedded notebook views can refresh. */
  notebookUpdated?: { path: string; contentHash: string };
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new VaultError("INVALID_INPUT", `"${field}" is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function decodeBase64(value: unknown, field: string) {
  const raw = requireString(value, field).replace(/^data:[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    throw new VaultError("INVALID_INPUT", `"${field}" must be base64 data.`);
  }
  return Buffer.from(raw, "base64");
}

function requireBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new VaultError("INVALID_INPUT", `"${field}" must be a boolean.`);
  }
  return value;
}

function stripMarkdown(source: string) {
  return stripHtml(source);
}

function annotateDraftBody(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  return lines.map((line, index) => `${String(index + 1).padStart(4, " ")}| ${line}`).join("\n");
}

/** Design pages are raw HTML/CSS artifacts — Tiptap mutators must not rewrite them. */
function isRawArtifactPage(noteType: unknown): boolean {
  return noteType === "design" || noteType === "app";
}

function rejectRawArtifactPageTool(noteType: unknown, toolName: string): void {
  if (isRawArtifactPage(noteType)) {
    throw new VaultError(
      "INVALID_INPUT",
      `${toolName} is not supported on Design/App pages (raw HTML/CSS/JS artifacts). Use page_write, page_edit, or app_update instead.`,
      400
    );
  }
}

function asTagList(metadata: FrontmatterData) {
  const raw = metadata.tags;
  if (!Array.isArray(raw)) return [] as string[];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

function rejectLinkedDesignFrontmatterWrite(page: { designLinked?: boolean }) {
  if (page.designLinked) {
    throw new VaultError(
      "INVALID_INPUT",
      "Linked design pages keep metadata in .design-link.json and never inject vault frontmatter into the HTML. Use page_write/page_edit for the artifact body, or rename for the display title.",
      400
    );
  }
}

async function writePageBody(pagePath: string, nextBody: string) {
  const page = await readPage(pagePath);
  const saved = await savePage({
    path: page.path,
    title: page.title,
    body: nextBody,
  });
  return saved;
}

async function sectionHasPages(sectionPath: string) {
  const { absolutePath } = resolveVaultPath(sectionPath, "section");
  const entries = await fs.readdir(absolutePath, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isFile() && isPageFileName(entry.name));
}

async function notebookHasContent(notebookPath: string) {
  const tree = await readVaultTree();
  const notebook = tree.tree.find((entry) => entry.path === notebookPath);
  if (!notebook) return false;
  return notebook.pages.length > 0 || notebook.sections.some((section) => section.pages.length > 0);
}

function findComment(comments: StoredComment[], commentId: string) {
  const comment = comments.find((entry) => entry.id === commentId);
  if (!comment) {
    throw new VaultError("COMMENT_NOT_FOUND", `Comment not found: ${commentId}`, 404);
  }
  return comment;
}

function replaceQuoteInBody(body: string, quote: string, replacement: string) {
  const nextBody = replacePlainTextInHtml(body, quote, escapeHtml(replacement));
  if (nextBody === null) {
    throw new VaultError(
      "ORPHANED_COMMENT",
      "Quoted anchor text no longer exists in the page body. Use page write for a broad rewrite.",
      400
    );
  }
  return nextBody;
}

function commentContext(body: string, quote: string, lines: number) {
  const normalized = stripHtml(body).replace(/\r\n/g, "\n");
  const index = normalized.indexOf(quote);
  if (index === -1) {
    throw new VaultError(
      "ORPHANED_COMMENT",
      "Quoted anchor text no longer exists in the page body.",
      400
    );
  }

  const before = normalized.slice(0, index);
  const lineNumber = before.split("\n").length;
  const allLines = normalized.split("\n");
  const start = Math.max(0, lineNumber - 1 - lines);
  const end = Math.min(allLines.length, lineNumber - 1 + lines + 1);
  const excerpt = allLines.slice(start, end).map((line, offset) => ({
    line: start + offset + 1,
    text: line,
  }));

  return { lineNumber, excerpt, orphaned: false };
}

function listOrphanedComments(body: string, comments: StoredComment[]) {
  return comments.filter((comment) => !htmlContainsPlainText(body, comment.quote));
}

// ---------------------------------------------------------------------------
// Page commands
// ---------------------------------------------------------------------------

async function runPageCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  switch (action) {
    case "create": {
      const sectionPath = requireString(args.sectionPath, "sectionPath");
      const title = optionalString(args.title) || "Untitled page";
      // Design pages render their body as raw HTML (SN-167) — do NOT run the
      // Tiptap math normalizer over it, which would rewrite the artifact markup.
      const requestedNoteType = optionalString(args.noteType);
      const noteType: "text" | "design" = requestedNoteType === "design" ? "design" : "text";
      if (requestedNoteType && requestedNoteType !== "text" && requestedNoteType !== "design") {
        throw new VaultError(
          "INVALID_INPUT",
          'page_create noteType supports only "text" or "design"; create ink/jupyter/log pages from the UI.',
          400
        );
      }
      const rawContent = optionalString(args.content);
      const content =
        rawContent && noteType !== "design" ? normalizeMathInHtml(rawContent) : rawContent;
      const created = await createPage({ sectionPath, title, noteType });
      const page = content
        ? await savePage({ path: created.path, title: created.title, body: content })
        : created;
      const { absolutePath } = resolveVaultPath(page.path, "page");
      return {
        ok: true,
        group: "page",
        action,
        data: {
          page,
          resolvedDiskPath: absolutePath,
          vaultRelativePath: page.path,
          hint:
            noteType === "design"
              ? "Design page created. Use resolvedDiskPath for direct filesystem edits (portable notebooks live outside the vault root). Prefer page_write/page_edit/ui_render with vaultRelativePath."
              : undefined,
        },
        treeChanged: true,
        fileUpdated: content ? { path: page.path, content: page.body } : undefined,
      };
    }

    case "delete": {
      const pagePath = requireString(args.path, "path");
      await deletePage(pagePath);
      return { ok: true, group: "page", action, data: { path: pagePath }, treeChanged: true };
    }

    case "rename": {
      const pagePath = requireString(args.path, "path");
      const title = requireString(args.title, "title");
      const page = await renamePage(pagePath, title);
      return { ok: true, group: "page", action, data: { page }, treeChanged: true };
    }

    case "move": {
      const pagePath = requireString(args.path, "path");
      const sectionPath = requireString(args.sectionPath, "sectionPath");
      const page = await movePage(pagePath, sectionPath);
      return { ok: true, group: "page", action, data: { page }, treeChanged: true };
    }

    case "list": {
      const tree = await readVaultTree();
      const sectionPath = optionalString(args.sectionPath);
      if (sectionPath) {
        const notebook = tree.tree.find((entry) =>
          entry.sections.some((section) => section.path === sectionPath)
        );
        const section = notebook?.sections.find((entry) => entry.path === sectionPath);
        return {
          ok: true,
          group: "page",
          action,
          data: {
            sectionPath,
            pages: (section?.pages ?? []).map((page) => ({
              path: page.path,
              title: page.title,
              updatedAt: page.updatedAt,
            })),
          },
        };
      }

      return {
        ok: true,
        group: "page",
        action,
        data: {
          notebooks: tree.tree.map((notebook) => ({
            path: notebook.path,
            name: notebook.name,
            pageCount: notebook.pages.length,
            sections: notebook.sections.map((section) => ({
              path: section.path,
              name: section.name,
              pageCount: section.pages.length,
            })),
          })),
        },
      };
    }

    case "get": {
      // AC2 (SN-84): return comments inline so companion does not need to parse YAML manually.
      const pagePath = requireString(args.path, "path");
      const [page, comments] = await Promise.all([readPage(pagePath), readPageComments(pagePath)]);
      const { absolutePath } = resolveVaultPath(pagePath, "page");
      return {
        ok: true,
        group: "page",
        action,
        data: {
          page,
          comments,
          vaultRelativePath: page.path,
          resolvedDiskPath: absolutePath,
        },
      };
    }

    case "excerpt": {
      const pagePath = requireString(args.path, "path");
      const maxChars = typeof args.maxChars === "number" ? args.maxChars : 500;
      const page = await readPage(pagePath);
      const excerpt = stripMarkdown(page.body).slice(0, maxChars);
      return { ok: true, group: "page", action, data: { path: page.path, title: page.title, excerpt } };
    }

    case "write": {
      // AC3 (SN-84): response includes contentHash, updatedAt, and resolvedDiskPath.
      const pagePath = requireString(args.path, "path");
      const rawBody = typeof args.body === "string" ? args.body : typeof args.content === "string" ? args.content : "";
      const title = optionalString(args.title);
      const existing = await readPage(pagePath);
      // Design pages store raw HTML/CSS artifacts — never run the Tiptap math
      // normalizer over them (it would rewrite the artifact markup).
      const isRawArtifact = isRawArtifactPage(existing.metadata.note_type);
      const body = isRawArtifact ? rawBody : normalizeMathInHtml(rawBody);
      await snapshotPageContent(pagePath);
      const page = await savePage({
        path: pagePath,
        title: title || existing.title,
        body,
      });
      const { absolutePath } = resolveVaultPath(page.path, "page");
      const contentHash = createHash("sha256").update(page.body).digest("hex").slice(0, 16);
      return {
        ok: true,
        group: "page",
        action,
        data: {
          page,
          contentHash,
          updatedAt: page.updatedAt,
          resolvedDiskPath: absolutePath,
          vaultRelativePath: page.path,
          hint: isRawArtifact
            ? "Save confirmed. The Design/App Preview stays on the previous body until the owner explicitly reloads it."
            : "Save confirmed. The editor shows a 'Remote update available' banner — the owner can click Reload to see the updated content.",
        },
        fileUpdated: { path: page.path, content: page.body },
      };
    }

    case "draft": {
      const pagePath = requireString(args.path, "path");
      const page = await readPage(pagePath);
      return {
        ok: true,
        group: "page",
        action,
        data: {
          path: page.path,
          title: page.title,
          annotatedBody: annotateDraftBody(page.body),
          hint: "Edit annotatedBody, then call page write with the revised HTML body (without line numbers).",
        },
      };
    }

    case "append": {
      const pagePath = requireString(args.path, "path");
      const text = requireString(args.text ?? args.content, "text");
      const page = await readPage(pagePath);
      rejectRawArtifactPageTool(page.metadata.note_type, "page_append");
      const block = normalizeMathInHtml(`<p>${escapeHtml(text)}</p>`);
      const saved = await writePageBody(pagePath, appendHtmlBlock(page.body, block));
      return {
        ok: true,
        group: "page",
        action,
        data: { page: saved },
        fileUpdated: { path: saved.path, content: saved.body },
      };
    }

    case "prepend": {
      const pagePath = requireString(args.path, "path");
      const text = requireString(args.text ?? args.content, "text");
      const page = await readPage(pagePath);
      rejectRawArtifactPageTool(page.metadata.note_type, "page_prepend");
      const block = normalizeMathInHtml(`<p>${escapeHtml(text)}</p>`);
      const saved = await writePageBody(pagePath, prependHtmlBlock(page.body, block));
      return {
        ok: true,
        group: "page",
        action,
        data: { page: saved },
        fileUpdated: { path: saved.path, content: saved.body },
      };
    }

    case "patch": {
      const pagePath = requireString(args.path, "path");
      const search = requireString(args.search, "search");
      const replacement = typeof args.replacement === "string" ? args.replacement : "";
      const page = await readPage(pagePath);
      if (!page.body.includes(search)) {
        throw new VaultError("PATCH_NOT_FOUND", `Search text not found in page body: ${pagePath}`, 404);
      }
      const nextBody = page.body.replace(search, replacement);
      const saved = await writePageBody(pagePath, nextBody);
      return {
        ok: true,
        group: "page",
        action,
        data: { page: saved },
        fileUpdated: { path: saved.path, content: saved.body },
      };
    }

    case "search": {
      // AC6 (SN-84): each result includes recordKey and resolvedDiskPath.
      const query = requireString(args.query, "query");
      const limit = typeof args.limit === "number" ? args.limit : 20;
      const rawMatches = await searchVault(query, limit);
      const matches = rawMatches.map((m) => {
        let resolvedDiskPath: string | undefined;
        try {
          resolvedDiskPath = resolveVaultPath(m.path, "page").absolutePath;
        } catch {
          resolvedDiskPath = undefined;
        }
        return { ...m, recordKey: m.path, resolvedDiskPath };
      });
      return { ok: true, group: "page", action, data: { query, matches } };
    }

    case "tag_add": {
      const pagePath = requireString(args.path, "path");
      const tag = requireString(args.tag, "tag");
      const page = await readPage(pagePath);
      rejectLinkedDesignFrontmatterWrite(page);
      const tags = new Set(asTagList(page.metadata));
      tags.add(tag);
      const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");
      const metadata: FrontmatterData = { ...page.metadata, tags: [...tags] };
      const serialized = serializeFrontmatterDocument(metadata, page.body);
      await fs.writeFile(absolutePath, serialized, "utf8");
      const updated = await readPage(relativePath);
      return { ok: true, group: "page", action, data: { page: updated } };
    }

    case "tag_remove": {
      const pagePath = requireString(args.path, "path");
      const tag = requireString(args.tag, "tag");
      const page = await readPage(pagePath);
      rejectLinkedDesignFrontmatterWrite(page);
      const tags = asTagList(page.metadata).filter((entry) => entry !== tag);
      const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");
      const metadata: FrontmatterData = { ...page.metadata, tags };
      const serialized = serializeFrontmatterDocument(metadata, page.body);
      await fs.writeFile(absolutePath, serialized, "utf8");
      const updated = await readPage(relativePath);
      return { ok: true, group: "page", action, data: { page: updated } };
    }

    case "frontmatter_get": {
      const pagePath = requireString(args.path, "path");
      const key = optionalString(args.key);
      const page = await readPage(pagePath);
      if (key) {
        return { ok: true, group: "page", action, data: { path: page.path, key, value: page.metadata[key] ?? null } };
      }
      return { ok: true, group: "page", action, data: { path: page.path, frontmatter: page.metadata } };
    }

    case "frontmatter_set": {
      const pagePath = requireString(args.path, "path");
      const key = requireString(args.key, "key");
      const page = await readPage(pagePath);
      rejectLinkedDesignFrontmatterWrite(page);
      const value = args.value as FrontmatterValue;
      const metadata: FrontmatterData = { ...page.metadata, [key]: value };
      const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");
      const serialized = serializeFrontmatterDocument(metadata, page.body);
      await fs.writeFile(absolutePath, serialized, "utf8");
      const updated = await readPage(relativePath);
      return { ok: true, group: "page", action, data: { page: updated } };
    }

    // ---- SN-84: structured edit tools ----

    case "edit": {
      // Multi-patch: apply several {search, replacement} pairs atomically in one write.
      const pagePath = requireString(args.path, "path");
      const edits = args.edits;
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new VaultError(
          "INVALID_INPUT",
          '"edits" must be a non-empty array of { search, replacement } objects.'
        );
      }
      const page = await readPage(pagePath);
      let currentBody = page.body;
      const results: Array<{ search: string; applied: boolean }> = [];
      for (const edit of edits) {
        if (typeof edit.search !== "string" || typeof edit.replacement !== "string") {
          throw new VaultError(
            "INVALID_INPUT",
            'Each edit entry must have string "search" and "replacement" fields.'
          );
        }
        const applied = currentBody.includes(edit.search);
        if (applied) {
          currentBody = currentBody.replace(edit.search, edit.replacement);
        }
        results.push({ search: edit.search, applied });
      }
      const appliedCount = results.filter((r) => r.applied).length;
      if (appliedCount === 0) {
        throw new VaultError(
          "PATCH_NOT_FOUND",
          "None of the search strings were found in the page body.",
          404
        );
      }
      await snapshotPageContent(pagePath);
      const isRawArtifact = isRawArtifactPage(page.metadata.note_type);
      const saved = await savePage({
        path: pagePath,
        title: page.title,
        body: isRawArtifact ? currentBody : normalizeMathInHtml(currentBody),
      });
      const { absolutePath } = resolveVaultPath(saved.path, "page");
      return {
        ok: true,
        group: "page",
        action,
        data: {
          page: saved,
          applied: appliedCount,
          total: edits.length,
          results,
          resolvedDiskPath: absolutePath,
          vaultRelativePath: saved.path,
        },
        fileUpdated: { path: saved.path, content: saved.body },
      };
    }

    case "replace_section": {
      // Replace the body of the first <h2> section whose text matches `heading`.
      const pagePath = requireString(args.path, "path");
      const heading = requireString(args.heading, "heading");
      const content = requireString(args.content, "content");
      const page = await readPage(pagePath);
      rejectRawArtifactPageTool(page.metadata.note_type, "page_replace_section");
      const body = page.body;

      // Find all <h2> (or <h3>) headings and their byte offsets.
      const h2Re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
      const headingMatches = [...body.matchAll(h2Re)];

      const normalizedTarget = heading.trim().toLowerCase();
      let targetIdx = -1;
      for (let i = 0; i < headingMatches.length; i++) {
        const rawText = (headingMatches[i][1] ?? "").replace(/<[^>]+>/g, "").trim().toLowerCase();
        if (rawText === normalizedTarget || rawText.includes(normalizedTarget)) {
          targetIdx = i;
          break;
        }
      }

      if (targetIdx === -1) {
        throw new VaultError(
          "PATCH_NOT_FOUND",
          `Heading "${heading}" not found in the page body. Use page_draft to inspect available headings.`,
          404
        );
      }

      const targetMatch = headingMatches[targetIdx]!;
      // Section body starts right after the closing heading tag.
      const sectionBodyStart = targetMatch.index! + targetMatch[0].length;
      // Section body ends at the start of the next same-or-higher heading, or end of body.
      const nextMatch = headingMatches[targetIdx + 1];
      const sectionBodyEnd = nextMatch ? nextMatch.index! : body.length;

      const nextBody =
        body.slice(0, sectionBodyStart) +
        "\n" +
        content.trim() +
        "\n" +
        body.slice(sectionBodyEnd);

      await snapshotPageContent(pagePath);
      const saved = await savePage({
        path: pagePath,
        title: page.title,
        body: normalizeMathInHtml(nextBody.trim()),
      });
      return {
        ok: true,
        group: "page",
        action,
        data: { page: saved, heading },
        fileUpdated: { path: saved.path, content: saved.body },
      };
    }

    // ---- SN-84: AC4 — page_update_body (Tiptap HTML body only, no frontmatter) ----

    case "update_body": {
      // Replaces only the Tiptap HTML body; frontmatter is never touched.
      // Returns the same confirmation payload as page_write (AC3) so the companion
      // does not need a follow-up page_get to confirm the save.
      const pagePath = requireString(args.path, "path");
      const rawBody = requireString(args.body, "body");
      const existing = await readPage(pagePath);
      // Design pages store raw HTML/CSS — skip Tiptap math normalization (same as page_write).
      const isRawArtifact = isRawArtifactPage(existing.metadata.note_type);
      const body = isRawArtifact ? rawBody : normalizeMathInHtml(rawBody);
      await snapshotPageContent(pagePath);
      const page = await savePage({
        path: pagePath,
        title: existing.title, // title is always preserved — use page_rename to change it
        body,
      });
      const { absolutePath } = resolveVaultPath(page.path, "page");
      const contentHash = createHash("sha256").update(page.body).digest("hex").slice(0, 16);
      return {
        ok: true,
        group: "page",
        action,
        data: {
          page,
          contentHash,
          updatedAt: page.updatedAt,
          resolvedDiskPath: absolutePath,
          vaultRelativePath: page.path,
          hint: isRawArtifact
            ? "Body saved. The Design/App Preview stays on the previous body until the owner explicitly reloads it."
            : "Body saved. The editor shows a 'Remote update available' banner — the owner can click Reload to see the updated content.",
        },
        fileUpdated: { path: page.path, content: page.body },
      };
    }

    // ---- SN-84: bulk frontmatter update ----

    case "update_frontmatter": {
      // AC4 (SN-84): update multiple frontmatter fields in one call without touching the HTML body.
      const pagePath = requireString(args.path, "path");
      const fields = args.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        throw new VaultError(
          "INVALID_INPUT",
          '"fields" must be an object of key-value pairs to merge into frontmatter.'
        );
      }
      const page = await readPage(pagePath);
      rejectLinkedDesignFrontmatterWrite(page);
      const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");
      const metadata: FrontmatterData = { ...page.metadata, ...(fields as FrontmatterData) };
      const serialized = serializeFrontmatterDocument(metadata, page.body);
      await fs.writeFile(absolutePath, serialized, "utf8");
      const updated = await readPage(relativePath);
      return {
        ok: true,
        group: "page",
        action,
        data: { page: updated, updatedFields: Object.keys(fields as object) },
      };
    }

    // ---- SN-84: navigation / search ----

    case "siblings": {
      // AC5 (SN-84): list sibling pages in the same section as the given page.
      const pagePath = requireString(args.path, "path");
      const relativePath = resolveVaultPath(pagePath, "page").relativePath;
      const segments = relativePath.split("/").filter(Boolean);
      if (segments.length < 2) {
        throw new VaultError("INVALID_PATH", "Page path must have at least notebook/section/page.html structure.");
      }
      const sectionPath = segments.slice(0, -2).concat(segments[segments.length - 2]!).join("/");
      const tree = await readVaultTree();
      let siblings: Array<{ title: string; path: string; isCurrent: boolean }> = [];
      outer: for (const notebook of tree.tree) {
        if (notebook.path === sectionPath) {
          siblings = notebook.pages.map((page) => ({
            title: page.title,
            path: page.path,
            isCurrent: page.path === relativePath,
          }));
          break outer;
        }

        for (const section of notebook.sections) {
          if (section.path === sectionPath) {
            siblings = section.pages.map((page) => ({
              title: page.title,
              path: page.path,
              isCurrent: page.path === relativePath,
            }));
            break outer;
          }
        }
      }
      return {
        ok: true,
        group: "page",
        action,
        data: { sectionPath, siblings },
      };
    }

    case "parent": {
      // AC5 (SN-84): return the parent page (via parent_id frontmatter) or section+notebook info.
      // Handles cross-machine absolute parent_id values by canonicalizing through the vault path
      // normalization layer (handles backslashes, missing .html, same-machine absolute prefix).
      // For cross-machine absolutes where the vault root doesn't match, falls back to extracting
      // the last three path segments (Notebook/Section/page.html) before reading.
      const pagePath = requireString(args.path, "path");
      const page = await readPage(pagePath);
      const rawParentId = typeof page.metadata.parent_id === "string" ? page.metadata.parent_id : null;
      const { relativePath } = resolveVaultPath(pagePath, "page");
      const segments = relativePath.split("/").filter(Boolean);
      const notebookPath = segments[0] ?? null;
      const sectionPath = segments.length >= 3 ? `${segments[0]}/${segments[1]}` : null;

      let parentPage = null;
      let parentId = rawParentId; // may be updated to resolved vault-relative form
      if (rawParentId) {
        // Canonicalize: backslashes → forward slashes, strip same-machine vault root prefix,
        // fix missing .html or legacy .md extension.
        const canonical = canonicalizePagePath(rawParentId);

        // Determine a resolvable vault-relative path.
        let resolvedPath: string | null = null;
        try {
          // Validate that the canonical path is structurally safe for this vault.
          resolveVaultPath(canonical, "page");
          resolvedPath = canonical;
        } catch {
          // canonical failed vault validation — likely a cross-machine absolute path whose
          // vault root prefix could not be stripped. Fall back to the last three path segments,
          // which always encode the vault-relative Notebook/Section/page.html structure.
          const parts = canonical.split("/").filter(Boolean);
          if (parts.length >= 3) {
            const fallback = parts.slice(-3).join("/");
            try {
              resolveVaultPath(fallback, "page");
              resolvedPath = fallback;
            } catch {
              // Fallback also invalid; resolvedPath stays null.
            }
          }
        }

        if (resolvedPath) {
          parentId = resolvedPath; // report the normalized form in the response
          try {
            parentPage = await readPage(resolvedPath);
          } catch {
            // Parent may have been deleted or doesn't exist.
          }
        }
      }

      return {
        ok: true,
        group: "page",
        action,
        data: {
          parentPage,
          parentId,
          notebookPath,
          sectionPath,
          hint: parentPage
            ? `Parent page found at "${parentPage.path}". Use page_get to read it.`
            : parentId
              ? `Parent page "${parentId}" was set but could not be found (may have been moved or deleted).`
              : "No parent_id set. The notebook and section paths above describe the page's location.",
        },
      };
    }

    case "find": {
      // Locate pages by title (partial case-insensitive match).
      const query = requireString(args.query, "query");
      const limit = typeof args.limit === "number" ? args.limit : 10;
      const normalizedQuery = query.trim().toLowerCase();
      const tree = await readVaultTree();
      const matches: Array<{ title: string; path: string; breadcrumb: string }> = [];

      outer: for (const notebook of tree.tree) {
        for (const section of notebook.sections) {
          for (const page of section.pages) {
            if (page.title.toLowerCase().includes(normalizedQuery)) {
              matches.push({
                title: page.title,
                path: page.path,
                breadcrumb: `${notebook.name} / ${section.name}`,
              });
              if (matches.length >= limit) break outer;
            }
          }
        }
      }

      return {
        ok: true,
        group: "page",
        action,
        data: { query, matches, hint: matches.length === 0 ? "No pages matched. Try page_search for body content or page_list for the full page list." : undefined },
      };
    }

    case "render": {
      const pagePath = requireString(args.path, "path");
      const page = await readPage(pagePath);
      if (isRawArtifactPage(page.metadata.note_type)) {
        throw new VaultError(
          "INVALID_INPUT",
          "page_render / rr is for text/ink pages. Design pages use ui_render; App pages use their sandboxed Preview.",
          400
        );
      }
      const scale = optionalNumber(args.scale) ?? 2;
      const fullPage = optionalBoolean(args.fullPage) ?? true;
      const outputName = optionalString(args.outputName) || "page-render-latest.png";
      const render = await renderPageToPng({ pagePath, scale, fullPage, outputName });
      return {
        ok: true,
        group: "page",
        action,
        data: render,
      };
    }

    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown page command: ${action}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Log form companion commands (SN-145)
// ---------------------------------------------------------------------------

async function runLogCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  const pagePath = requireString(args.path, "path");
  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "log") {
    throw new VaultError("INVALID_INPUT", "Log form tools require a log page.", 400);
  }

  switch (action) {
    case "get": {
      const [document, form] = await Promise.all([readLogDocument(page.path), readLogFormDefinition(page.path)]);
      return {
        ok: true,
        group: "log",
        action,
        data: { path: page.path, form, schema: document.schema, rowCount: document.rows.length },
      };
    }
    case "put": {
      if (args.form === undefined) throw new VaultError("INVALID_INPUT", '"form" is required.');
      const { document, form } = await saveLogFormDefinition(page.path, args.form);
      return {
        ok: true,
        group: "log",
        action,
        data: { path: page.path, form, schema: document.schema, rowCount: document.rows.length },
        fileUpdated: { path: page.path, content: "", kind: "log_form" },
      };
    }
    case "query": {
      if (args.view !== undefined && args.query !== undefined) {
        throw new VaultError("INVALID_LOG_QUERY", 'log_query accepts either "view" or "query", not both.', 400);
      }
      const result = args.view === undefined
        ? await queryLogPage(page.path, args.query ?? {})
        : await queryNamedLogView(page.path, args.view);
      return { ok: true, group: "log", action, data: result };
    }
    case "render": {
      const render = await renderLogFormToPng({
        pagePath: page.path,
        scale: optionalNumber(args.scale) ?? 2,
        fullPage: optionalBoolean(args.fullPage) ?? true,
        outputName: optionalString(args.outputName) || "log-form-render-latest.png",
      });
      return { ok: true, group: "log", action, data: render };
    }
    case "asset_put": {
      const fileName = requireString(args.fileName, "fileName");
      if (!/\.(?:png|jpe?g|gif|webp|svg)$/i.test(fileName)) {
        throw new VaultError("INVALID_INPUT", "log_form_asset_put accepts image files only.");
      }
      const buffer = decodeBase64(args.dataBase64, "dataBase64");
      const asset = await uploadPageAsset(page.path, fileName, buffer, { overwrite: optionalBoolean(args.overwrite) === true });
      return { ok: true, group: "log", action, data: { path: page.path, asset }, fileUpdated: { path: page.path, content: "" } };
    }
    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown log command: ${action}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Spreadsheet companion commands (SN-209)
//
// Bounded cell-level read/write/summary over the authoritative Syncfusion native
// workbook JSON sidecar (SN-207). Writes go through the same vault truth the live
// editor autosaves to, snapshot the prior workbook for versions, and emit a
// spreadsheet file_updated so an open workbook can live-reload.
// ---------------------------------------------------------------------------

/** Sheet selector arg: a name (string), a zero-based index (number), or omitted. */
function optionalSheetSelector(value: unknown): SheetSelector {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

async function runSpreadsheetCommand(
  action: string,
  args: Record<string, unknown>
): Promise<VaultCommandResult> {
  const pagePath = requireString(args.path, "path");
  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "spreadsheet") {
    throw new VaultError("INVALID_INPUT", "Spreadsheet tools require a Spreadsheet page (note_type=spreadsheet).", 400);
  }

  try {
    const workbook = await readSpreadsheetWorkbook(page.path);
    switch (action) {
      case "list_sheets": {
        return {
          ok: true,
          group: "spreadsheet",
          action,
          data: { path: page.path, sheets: listWorksheets(workbook) },
        };
      }

      case "read_range": {
        const range = requireString(args.range, "range");
        const result = readCellRange(workbook, {
          sheet: optionalSheetSelector(args.sheet),
          range,
        });
        return { ok: true, group: "spreadsheet", action, data: { path: page.path, ...result } };
      }

      case "summarize": {
        const result = summarizeCells(workbook, {
          sheet: optionalSheetSelector(args.sheet),
          range: optionalString(args.range) || undefined,
          selection: optionalBoolean(args.selection) === true,
        });
        return { ok: true, group: "spreadsheet", action, data: { path: page.path, ...result } };
      }

      case "write_cells": {
        const { workbook: nextWorkbook, sheet, applied } = applyCellWrites(workbook, {
          sheet: optionalSheetSelector(args.sheet),
          writes: args.writes,
        });
        await snapshotSpreadsheetContent(page.path);
        await writeSpreadsheetWorkbook(page.path, nextWorkbook);
        return {
          ok: true,
          group: "spreadsheet",
          action,
          data: {
            path: page.path,
            sheet,
            applied,
            appliedCount: applied.length,
            hint: "Cells written to the authoritative workbook JSON. An open workbook live-reloads unless it has unsaved edits, in which case the owner sees a reload banner.",
          },
          fileUpdated: { path: page.path, content: "", kind: "spreadsheet" },
        };
      }

      default:
        throw new VaultError("UNKNOWN_COMMAND", `Unknown spreadsheet command: ${action}`, 400);
    }
  } catch (error) {
    if (error instanceof SpreadsheetCellError) {
      throw new VaultError(error.code, error.message, error.status);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Design page companion commands (SN-167)
// Design pages (note_type=design) carry a raw HTML/CSS UI artifact rendered
// verbatim. Edit the body with page_write / page_edit; capture with ui_render.
// ---------------------------------------------------------------------------

async function runDesignCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  const pagePath = requireString(args.path, "path");
  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "design") {
    throw new VaultError("INVALID_INPUT", "Design tools require a design page (note_type=design).", 400);
  }

  switch (action) {
    case "render": {
      // Accept a named preset ("desktop" | "mobile") or an explicit width.
      const rawViewport = args.viewport ?? args.viewportWidth;
      const viewport =
        rawViewport === "mobile" || rawViewport === "desktop"
          ? rawViewport
          : resolveUiViewportWidth(optionalNumber(rawViewport));
      const render = await renderUiToPng({
        pagePath: page.path,
        scale: optionalNumber(args.scale) ?? 2,
        viewport,
        outputName: optionalString(args.outputName) || undefined,
      });
      return { ok: true, group: "design", action, data: render };
    }
    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown design command: ${action}`, 400);
  }
}

function actionItemsFromOrdinaryNote(body: string): Array<{ text: string; checked: boolean; hidden: boolean }> {
  const lines = body
    .replace(/<br\s*\/?>|<\/(?:p|li|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|☐|☑|\[[ xX]\])\s*/, "").trim())
    .filter(Boolean);
  return [...new Set(lines)].slice(0, 200).map((text) => ({ text, checked: false, hidden: false }));
}

async function runAppCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  switch (action) {
    case "template_list":
      return {
        ok: true, group: "app", action,
        data: { catalogVersion: APP_TEMPLATE_CATALOG_VERSION, templates: listAppTemplates() },
      };
    case "template_get": {
      const template = getAppTemplate(args.templateId);
      return { ok: true, group: "app", action, data: { catalogVersion: APP_TEMPLATE_CATALOG_VERSION, template } };
    }
    case "inventory_list": {
      const data = await listAppInventory({ limit: args.limit, offset: args.offset });
      return { ok: true, group: "app", action, data };
    }
    case "inventory_get": {
      const pagePath = requireString(args.path, "path");
      const data = await getAppInventoryEntry(pagePath, { maxSourceChars: args.maxSourceChars });
      return { ok: true, group: "app", action, data };
    }
    case "query": {
      const pagePath = requireString(args.path, "path");
      const tableId = requireString(args.tableId, "tableId");
      const data = await queryAppTableForCompanion(pagePath, tableId, args.query === undefined ? {} : args.query);
      return { ok: true, group: "app", action, data };
    }
    case "create": {
      const sectionPath = requireString(args.sectionPath, "sectionPath");
      const template = getAppTemplate(args.templateId);
      const title = optionalString(args.title) || template.name;
      let checklistItems: Array<{ text: string; checked: boolean; hidden: boolean }> | undefined;
      if (template.id === "action-checklist") {
        const sourcePath = requireString(args.sourcePath, "sourcePath");
        const sourcePage = await readPage(sourcePath);
        if (sourcePage.metadata.note_type && sourcePage.metadata.note_type !== "text") {
          throw new VaultError("INVALID_APP_SOURCE", "Action Checklist source must be an ordinary text note.", 400);
        }
        checklistItems = actionItemsFromOrdinaryNote(sourcePage.body);
        if (checklistItems.length === 0) throw new VaultError("INVALID_APP_SOURCE", "The source note contains no action items.", 400);
      }
      const created = await createPage({ sectionPath, title, noteType: template.noteType });
      try {
        const page = await savePage({ path: created.path, title: created.title, body: template.source });
        if (template.noteType === "app" && template.manifest) {
          let manifest = template.manifest;
          if (template.id === "custom-log-app" && args.logPath !== undefined) {
            const logPath = requireString(args.logPath, "logPath");
            manifest = {
              ...manifest,
              tables: [{ id: "entries", name: "Entries", kind: "log", pagePath: logPath }],
            };
          }
          await saveAppManifest(page.path, manifest);
          if (checklistItems) {
            await seedOwnedAppTable(page.path, "items", checklistItems);
            await seedOwnedAppTable(page.path, "settings", [{ value: "visible" }]);
          }
        }
        return {
          ok: true, group: "app", action,
          data: { page, template: { id: template.id, version: template.version }, catalogVersion: APP_TEMPLATE_CATALOG_VERSION },
          treeChanged: true,
          fileUpdated: { path: page.path, content: page.body },
        };
      } catch (error) {
        await deletePage(created.path).catch(() => undefined);
        throw error;
      }
    }
    case "update": {
      const pagePath = requireString(args.path, "path");
      const page = await readPage(pagePath);
      if (page.metadata.note_type !== "app") throw new VaultError("INVALID_APP", "app_update requires an App page.", 400);
      if (args.source !== undefined && args.templateId !== undefined) {
        throw new VaultError("INVALID_APP", "app_update accepts source or templateId, not both.", 400);
      }
      let body = typeof args.source === "string" ? args.source : page.body;
      if (args.templateId !== undefined) {
        const template = getAppTemplate(args.templateId);
        if (template.noteType !== "app") {
          throw new VaultError("INVALID_APP_TEMPLATE", "Only App templates can update an App page.", 400);
        }
        body = template.source;
      }
      await snapshotPageContent(page.path);
      const saved = await savePage({ path: page.path, title: optionalString(args.title) || page.title, body });
      if (args.manifest !== undefined) await saveAppManifest(saved.path, args.manifest);
      return {
        ok: true, group: "app", action,
        data: { page: saved, hint: "App source updated. Attached table data was not replaced; the owner controls Preview reload." },
        fileUpdated: { path: saved.path, content: saved.body },
      };
    }
    case "send": {
      // SN-203: route a companion→app message to any running instance of the
      // target app (cross-page). Never queues; not-running is a clear result.
      const data = await deliverCompanionAppMessage(args.path, args.message);
      return { ok: true, group: "app", action, data };
    }
    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown app command: ${action}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Notebook / section commands
// ---------------------------------------------------------------------------

async function runNotebookCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  switch (action) {
    case "create": {
      const name = requireString(args.name, "name");
      const notebook = await createNotebook(name);
      return { ok: true, group: "notebook", action, data: { notebook }, treeChanged: true };
    }

    case "delete": {
      const notebookPath = requireString(args.path, "path");
      const force = requireBoolean(args.force ?? false, "force");
      const hasContent = await notebookHasContent(notebookPath);
      if (hasContent && !force) {
        throw new VaultError(
          "FORCE_REQUIRED",
          "Notebook is not empty. Pass force=true to delete it and all contents.",
          400
        );
      }
      await deleteNotebook(notebookPath);
      return { ok: true, group: "notebook", action, data: { path: notebookPath }, treeChanged: true };
    }

    case "rename": {
      const notebookPath = requireString(args.path, "path");
      const name = requireString(args.name, "name");
      const notebook = await renameNotebook(notebookPath, name);
      return { ok: true, group: "notebook", action, data: { notebook }, treeChanged: true };
    }

    case "list": {
      const tree = await readVaultTree();
      return {
        ok: true,
        group: "notebook",
        action,
        data: {
          notebooks: tree.tree.map((notebook) => ({
            path: notebook.path,
            name: notebook.name,
            sectionCount: notebook.sections.length,
            isPortable: Boolean(notebook.isPortable),
            // Own-in-place: companions need the real target-repo root, not vaultRoot+"/+id".
            rootPath: notebook.rootPath ?? null,
          })),
        },
      };
    }

    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown notebook command: ${action}`, 400);
  }
}

async function runSectionCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  switch (action) {
    case "create": {
      const notebookPath = requireString(args.notebookPath, "notebookPath");
      const name = requireString(args.name, "name");
      const section = await createSection(notebookPath, name);
      return { ok: true, group: "section", action, data: { section }, treeChanged: true };
    }

    case "delete": {
      const sectionPath = requireString(args.path, "path");
      const force = requireBoolean(args.force ?? false, "force");
      const hasPages = await sectionHasPages(sectionPath);
      if (hasPages && !force) {
        throw new VaultError(
          "FORCE_REQUIRED",
          "Section is not empty. Pass force=true to delete it and all pages.",
          400
        );
      }
      await deleteSection(sectionPath);
      return { ok: true, group: "section", action, data: { path: sectionPath }, treeChanged: true };
    }

    case "rename": {
      const sectionPath = requireString(args.path, "path");
      const name = requireString(args.name, "name");
      const section = await renameSection(sectionPath, name);
      return { ok: true, group: "section", action, data: { section }, treeChanged: true };
    }

    case "list": {
      const notebookPath = requireString(args.notebookPath, "notebookPath");
      const tree = await readVaultTree();
      const notebook = tree.tree.find((entry) => entry.path === notebookPath);
      if (!notebook) {
        throw new VaultError("NOTEBOOK_NOT_FOUND", `Notebook not found: ${notebookPath}`, 404);
      }
      return {
        ok: true,
        group: "section",
        action,
        data: {
          notebookPath,
          sections: notebook.sections.map((section) => ({
            path: section.path,
            name: section.name,
            pageCount: section.pages.length,
          })),
        },
      };
    }

    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown section command: ${action}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Comment commands
// ---------------------------------------------------------------------------

async function runCommentCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  switch (action) {
    case "list": {
      const pagePath = requireString(args.path, "path");
      const page = await readPage(pagePath);
      const comments = await readPageComments(pagePath);
      const orphaned = listOrphanedComments(page.body, comments);
      return {
        ok: true,
        group: "comment",
        action,
        data: { path: pagePath, comments, orphanedIds: orphaned.map((entry) => entry.id) },
      };
    }

    case "get": {
      const pagePath = requireString(args.path, "path");
      const commentId = requireString(args.id, "id");
      const comments = await readPageComments(pagePath);
      const comment = findComment(comments, commentId);
      return { ok: true, group: "comment", action, data: { path: pagePath, comment } };
    }

    case "context": {
      const pagePath = requireString(args.path, "path");
      const commentId = requireString(args.id, "id");
      const lines = typeof args.lines === "number" ? args.lines : 3;
      const page = await readPage(pagePath);
      const comments = await readPageComments(pagePath);
      const comment = findComment(comments, commentId);
      const context = commentContext(page.body, comment.quote, lines);
      return {
        ok: true,
        group: "comment",
        action,
        data: { path: pagePath, comment, context },
      };
    }

    case "resolve": {
      const pagePath = requireString(args.path, "path");
      const commentId = requireString(args.id, "id");
      const comments = await readPageComments(pagePath);
      const next = comments.map((entry) =>
        entry.id === commentId
          ? { ...entry, resolvedAt: new Date().toISOString() }
          : entry
      );
      findComment(comments, commentId);
      const saved = await savePageComments(pagePath, next);
      return { ok: true, group: "comment", action, data: { path: pagePath, comments: saved } };
    }

    case "delete": {
      const pagePath = requireString(args.path, "path");
      const commentId = requireString(args.id, "id");
      const comments = await readPageComments(pagePath);
      findComment(comments, commentId);
      const next = comments.filter((entry) => entry.id !== commentId);
      const saved = await savePageComments(pagePath, next);
      return { ok: true, group: "comment", action, data: { path: pagePath, comments: saved } };
    }

    case "address": {
      const pagePath = requireString(args.path, "path");
      const commentId = requireString(args.id, "id");
      const replacement = requireString(args.replacement ?? args.text, "replacement");
      const page = await readPage(pagePath);
      const comments = await readPageComments(pagePath);
      const comment = findComment(comments, commentId);
      const nextBody = replaceQuoteInBody(page.body, comment.quote, replacement);
      const savedPage = await savePage({ path: page.path, title: page.title, body: nextBody });
      const resolvedComments = comments.map((entry) =>
        entry.id === commentId
          ? { ...entry, resolvedAt: new Date().toISOString() }
          : entry
      );
      const savedComments = await savePageComments(pagePath, resolvedComments, savedPage.body);
      return {
        ok: true,
        group: "comment",
        action,
        data: { page: savedPage, comments: savedComments },
        fileUpdated: { path: savedPage.path, content: savedPage.body },
      };
    }

    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown comment command: ${action}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Vault-level commands (SN-84)
// ---------------------------------------------------------------------------

async function runVaultCommand(action: string): Promise<VaultCommandResult> {
  switch (action) {
    case "tree": {
      const tree = await readVaultTree();
      return {
        ok: true,
        group: "vault",
        action,
        data: {
          tree: tree.tree.map((notebook) => ({
            name: notebook.name,
            path: notebook.path,
            isPortable: Boolean(notebook.isPortable),
            rootPath: notebook.rootPath ?? null,
            pages: notebook.pages.map((page) => ({
              title: page.title,
              path: page.path,
              noteType: page.noteType,
            })),
            sections: notebook.sections.map((section) => ({
              name: section.name,
              path: section.path,
              pages: section.pages.map((page) => ({
                title: page.title,
                path: page.path,
                noteType: page.noteType,
              })),
            })),
          })),
        },
      };
    }

    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown vault command: ${action}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Bounded PDF reads (SN-199)
// ---------------------------------------------------------------------------

async function runPdfCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  const throwPdfError = (result: { code: string; reason: string }) => {
    const status = result.code === "PDF_UNAVAILABLE" ? 404 : 400;
    throw new VaultError(result.code, result.reason, status);
  };

  switch (action) {
    case "read_page": {
      const href = requireString(args.href, "href");
      if (!Number.isInteger(args.page) || (args.page as number) < 1) {
        throw new VaultError("PDF_PAGE_OUT_OF_RANGE", '"page" must be a 1-based integer.', 400);
      }
      const result = await readVaultPdfPage(href, args.page as number);
      if (!result.ok) {
        throwPdfError(result);
      }
      return {
        ok: true,
        group: "pdf",
        action,
        data: result,
      };
    }

    case "read_pages": {
      const href = requireString(args.href, "href");
      if (
        !Number.isInteger(args.startPage) ||
        !Number.isInteger(args.endPage) ||
        (args.startPage as number) < 1 ||
        (args.endPage as number) < (args.startPage as number)
      ) {
        throw new VaultError(
          "PDF_PAGE_OUT_OF_RANGE",
          '"startPage" and "endPage" must be 1-based integers with endPage >= startPage.',
          400
        );
      }
      const result = await readVaultPdfPages(
        href,
        args.startPage as number,
        args.endPage as number
      );
      if (!result.ok) {
        throwPdfError(result);
      }
      return { ok: true, group: "pdf", action, data: result };
    }

    case "page_count": {
      const href = requireString(args.href, "href");
      const result = await readVaultPdfPageCount(href);
      if (!result.ok) {
        throwPdfError(result);
      }
      return { ok: true, group: "pdf", action, data: result };
    }

    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown PDF command: ${action}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Jupyter notebook commands (SN-114)
// ---------------------------------------------------------------------------

async function runJupyterCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  switch (action) {
    case "context": {
      const pagePath = requireString(args.path, "path");
      const hasIndex = args.index !== undefined;
      const hasCellId = args.cellId !== undefined;
      if (hasIndex && !Number.isInteger(args.index)) {
        throw new VaultError("INVALID_INPUT", '"index" must be an integer.');
      }
      if (hasCellId && (typeof args.cellId !== "string" || !args.cellId.trim())) {
        throw new VaultError("INVALID_INPUT", '"cellId" must be a non-empty string.');
      }
      const context = await readNotebookContext(pagePath, {
        focusedCellIndex: hasIndex ? args.index as number : undefined,
        focusedCellId: hasCellId ? args.cellId as string : undefined,
        focusedCellOnly: hasIndex || hasCellId,
        strictFocusedCell: hasIndex || hasCellId,
      });
      return { ok: true, group: "jupyter", action, data: { context } };
    }

    case "cell_create": {
      const pagePath = requireString(args.path, "path");
      const cellType = requireCellType(args.cellType ?? "code");
      const source = typeof args.source === "string" ? args.source : "";
      const index = Number.isInteger(args.index) ? (args.index as number) : undefined;
      const result = await createNotebookCell({ path: pagePath, cellType, source, index });
      return {
        ok: true,
        group: "jupyter",
        action,
        data: result,
        notebookUpdated: { path: result.path, contentHash: result.contentHash },
      };
    }

    case "cell_edit": {
      const pagePath = requireString(args.path, "path");
      if (args.index !== undefined && !Number.isInteger(args.index)) {
        throw new VaultError("INVALID_INPUT", '"index" must be an integer when provided.');
      }
      if (args.cellId !== undefined && (typeof args.cellId !== "string" || !args.cellId.trim())) {
        throw new VaultError("INVALID_INPUT", '"cellId" must be a non-empty string when provided.');
      }
      if (args.index === undefined && args.cellId === undefined) {
        throw new VaultError("INVALID_INPUT", 'Provide "index" and/or "cellId" to edit a cell.');
      }
      const cellType = args.cellType === undefined ? undefined : requireCellType(args.cellType);
      const source = typeof args.source === "string" ? args.source : undefined;
      if (cellType === undefined && source === undefined) {
        throw new VaultError("INVALID_INPUT", 'Provide "source" and/or "cellType" to edit a cell.');
      }
      const result = await editNotebookCell({
        path: pagePath,
        index: args.index as number | undefined,
        cellId: args.cellId as string | undefined,
        source,
        cellType,
      });
      return {
        ok: true,
        group: "jupyter",
        action,
        data: result,
        notebookUpdated: { path: result.path, contentHash: result.contentHash },
      };
    }

    case "cell_delete": {
      const pagePath = requireString(args.path, "path");
      if (!Number.isInteger(args.index)) {
        throw new VaultError("INVALID_INPUT", '"index" must be an integer.');
      }
      const result = await deleteNotebookCell({ path: pagePath, index: args.index as number });
      return {
        ok: true,
        group: "jupyter",
        action,
        data: result,
        notebookUpdated: { path: result.path, contentHash: result.contentHash },
      };
    }

    case "cell_reorder": {
      const pagePath = requireString(args.path, "path");
      if (!Number.isInteger(args.fromIndex) || !Number.isInteger(args.toIndex)) {
        throw new VaultError("INVALID_INPUT", '"fromIndex" and "toIndex" must be integers.');
      }
      const result = await reorderNotebookCell({
        path: pagePath,
        fromIndex: args.fromIndex as number,
        toIndex: args.toIndex as number,
      });
      return {
        ok: true,
        group: "jupyter",
        action,
        data: result,
        notebookUpdated: { path: result.path, contentHash: result.contentHash },
      };
    }

    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown jupyter command: ${action}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Version bridge (SN-34)
// ---------------------------------------------------------------------------

async function runVersionCommand(action: string, args: Record<string, unknown>): Promise<VaultCommandResult> {
  switch (action) {
    case "page_versions": {
      const pagePath = requireString(args.path, "path");
      const versions = await listPageVersions(pagePath);
      return { ok: true, group: "version", action, data: { path: pagePath, versions } };
    }

    case "page_restore": {
      const pagePath = requireString(args.path, "path");
      const version = requireString(args.version ?? args.versionId, "version");
      const noteType = args.noteType === "ink" ? "ink" : "text";
      const restored = await restorePageVersion(pagePath, version, noteType);
      const page = await readPage(pagePath);
      return {
        ok: true,
        group: "version",
        action,
        data: { restored, page },
        fileUpdated: { path: page.path, content: page.body },
      };
    }

    default:
      throw new VaultError("UNKNOWN_COMMAND", `Unknown version command: ${action}`, 400);
  }
}

export async function executeVaultCommand(request: VaultCommandRequest): Promise<VaultCommandResult> {
  const group = requireString(request.group, "group") as VaultCommandGroup;
  const action = requireString(request.action, "action");
  const args = request.args && typeof request.args === "object" ? request.args : {};

  switch (group) {
    case "page":
      return runPageCommand(action, args);
    case "notebook":
      return runNotebookCommand(action, args);
    case "section":
      return runSectionCommand(action, args);
    case "comment":
      return runCommentCommand(action, args);
    case "version":
      return runVersionCommand(action, args);
    case "vault":
      return runVaultCommand(action);
    case "pdf":
      return runPdfCommand(action, args);
    case "jupyter":
      return runJupyterCommand(action, args);
    case "log":
      return runLogCommand(action, args);
    case "spreadsheet":
      return runSpreadsheetCommand(action, args);
    case "design":
      return runDesignCommand(action, args);
    case "app":
      return runAppCommand(action, args);
    default:
      throw new VaultError("INVALID_INPUT", `Unknown command group: ${group}`, 400);
  }
}

export function listVaultCommands() {
  return {
    page: [
      "create",
      "delete",
      "rename",
      "move",
      "list",
      "get",
      "excerpt",
      "write",
      "draft",
      "append",
      "prepend",
      "patch",
      "update_body",
      "edit",
      "replace_section",
      "update_frontmatter",
      "find",
      "siblings",
      "parent",
      "search",
      "tag_add",
      "tag_remove",
      "frontmatter_get",
      "frontmatter_set",
      "render",
    ],
    notebook: ["create", "delete", "rename", "list"],
    section: ["create", "delete", "rename", "list"],
    comment: ["list", "get", "context", "resolve", "delete", "address"],
    version: ["page_versions", "page_restore"],
    vault: ["tree"],
    pdf: ["read_page", "read_pages", "page_count"],
    jupyter: ["context", "cell_create", "cell_edit", "cell_delete", "cell_reorder"],
    log: ["get", "put", "query", "render", "asset_put"],
    spreadsheet: ["list_sheets", "read_range", "write_cells", "summarize"],
    design: ["render"],
    app: ["template_list", "template_get", "inventory_list", "inventory_get", "query", "create", "update"],
  };
}
