import fs from "node:fs/promises";
import path from "node:path";
import { getVaultRoot } from "./config";
import { VaultError } from "./errors";
import { parseFrontmatterDocument, serializeFrontmatterDocument } from "./frontmatter";
import { dirNameFromLabel, fileNameFromTitle, isPageFileName, resolveVaultPath, siblingAssetDirectory, toVaultRelativePath } from "./paths";
import {
  findPortableNotebookByPath,
  isPortableNotebookPath,
  loadNotebookRegistry,
  portableNotebookPath,
  renamePortableNotebook,
  unregisterPortableNotebook,
} from "./notebook-registry";
import { applyKeyNoteFlag, isKeyNoteFlag } from "@/lib/key-note";
import type { FrontmatterData, FrontmatterValue, NoteType, VaultNotebook, VaultPageDocument, VaultPageSummary } from "./types";
import { deletePageVersions, movePageVersions } from "./versions";
import { SPREADSHEET_SIDECAR_EXTENSION, writeSpreadsheetWorkbook } from "./spreadsheet";
import { createEmptySpreadsheetWorkbook } from "@/lib/spreadsheet-workbook";
import {
  inkSidecarRelativePath,
  JUPYTER_NOTEBOOK_FILE_NAME,
  pageStemFromPath,
  PAGE_FILE_EXTENSION,
  referenceSidecarRelativePath,
} from "./page-format";
import {
  designLinkMetadataFromSidecar,
  readDesignLinkSidecar,
  removeDesignLinkSidecar,
  resolveDesignLinkTarget,
  titleFromHtmlArtifact,
  writeDesignLinkSidecar,
  type DesignLinkSidecar,
} from "./design-link";
import {
  coerceRowValues,
  defaultLogDocument,
  makeLogId,
  normalizeFields,
  normalizeLogDocument,
  type LogDocument,
  type LogField,
  type LogRow,
} from "@/lib/log-contract";
import {
  defaultLogFormDefinition,
  fieldsFromJsonSchema,
  formDefinitionFromFields,
  normalizeLogFormDefinition,
  validateLogFormDefinitionForWrite,
  type LogFormDefinition,
} from "@/lib/log-form-contract";
import { escapeHtml, stripHtml } from "./html-utils";
import { buildDocxBuffer } from "./docx-export";
import { parseDocxBuffer } from "./docx-import";
import { stopSession as stopJupyterSession } from "../jupyter/runtime";
import { emitVaultSideEffects } from "./socket-events";

// Module-level vault tree cache. Cleared on any write operation.
let _vaultTreeCache: { tree: VaultNotebook[]; root: string } | null = null;

function invalidateVaultCache(): void {
  _vaultTreeCache = null;
}

export function invalidateVaultTreeCache(): void {
  invalidateVaultCache();
}

export function invalidateVaultTreeCacheForTesting(): void {
  invalidateVaultTreeCache();
}

export interface ReadVaultTreeOptions {
  /** When true, read page files one at a time (pre-SN-63 baseline for perf tests). */
  sequential?: boolean;
  /** When true, bypass the module-level vault tree cache. */
  skipCache?: boolean;
}

/**
 * Rename a directory, with a Windows-safe fallback.
 * On Windows, fs.rename can fail with EPERM for non-empty directories when
 * antivirus or other tools hold handles on contents. We fall back to
 * recursive copy + delete in that case.
 */
async function renameDirectory(src: string, dest: string) {
  try {
    await fs.rename(src, dest);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EXDEV") {
      await fs.cp(src, dest, { recursive: true });
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

const NOTEBOOK_COLORS = [
  "var(--notebook-color-1)",
  "var(--notebook-color-2)",
  "var(--notebook-color-3)",
  "var(--notebook-color-4)",
  "var(--notebook-color-5)",
  "var(--notebook-color-6)",
] as const;

const INBOX_SECTION_NAME = "Inbox";
const PAGE_ORDER_FILE = "_page-order.json";
const SUPPORTED_AI_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg"]);

function slugFromPath(pagePath: string) {
  return pageStemFromPath(pagePath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "page";
}

function titleFromPath(pagePath: string) {
  const baseName = pageStemFromPath(pagePath);
  return baseName
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function asNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

/** Map the raw `note_type` frontmatter value to a known NoteType (defaults to text). */
function noteTypeFromMetadata(value: FrontmatterValue | undefined): NoteType {
  if (value === "ink") return "ink";
  if (value === "jupyter") return "jupyter";
  if (value === "log") return "log";
  if (value === "design") return "design";
  if (value === "app") return "app";
  if (value === "spreadsheet") return "spreadsheet";
  return "text";
}

function versionedNoteType(metadata: FrontmatterData): "text" | "ink" | "spreadsheet" {
  if (metadata.note_type === "ink") return "ink";
  if (metadata.note_type === "spreadsheet") return "spreadsheet";
  return "text";
}

/**
 * Minimal valid nbformat v4 notebook. Jupyter owns all subsequent content;
 * Smart Notes only seeds an empty, openable notebook file.
 */
function emptyNotebookJson(): string {
  return JSON.stringify(
    {
      cells: [],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1
  );
}

function buildPageDocument(pagePath: string, source: string): VaultPageDocument {
  const { metadata, body } = parseFrontmatterDocument(source);
  return {
    path: toVaultRelativePath(pagePath),
    title: asNullableString(metadata.title) ?? titleFromPath(pagePath),
    body,
    createdAt: asNullableString(metadata.created),
    updatedAt: asNullableString(metadata.updated),
    metadata,
  };
}

function buildLinkedDesignDocument(
  pagePath: string,
  body: string,
  sidecar: DesignLinkSidecar,
  options?: { sourceMissing?: boolean }
): VaultPageDocument {
  const metadata = designLinkMetadataFromSidecar(sidecar);
  return {
    path: toVaultRelativePath(pagePath),
    title: sidecar.title || titleFromPath(pagePath),
    body,
    createdAt: sidecar.created,
    updatedAt: sidecar.updated,
    metadata,
    designLinked: true,
    sourceMissing: Boolean(options?.sourceMissing),
  };
}

function buildPageSummary(pagePath: string, source: string): VaultPageSummary {
  const page = buildPageDocument(pagePath, source);
  return {
    id: page.path,
    path: page.path,
    slug: slugFromPath(page.path),
    title: page.title,
    preview: stripHtml(page.body).slice(0, 180),
    content: page.body,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    parentId: asNullableString(page.metadata.parent_id),
    noteType: noteTypeFromMetadata(page.metadata.note_type),
    keyNote: isKeyNoteFlag(page.metadata.key_note),
    metadata: page.metadata,
  };
}

function buildLinkedDesignSummary(page: VaultPageDocument): VaultPageSummary {
  return {
    id: page.path,
    path: page.path,
    slug: slugFromPath(page.path),
    title: page.title,
    preview: page.sourceMissing
      ? "Linked design source is missing."
      : stripHtml(page.body).slice(0, 180),
    content: page.body,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    parentId: asNullableString(page.metadata.parent_id),
    noteType: "design",
    keyNote: isKeyNoteFlag(page.metadata.key_note),
    metadata: page.metadata,
    designLinked: true,
    sourceMissing: Boolean(page.sourceMissing),
  };
}

function resolveNotebookDisplayName(pagePath: string): string | undefined {
  const segments = toVaultRelativePath(pagePath).split("/").filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }
  return findPortableNotebookByPath(segments[0])?.name;
}

function pageLocationFromPath(pagePath: string, notebookName?: string) {
  const segments = toVaultRelativePath(pagePath).split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new VaultError("INVALID_PATH", "Page paths must resolve to notebook/page.html or notebook/section/page.html.");
  }

  if (segments.length === 2) {
    return {
      notebookPath: segments[0],
      notebookName: notebookName ?? resolveNotebookDisplayName(pagePath) ?? segments[0],
      sectionPath: null,
      sectionName: null,
    };
  }

  return {
    notebookPath: segments[0],
    notebookName: notebookName ?? resolveNotebookDisplayName(pagePath) ?? segments[0],
    sectionPath: `${segments[0]}/${segments[1]}`,
    sectionName: segments[1],
  };
}

export function toApiPageDocument(page: VaultPageDocument, notebookName?: string) {
  const summary = page.designLinked
    ? buildLinkedDesignSummary(page)
    : buildPageSummary(page.path, serializeFrontmatterDocument(page.metadata, page.body));
  // Portable notebooks (path prefix "+<id>/…") live at an external rootPath —
  // expose the real OS path so companions never invent vaultRoot+"/+id/…".
  let resolvedDiskPath: string | undefined;
  try {
    resolvedDiskPath = resolveVaultPath(page.path, "page").absolutePath;
  } catch {
    resolvedDiskPath = undefined;
  }
  return {
    ...summary,
    body: page.body,
    metadata: page.metadata,
    resolvedDiskPath,
    designLinked: Boolean(page.designLinked),
    sourceMissing: Boolean(page.sourceMissing),
    ...pageLocationFromPath(page.path, notebookName),
  };
}

interface WriteAtomicallyOptions {
  beforeRename?: (tempPath: string, targetPath: string) => Promise<void> | void;
}

async function renameFileAtomically(src: string, dest: string) {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EXDEV") {
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
          continue;
        }
        await fs.copyFile(src, dest);
        await fs.rm(src, { force: true });
        return;
      }
      throw err;
    }
  }
}

async function writeAtomically(
  targetPath: string,
  content: string,
  options: WriteAtomicallyOptions = {}
) {
  const directory = path.dirname(targetPath);
  const tempPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );

  await fs.writeFile(tempPath, content, "utf8");
  try {
    await options.beforeRename?.(tempPath, targetPath);
    await renameFileAtomically(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readPageSource(pagePath: string) {
  const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");

  let source: string;
  try {
    source = await fs.readFile(absolutePath, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new VaultError("PAGE_NOT_FOUND", `Page not found: ${relativePath}`, 404);
    }
    throw error;
  }

  return { source, absolutePath, relativePath };
}

/**
 * Load a page, preferring the SN-168 linked-design sidecar when present so the
 * ordinary HTML file is treated as the verbatim body (never frontmatter-wrapped).
 */
async function readPageDocument(pagePath: string): Promise<VaultPageDocument> {
  const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");
  const link = await readDesignLinkSidecar(absolutePath);

  if (link) {
    try {
      const body = await fs.readFile(absolutePath, "utf8");
      return buildLinkedDesignDocument(relativePath, body, link);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return buildLinkedDesignDocument(relativePath, "", link, { sourceMissing: true });
      }
      throw error;
    }
  }

  const { source } = await readPageSource(pagePath);
  return buildPageDocument(relativePath, source);
}

async function resolveAiAttachmentSource(sourcePath: string) {
  const absolutePath = path.resolve(sourcePath);
  if (!path.isAbsolute(absolutePath)) {
    throw new VaultError("INVALID_PATH", "Attachment source must be an absolute path.");
  }

  const extension = path.extname(absolutePath).toLowerCase();
  if (!SUPPORTED_AI_IMAGE_EXTENSIONS.has(extension)) {
    throw new VaultError("INVALID_PATH", "Only png, jpg, jpeg, gif, and svg attachments are supported.");
  }

  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new VaultError("PAGE_NOT_FOUND", `Attachment not found: ${sourcePath}`, 404);
  }

  return {
    absolutePath,
    extension,
    fileName: path.basename(absolutePath),
  };
}

async function uniqueAttachmentFileName(fileName: string) {
  const vaultRoot = getVaultRoot();
  const attachmentsDirectory = path.join(vaultRoot, "attachments");
  await fs.mkdir(attachmentsDirectory, { recursive: true });

  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension) || "attachment";

  let attempt = 0;
  while (true) {
    const candidateFileName = attempt === 0 ? fileName : `${stem}-${attempt + 1}${extension}`;
    const candidateAbsolutePath = path.join(attachmentsDirectory, candidateFileName);
    const exists = await fs.stat(candidateAbsolutePath).then(() => true).catch(() => false);
    if (!exists) {
      return {
        attachmentsDirectory,
        candidateAbsolutePath,
        candidateFileName,
      };
    }
    attempt += 1;
  }
}

async function listDirectories(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
}

function invalidPageSummary(relativePagePath: string): VaultPageSummary {
  return {
    id: relativePagePath,
    path: relativePagePath,
    slug: slugFromPath(relativePagePath),
    title: titleFromPath(relativePagePath),
    preview: "This page could not be parsed.",
    content: "",
    createdAt: null,
    updatedAt: null,
    hasFrontmatterError: true,
    parentId: null,
    noteType: "text",
    keyNote: false,
    metadata: {},
  };
}

async function readPageSummaryFromDisk(
  sectionAbsolutePath: string,
  logicalPathPrefix: string,
  pageEntry: { name: string }
): Promise<VaultPageSummary> {
  const absolutePagePath = path.join(sectionAbsolutePath, pageEntry.name);
  const relativePagePath = toVaultRelativePath(path.posix.join(logicalPathPrefix, pageEntry.name));
  try {
    const link = await readDesignLinkSidecar(absolutePagePath);
    if (link) {
      try {
        const body = await fs.readFile(absolutePagePath, "utf8");
        return buildLinkedDesignSummary(buildLinkedDesignDocument(relativePagePath, body, link));
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
          return buildLinkedDesignSummary(
            buildLinkedDesignDocument(relativePagePath, "", link, { sourceMissing: true })
          );
        }
        throw error;
      }
    }
    const source = await fs.readFile(absolutePagePath, "utf8");
    return buildPageSummary(relativePagePath, source);
  } catch (error) {
    console.warn("[smart-notes] skipped invalid page while building tree", error);
    return invalidPageSummary(relativePagePath);
  }
}

async function readSectionPageOrder(sectionAbsolutePath: string): Promise<string[]> {
  const orderFilePath = path.join(sectionAbsolutePath, PAGE_ORDER_FILE);
  try {
    const content = await fs.readFile(orderFilePath, "utf8");
    const data = JSON.parse(content) as { orderedIds?: unknown };
    if (Array.isArray(data.orderedIds)) {
      return data.orderedIds.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // No order file or parse error — fall back to alphabetical
  }
  return [];
}

async function writeSectionPageOrder(sectionAbsolutePath: string, orderedIds: string[]): Promise<void> {
  const orderFilePath = path.join(sectionAbsolutePath, PAGE_ORDER_FILE);
  await writeAtomically(orderFilePath, JSON.stringify({ orderedIds }, null, 2));
}

async function readSectionPages(
  sectionAbsolutePath: string,
  logicalPathPrefix: string,
  sequential: boolean
): Promise<VaultPageSummary[]> {
  const pageEntries = await fs.readdir(sectionAbsolutePath, { withFileTypes: true }).catch(() => []);
  const pageFiles = pageEntries.filter((entry) => entry.isFile() && isPageFileName(entry.name));
  const pageFileNames = new Set(pageFiles.map((entry) => entry.name.toLowerCase()));

  // Orphaned link sidecars (HTML deleted) still surface as missing-source design pages.
  const orphanLinkPages = pageEntries
    .filter((entry) => entry.isFile() && /\.design-link\.json$/i.test(entry.name))
    .map((entry) => entry.name.replace(/\.design-link\.json$/i, PAGE_FILE_EXTENSION))
    .filter((htmlName) => !pageFileNames.has(htmlName.toLowerCase()))
    .map((htmlName) => ({ name: htmlName }));

  const allPageEntries = [...pageFiles, ...orphanLinkPages];

  const pages = sequential
    ? await (async () => {
        const summaries: VaultPageSummary[] = [];
        for (const pageEntry of allPageEntries) {
          summaries.push(await readPageSummaryFromDisk(sectionAbsolutePath, logicalPathPrefix, pageEntry));
        }
        return summaries;
      })()
    : await Promise.all(
        allPageEntries.map((pageEntry) =>
          readPageSummaryFromDisk(sectionAbsolutePath, logicalPathPrefix, pageEntry)
        )
      );

  const orderedIds = await readSectionPageOrder(sectionAbsolutePath);
  if (orderedIds.length > 0) {
    const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
    pages.sort((a, b) => {
      const ia = orderMap.has(a.path) ? orderMap.get(a.path)! : Infinity;
      const ib = orderMap.has(b.path) ? orderMap.get(b.path)! : Infinity;
      if (ia !== ib) return ia - ib;
      return a.title.localeCompare(b.title);
    });
  } else {
    pages.sort((left, right) => left.title.localeCompare(right.title));
  }
  return pages;
}

function isNotebookSectionDirectoryName(name: string): boolean {
  const lower = name.toLowerCase();
  return !(
    lower.endsWith(".assets") ||
    lower.endsWith(".jupyter") ||
    lower === ".versions"
  );
}

function sortSections<T extends { name: string }>(sections: T[]) {
  sections.sort((left, right) => {
    if (left.name === INBOX_SECTION_NAME) return -1;
    if (right.name === INBOX_SECTION_NAME) return 1;
    return left.name.localeCompare(right.name);
  });
  return sections;
}

async function readNotebookSections(
  notebookAbsolutePath: string,
  notebookPathPrefix: string,
  sequential: boolean
) {
  const sectionEntries = (await listDirectories(notebookAbsolutePath)).filter((entry) =>
    isNotebookSectionDirectoryName(entry.name)
  );

  if (sequential) {
    const sections = [];
    for (const sectionEntry of sectionEntries) {
      const sectionAbsolutePath = path.join(notebookAbsolutePath, sectionEntry.name);
      const sectionPath = toVaultRelativePath(path.posix.join(notebookPathPrefix, sectionEntry.name));
      const pages = await readSectionPages(sectionAbsolutePath, sectionPath, sequential);
      sections.push({
        id: sectionPath,
        path: sectionPath,
        name: sectionEntry.name,
        pages,
      });
    }
    return sortSections(sections);
  }

  const sections = await Promise.all(
    sectionEntries.map(async (sectionEntry) => {
      const sectionAbsolutePath = path.join(notebookAbsolutePath, sectionEntry.name);
      const sectionPath = toVaultRelativePath(path.posix.join(notebookPathPrefix, sectionEntry.name));
      const pages = await readSectionPages(sectionAbsolutePath, sectionPath, sequential);
      return {
        id: sectionPath,
        path: sectionPath,
        name: sectionEntry.name,
        pages,
      };
    })
  );
  return sortSections(sections);
}

async function readNotebook(
  notebookEntry: { name: string },
  vaultRoot: string,
  sequential: boolean
): Promise<VaultNotebook> {
  const notebookAbsolutePath = path.join(vaultRoot, notebookEntry.name);
  const notebookPath = toVaultRelativePath(path.relative(vaultRoot, notebookAbsolutePath));
  const pages = await readSectionPages(notebookAbsolutePath, notebookPath, sequential);
  const sections = await readNotebookSections(notebookAbsolutePath, notebookPath, sequential);

  return {
    id: notebookPath,
    path: notebookPath,
    name: notebookEntry.name,
    color: NOTEBOOK_COLORS[0],
    pages,
    sections,
  };
}

async function readPortableNotebook(
  entry: { id: string; name: string; rootPath: string },
  sequential: boolean
): Promise<VaultNotebook> {
  const notebookPath = portableNotebookPath(entry.id);
  const pages = await readSectionPages(entry.rootPath, notebookPath, sequential);
  const sections = await readNotebookSections(entry.rootPath, notebookPath, sequential);

  return {
    id: notebookPath,
    path: notebookPath,
    name: entry.name,
    color: NOTEBOOK_COLORS[0],
    pages,
    sections,
    isPortable: true,
    rootPath: entry.rootPath,
  };
}

export async function readVaultTree(options: ReadVaultTreeOptions = {}) {
  const sequential = options.sequential ?? false;
  const skipCache = options.skipCache ?? false;

  if (!skipCache && _vaultTreeCache) {
    return _vaultTreeCache;
  }

  const vaultRoot = getVaultRoot();
  const notebookEntries = await listDirectories(vaultRoot);
  const primaryNotebooks = sequential
    ? await (async () => {
        const results: VaultNotebook[] = [];
        for (const notebookEntry of notebookEntries) {
          results.push(await readNotebook(notebookEntry, vaultRoot, sequential));
        }
        return results;
      })()
    : await Promise.all(
        notebookEntries.map((notebookEntry) => readNotebook(notebookEntry, vaultRoot, sequential))
      );

  const portableEntries = loadNotebookRegistry().notebooks.filter((entry) => {
    try {
      return Boolean(entry.rootPath);
    } catch {
      return false;
    }
  });

  const portableNotebooks = sequential
    ? await (async () => {
        const results: VaultNotebook[] = [];
        for (const entry of portableEntries) {
          try {
            results.push(await readPortableNotebook(entry, sequential));
          } catch (error) {
            console.warn("[smart-notes] skipped unavailable portable notebook", entry.rootPath, error);
          }
        }
        return results;
      })()
    : await Promise.all(
        portableEntries.map(async (entry) => {
          try {
            return await readPortableNotebook(entry, sequential);
          } catch (error) {
            console.warn("[smart-notes] skipped unavailable portable notebook", entry.rootPath, error);
            return null;
          }
        })
      ).then((results) => results.filter((notebook): notebook is VaultNotebook => notebook !== null));

  const notebooks = [...primaryNotebooks, ...portableNotebooks];

  notebooks.sort((left, right) => left.name.localeCompare(right.name));
  notebooks.forEach((notebook, index) => {
    notebook.color = NOTEBOOK_COLORS[index % NOTEBOOK_COLORS.length];
  });
  const result = { tree: notebooks, root: vaultRoot };
  if (!skipCache) {
    _vaultTreeCache = result;
  }
  return result;
}

export async function readPage(pagePath: string) {
  return readPageDocument(pagePath);
}

export interface SavePageInput {
  path: string;
  title: string;
  body: string;
}

export async function savePage(input: SavePageInput) {
  const { absolutePath, relativePath } = resolveVaultPath(input.path, "page");
  const existingLink = await readDesignLinkSidecar(absolutePath);
  const now = new Date().toISOString();

  if (existingLink) {
    const nextTitle = input.title.trim() || existingLink.title;
    // Linked designs write the artifact verbatim — never inject vault frontmatter.
    await writeAtomically(absolutePath, input.body);
    const nextLink: DesignLinkSidecar = {
      ...existingLink,
      title: nextTitle,
      updated: now,
      sourcePath: absolutePath,
    };
    await writeDesignLinkSidecar(absolutePath, nextLink);
    invalidateVaultCache();
    return buildLinkedDesignDocument(relativePath, input.body, nextLink);
  }

  const { source } = await readPageSource(input.path);
  const page = buildPageDocument(relativePath, source);

  const nextMetadata: FrontmatterData = {
    ...page.metadata,
    title: input.title.trim() || page.title,
    updated: now,
  };

  if (!nextMetadata.created) {
    nextMetadata.created = now;
  }

  const serialized = serializeFrontmatterDocument(nextMetadata, input.body);
  await writeAtomically(absolutePath, serialized);
  invalidateVaultCache();
  return buildPageDocument(relativePath, serialized);
}

export interface LinkDesignPageInput {
  /** Absolute path to an existing self-contained `.html` file on the backend host. */
  sourcePath: string;
  /** Optional display title; defaults to the HTML `<title>` or file stem. */
  title?: string;
  /**
   * Optional empty vault-owned design page to replace. The in-page link flow
   * uses this to adopt the already-indexed source HTML without leaving the
   * temporary empty design stub as a second tree entry.
   */
  replacePath?: string;
}

async function validateEmptyDesignReplacement(
  replacePath: string | undefined,
  targetPath: string
) {
  const trimmed = String(replacePath ?? "").trim();
  if (!trimmed) return null;

  const placeholder = await readPageDocument(trimmed);
  if (
    placeholder.metadata.note_type !== "design" ||
    placeholder.designLinked ||
    placeholder.body.trim()
  ) {
    throw new VaultError(
      "INVALID_INPUT",
      "Link from source can replace only an empty, unlinked design page.",
      400
    );
  }

  const placeholderNotebook = placeholder.path.split("/")[0];
  const targetNotebook = targetPath.split("/")[0];
  if (!placeholderNotebook || placeholderNotebook !== targetNotebook) {
    throw new VaultError(
      "INVALID_PATH",
      "The linked HTML must be inside the same portable notebook as the design page.",
      400
    );
  }

  if (placeholder.path.toLowerCase() === targetPath.toLowerCase()) {
    throw new VaultError("INVALID_INPUT", "The selected HTML is already the current design page.", 400);
  }
  return placeholder;
}

/**
 * Link an existing ordinary HTML file inside a portable-notebook root as a
 * design page (SN-168). Creates only `.design-link.json` metadata — never
 * copies or rewrites the HTML. When invoked from an empty Design page, removes
 * that disposable vault-owned stub after the source is linked so the tree
 * contains one design entry, not the stub plus the already-indexed HTML.
 */
export async function linkDesignPage(input: LinkDesignPageInput) {
  const target = await resolveDesignLinkTarget(input.sourcePath);
  const placeholder = await validateEmptyDesignReplacement(input.replacePath, target.relativePath);
  const existing = await readDesignLinkSidecar(target.absolutePath);
  if (existing) {
    const body = await fs.readFile(target.absolutePath, "utf8");
    if (placeholder) {
      await deletePage(placeholder.path);
      invalidateVaultCache();
      emitVaultSideEffects({ treeChanged: true });
    }
    return buildLinkedDesignDocument(target.relativePath, body, existing);
  }

  // Reject linking a vault-owned page that already carries Smart Notes frontmatter
  // note_type — those are created designs, not ordinary linked artifacts.
  const raw = await fs.readFile(target.absolutePath, "utf8");
  const { metadata } = parseFrontmatterDocument(raw);
  if (metadata.note_type === "design" || metadata.note_type === "ink" || metadata.note_type === "log" || metadata.note_type === "jupyter" || metadata.note_type === "app" || metadata.note_type === "spreadsheet") {
    throw new VaultError(
      "INVALID_INPUT",
      "That HTML file is already a Smart Notes page with vault frontmatter. Link only ordinary self-contained HTML designs.",
      400
    );
  }

  const now = new Date().toISOString();
  const title =
    String(input.title ?? "").trim() || titleFromHtmlArtifact(raw, target.fileName);
  const sidecar: DesignLinkSidecar = {
    version: 1,
    note_type: "design",
    linked: true,
    title,
    created: now,
    updated: now,
    sourcePath: target.absolutePath,
  };
  await writeDesignLinkSidecar(target.absolutePath, sidecar);
  if (placeholder) {
    try {
      await deletePage(placeholder.path);
    } catch (error) {
      await removeDesignLinkSidecar(target.absolutePath).catch(() => undefined);
      throw error;
    }
  }
  invalidateVaultCache();
  emitVaultSideEffects({ treeChanged: true });
  return buildLinkedDesignDocument(target.relativePath, raw, sidecar);
}

export interface RelinkDesignPageInput {
  /** Vault-relative path of the existing linked design (may be missing-source). */
  path: string;
  /** Absolute path to the replacement self-contained `.html` file. */
  sourcePath: string;
  title?: string;
}

function sidecarFromPreviousLink(
  previousLink: DesignLinkSidecar | null,
  next: { title: string; sourcePath: string; created?: string | null; updated: string }
): DesignLinkSidecar {
  return {
    ...(previousLink ?? {}),
    version: 1,
    note_type: "design",
    linked: true,
    title: next.title,
    created: previousLink?.created ?? next.created ?? next.updated,
    updated: next.updated,
    sourcePath: next.sourcePath,
  };
}

/**
 * Point an existing linked-design entry at a different HTML file inside a
 * portable-notebook root. Moves SN sidecars to the new stem and removes the
 * old link sidecar — still never copies the HTML artifact.
 */
export async function relinkDesignPage(input: RelinkDesignPageInput) {
  const previous = await readPageDocument(input.path);
  if (!previous.designLinked) {
    throw new VaultError("INVALID_INPUT", "Only linked design pages can be relinked.", 400);
  }

  const target = await resolveDesignLinkTarget(input.sourcePath);
  const previousResolved = resolveVaultPath(previous.path, "page");
  const previousAbsolute = previousResolved.absolutePath;
  const previousLink = await readDesignLinkSidecar(previousAbsolute);

  if (path.resolve(previousAbsolute) === path.resolve(target.absolutePath)) {
    const body = await fs.readFile(target.absolutePath, "utf8");
    const now = new Date().toISOString();
    const nextTitle =
      String(input.title ?? "").trim() || previous.title || titleFromHtmlArtifact(body, target.fileName);
    const sidecar = sidecarFromPreviousLink(previousLink, {
      title: nextTitle,
      sourcePath: target.absolutePath,
      created: previous.createdAt,
      updated: now,
    });
    await writeDesignLinkSidecar(target.absolutePath, sidecar);
    invalidateVaultCache();
    return buildLinkedDesignDocument(target.relativePath, body, sidecar);
  }

  const alreadyLinked = await readDesignLinkSidecar(target.absolutePath);
  if (alreadyLinked) {
    throw new VaultError(
      "PAGE_EXISTS",
      "That HTML file is already linked as a design page.",
      409
    );
  }

  const raw = await fs.readFile(target.absolutePath, "utf8");
  const { metadata } = parseFrontmatterDocument(raw);
  if (metadata.note_type === "design" || metadata.note_type === "ink" || metadata.note_type === "log" || metadata.note_type === "jupyter") {
    throw new VaultError(
      "INVALID_INPUT",
      "That HTML file is already a Smart Notes page with vault frontmatter.",
      400
    );
  }

  const now = new Date().toISOString();
  const nextTitle =
    String(input.title ?? "").trim() || previous.title || titleFromHtmlArtifact(raw, target.fileName);
  const sidecar = sidecarFromPreviousLink(previousLink, {
    title: nextTitle,
    sourcePath: target.absolutePath,
    created: previous.createdAt,
    updated: now,
  });

  // Move SN-owned sidecars to the new stem; leave the old HTML untouched.
  for (const extension of [
    ".annotations.json",
    ".companion.json",
    ".ref.json",
  ] as const) {
    await moveSidecarIfPresent(previousAbsolute, target.absolutePath, extension).catch(() => undefined);
  }

  await writeDesignLinkSidecar(target.absolutePath, sidecar);
  await removeDesignLinkSidecar(previousAbsolute);
  invalidateVaultCache();
  emitVaultSideEffects({ treeChanged: true });
  return buildLinkedDesignDocument(target.relativePath, raw, sidecar);
}

/** Remove link metadata (and SN sidecars) while leaving the HTML ground truth on disk. */
export async function unlinkDesignPage(pagePath: string) {
  const page = await readPageDocument(pagePath);
  if (!page.designLinked) {
    throw new VaultError("INVALID_INPUT", "Only linked design pages can be unlinked.", 400);
  }
  const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");
  await removeDesignLinkSidecar(absolutePath);
  await fs.rm(absolutePath.replace(/\.html$/i, ".annotations.json"), { force: true });
  await fs.rm(absolutePath.replace(/\.html$/i, ".companion.json"), { force: true });
  await fs.rm(absolutePath.replace(/\.html$/i, ".ref.json"), { force: true });
  const assetDirectory = resolveVaultPath(siblingAssetDirectory(relativePath), "section");
  const hasAssets = await fs.stat(assetDirectory.absolutePath).then(() => true).catch(() => false);
  if (hasAssets) {
    await fs.rm(assetDirectory.absolutePath, { recursive: true, force: true });
  }
  invalidateVaultCache();
  emitVaultSideEffects({ treeChanged: true });
  return { path: relativePath, sourcePath: absolutePath };
}

// ---------------------------------------------------------------------------
// Ink scene operations
// Ink notes store their Tldraw scene as a JSON sidecar file adjacent to the .html stub:
//   Notebook/Section/Page.html
//   Notebook/Section/Page.ink.json
// ---------------------------------------------------------------------------

function inkSidecarPath(pagePath: string) {
  return inkSidecarRelativePath(pagePath);
}

export type InkBackgroundMode = "blank" | "grid";

interface InkSidecar {
  scene: unknown;
  inkMeta: { backgroundMode: InkBackgroundMode };
}

function parseInkSidecar(data: unknown): { scene: unknown; backgroundMode: InkBackgroundMode } {
  if (!data || typeof data !== "object") return { scene: null, backgroundMode: "blank" };
  // Migration: old format stores the raw Tldraw snapshot (has `document` at top level).
  if ("document" in (data as Record<string, unknown>)) {
    return { scene: data, backgroundMode: "blank" };
  }
  const sidecar = data as Partial<InkSidecar>;
  return {
    scene: sidecar.scene ?? null,
    backgroundMode: sidecar.inkMeta?.backgroundMode === "grid" ? "grid" : "blank",
  };
}

export async function readInkScene(pagePath: string): Promise<{ scene: unknown; backgroundMode: InkBackgroundMode }> {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  const sidecarPath = absolutePath.replace(/\.html$/i, ".ink.json");
  try {
    const raw = await fs.readFile(sidecarPath, "utf8");
    return parseInkSidecar(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { scene: null, backgroundMode: "blank" };
    }
    throw error;
  }
}

export async function saveInkScene(
  pagePath: string,
  scene: unknown,
  backgroundMode: InkBackgroundMode = "blank"
): Promise<void> {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  const sidecarAbsPath = absolutePath.replace(/\.html$/i, ".ink.json");
  const sidecar: InkSidecar = { scene, inkMeta: { backgroundMode } };
  await writeAtomically(sidecarAbsPath, JSON.stringify(sidecar));
}

export async function deleteInkScene(pagePath: string): Promise<void> {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  const sidecarAbsPath = absolutePath.replace(/\.html$/i, ".ink.json");
  await fs.rm(sidecarAbsPath, { force: true });
}

// ---------------------------------------------------------------------------
// Text-page annotation scene operations
// Stored as <page-stem>.annotations.json adjacent to the .html page file.
// ---------------------------------------------------------------------------

function parseAnnotationsSidecar(data: unknown): { scene: unknown; drawableBottom?: number } {
  if (!data || typeof data !== "object") return { scene: null };
  if ("document" in (data as Record<string, unknown>)) {
    return { scene: data };
  }
  const sidecar = data as { scene?: unknown; drawableBottom?: unknown };
  const drawableBottom =
    typeof sidecar.drawableBottom === "number" && Number.isFinite(sidecar.drawableBottom)
      ? Math.ceil(sidecar.drawableBottom)
      : undefined;
  return { scene: sidecar.scene ?? null, drawableBottom };
}

export async function readAnnotationsScene(
  pagePath: string
): Promise<{ scene: unknown; drawableBottom?: number }> {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  const sidecarPath = absolutePath.replace(/\.html$/i, ".annotations.json");
  try {
    const raw = await fs.readFile(sidecarPath, "utf8");
    return parseAnnotationsSidecar(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { scene: null };
    }
    throw error;
  }
}

export async function saveAnnotationsScene(
  pagePath: string,
  scene: unknown,
  options?: { drawableBottom?: number }
): Promise<void> {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  const sidecarAbsPath = absolutePath.replace(/\.html$/i, ".annotations.json");
  const sidecar: { scene: unknown; drawableBottom?: number } = { scene };
  if (options?.drawableBottom != null && Number.isFinite(options.drawableBottom)) {
    sidecar.drawableBottom = Math.ceil(options.drawableBottom);
  }
  await writeAtomically(sidecarAbsPath, JSON.stringify(sidecar));
}

export async function deleteAnnotationsScene(pagePath: string): Promise<void> {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  const sidecarAbsPath = absolutePath.replace(/\.html$/i, ".annotations.json");
  await fs.rm(sidecarAbsPath, { force: true });
}

// ---------------------------------------------------------------------------
// Companion session operations (SN-80, SN-202)
// Page-owned history lives beside the page as <page-stem>.companion.json.
// Shared notebook-section history lives inside the section directory as
// .companion.json. The store path therefore identifies the conversation owner,
// instead of always identifying the page currently displayed.
// ---------------------------------------------------------------------------

function parseCompanionSidecar(data: unknown): { scopes: Record<string, unknown> } {
  if (!data || typeof data !== "object") {
    return { scopes: {} };
  }
  const scopes = (data as { scopes?: unknown }).scopes;
  if (scopes && typeof scopes === "object") {
    return { scopes: scopes as Record<string, unknown> };
  }
  return { scopes: {} };
}

function companionSidecarPath(storePath: string) {
  const isPageStore = /\.html$/i.test(storePath);
  const { absolutePath } = resolveVaultPath(storePath, isPageStore ? "page" : "section");
  return isPageStore
    ? absolutePath.replace(/\.html$/i, ".companion.json")
    : path.join(absolutePath, ".companion.json");
}

export async function readCompanionSessions(storePath: string): Promise<{ scopes: Record<string, unknown> }> {
  const sidecarPath = companionSidecarPath(storePath);
  try {
    const raw = await fs.readFile(sidecarPath, "utf8");
    return parseCompanionSidecar(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { scopes: {} };
    }
    throw error;
  }
}

export async function saveCompanionSessions(
  storePath: string,
  scopes: Record<string, unknown>
): Promise<void> {
  const sidecarAbsPath = companionSidecarPath(storePath);
  // An empty thread map means there is nothing to persist; remove the sidecar
  // so cleared/disposed conversations do not leave a stale file behind.
  if (!scopes || Object.keys(scopes).length === 0) {
    await fs.rm(sidecarAbsPath, { force: true });
    return;
  }
  const sidecar = { version: 1, scopes };
  await writeAtomically(sidecarAbsPath, JSON.stringify(sidecar));
}

export async function deleteCompanionSessions(storePath: string): Promise<void> {
  await fs.rm(companionSidecarPath(storePath), { force: true });
}

// ---------------------------------------------------------------------------
// Reference metadata operations
// Ingested references store bibliographic metadata as <page-stem>.ref.json.
// ---------------------------------------------------------------------------

export type ReferenceType = "article" | "paper" | "web" | "email";

export interface ReferenceSidecar {
  version: 1;
  sourceUrl: string;
  type: ReferenceType;
  tags: string[];
  author?: string;
  publishedDate?: string;
  email?: {
    messageId: string | null;
    sender: string;
    recipients: string[];
    receivedAt: string | null;
    originalSubject: string;
    routing: {
      requestedPrefix: string | null;
      matchedNotebookPath: string | null;
      fallbackReason: "no-prefix" | "empty-prefix" | "empty-title" | "unresolved" | "ambiguous" | null;
    };
    ignoredAttachmentCount: number;
    dedupeKind: "message-id" | "raw-mime-sha256";
  };
}

export async function saveReferenceSidecar(
  pagePath: string,
  reference: Omit<ReferenceSidecar, "version">
): Promise<ReferenceSidecar> {
  const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");
  const sidecarAbsPath = path.join(
    path.dirname(absolutePath),
    path.posix.basename(referenceSidecarRelativePath(relativePath))
  );
  const sidecar: ReferenceSidecar = {
    version: 1,
    sourceUrl: reference.sourceUrl,
    type: reference.type,
    tags: reference.tags,
    ...(reference.author ? { author: reference.author } : {}),
    ...(reference.publishedDate ? { publishedDate: reference.publishedDate } : {}),
    ...(reference.email ? { email: reference.email } : {}),
  };
  await writeAtomically(sidecarAbsPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  return sidecar;
}

// ---------------------------------------------------------------------------
// Log operations (SN-144)
// Form-backed log pages store row records in `<page-stem>.log.json` and the
// JSON Forms script in sibling `<page-stem>.form.json`. Form | Table | Source
// share the same row store; Source edits the form script.
// ---------------------------------------------------------------------------

type LogSidecarExtension = ".log.json" | ".form.json";

function logSidecarAbsolutePath(pagePath: string, extension: LogSidecarExtension = ".log.json") {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  return absolutePath.replace(/\.html$/i, extension);
}

/** Read + normalize a log page's schema+rows sidecar. Missing file → default. */
export async function readLogDocument(pagePath: string): Promise<LogDocument> {
  const sidecarPath = logSidecarAbsolutePath(pagePath, ".log.json");
  try {
    const raw = await fs.readFile(sidecarPath, "utf8");
    return normalizeLogDocument(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT" || error instanceof SyntaxError) {
      return defaultLogDocument();
    }
    throw error;
  }
}

async function writeLogDocument(pagePath: string, document: LogDocument): Promise<LogDocument> {
  const sidecarPath = logSidecarAbsolutePath(pagePath, ".log.json");
  const normalized = normalizeLogDocument(document);
  await writeAtomically(sidecarPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

const logMutationQueues = new Map<string, Promise<void>>();

/**
 * Serialize read/replace mutations for one `.log.json` sidecar. Atomic rename
 * protects readers from partial files, but this queue also prevents two
 * successful writers from both reading the same old document and dropping one
 * another's changes. Different page sidecars keep independent queues.
 */
async function withLogMutationLock<T>(pagePath: string, run: () => Promise<T>): Promise<T> {
  const key = logSidecarAbsolutePath(pagePath, ".log.json");
  const previous = logMutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  logMutationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (logMutationQueues.get(key) === queued) {
      logMutationQueues.delete(key);
    }
  }
}

/**
 * Read the JSON Forms script for a log page. Missing `.form.json` is derived
 * from the flat `.log.json` schema so older logs keep working.
 */
export async function readLogFormDefinition(pagePath: string): Promise<LogFormDefinition> {
  const sidecarPath = logSidecarAbsolutePath(pagePath, ".form.json");
  try {
    const raw = await fs.readFile(sidecarPath, "utf8");
    return normalizeLogFormDefinition(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      const document = await readLogDocument(pagePath);
      return formDefinitionFromFields(document.schema.fields);
    }
    if (error instanceof SyntaxError) return defaultLogFormDefinition();
    throw error;
  }
}

async function writeLogFormDefinition(
  pagePath: string,
  definition: LogFormDefinition
): Promise<LogFormDefinition> {
  const sidecarPath = logSidecarAbsolutePath(pagePath, ".form.json");
  const normalized = normalizeLogFormDefinition(definition);
  await writeAtomically(sidecarPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

/**
 * Replace the JSON Forms script. Projects top-level schema properties into the
 * flat `.log.json` field list and reshapes existing rows to match.
 */
export async function saveLogFormDefinition(
  pagePath: string,
  rawForm: unknown
): Promise<{ document: LogDocument; form: LogFormDefinition }> {
  return withLogMutationLock(pagePath, async () => {
    let validated: LogFormDefinition;
    try {
      validated = validateLogFormDefinitionForWrite(rawForm);
    } catch (error) {
      throw new VaultError(
        "INVALID_LOG_VIEW",
        error instanceof Error ? error.message : "The log form or saved views are invalid.",
        400
      );
    }
    const form = await writeLogFormDefinition(pagePath, validated);
    const fields = fieldsFromJsonSchema(form.schema);
    const current = await readLogDocument(pagePath);
    const rows: LogRow[] = current.rows.map((row) => ({
      ...row,
      values: coerceRowValues(fields, row.values),
    }));
    const document = await writeLogDocument(pagePath, { version: 1, schema: { fields }, rows });
    return { document, form };
  });
}

/**
 * Replace the flat schema (legacy / tests). Also rewrites `.form.json` so Form
 * and Source stay aligned with Table columns.
 */
export async function saveLogSchema(pagePath: string, rawFields: unknown): Promise<LogDocument> {
  return withLogMutationLock(pagePath, async () => {
    const current = await readLogDocument(pagePath);
    const fields: LogField[] = normalizeFields(rawFields);
    const rows: LogRow[] = current.rows.map((row) => ({
      ...row,
      values: coerceRowValues(fields, row.values),
    }));
    const document = await writeLogDocument(pagePath, { version: 1, schema: { fields }, rows });
    await writeLogFormDefinition(pagePath, formDefinitionFromFields(fields));
    return document;
  });
}

/** Append a row (Form submit). Values are coerced to the schema's field types. */
export async function appendLogRow(
  pagePath: string,
  rawValues: Record<string, unknown>,
  options: { rowId?: string; createdAt?: string } = {}
): Promise<{ document: LogDocument; row: LogRow; created: boolean }> {
  return withLogMutationLock(pagePath, async () => {
    const current = await readLogDocument(pagePath);
    if (options.rowId) {
      const existing = current.rows.find((candidate) => candidate.id === options.rowId);
      if (existing) {
        return { document: current, row: existing, created: false };
      }
    }
    const now = new Date().toISOString();
    const row: LogRow = {
      id: options.rowId ?? makeLogId("r"),
      createdAt: options.createdAt ?? now,
      values: coerceRowValues(current.schema.fields, rawValues),
    };
    const document = await writeLogDocument(pagePath, {
      ...current,
      rows: [...current.rows, row],
    });
    const persisted = document.rows.find((candidate) => candidate.id === row.id) ?? row;
    return { document, row: persisted, created: true };
  });
}

/** Update an existing row (Table inline edit / correction). */
export async function updateLogRow(
  pagePath: string,
  rowId: string,
  rawValues: Record<string, unknown>
): Promise<{ document: LogDocument; row: LogRow }> {
  return withLogMutationLock(pagePath, async () => {
    const current = await readLogDocument(pagePath);
    const index = current.rows.findIndex((candidate) => candidate.id === rowId);
    if (index === -1) {
      throw new VaultError("LOG_ROW_NOT_FOUND", `Log row not found: ${rowId}`, 404);
    }
    const updated: LogRow = {
      ...current.rows[index],
      values: coerceRowValues(current.schema.fields, rawValues),
      updatedAt: new Date().toISOString(),
    };
    const rows = [...current.rows];
    rows[index] = updated;
    const document = await writeLogDocument(pagePath, { ...current, rows });
    const persisted = document.rows.find((candidate) => candidate.id === rowId) ?? updated;
    return { document, row: persisted };
  });
}

/** Delete a row from the Table tab. */
export async function deleteLogRow(pagePath: string, rowId: string): Promise<LogDocument> {
  return withLogMutationLock(pagePath, async () => {
    const current = await readLogDocument(pagePath);
    const rows = current.rows.filter((candidate) => candidate.id !== rowId);
    return writeLogDocument(pagePath, { ...current, rows });
  });
}

async function moveSidecarIfPresent(
  srcAbsolutePagePath: string,
  destAbsolutePagePath: string,
  extension:
    | ".ink.json"
    | ".annotations.json"
    | ".companion.json"
    | ".ref.json"
    | ".log.json"
    | ".form.json"
    | ".design-link.json"
    | ".app.json"
    | ".spreadsheet.json"
): Promise<boolean> {
  const srcSidecar = srcAbsolutePagePath.replace(/\.html$/i, extension);
  const destSidecar = destAbsolutePagePath.replace(/\.html$/i, extension);
  const hasSidecar = await fs.stat(srcSidecar).then(() => true).catch(() => false);
  if (hasSidecar) {
    await fs.rename(srcSidecar, destSidecar);
    return true;
  }
  return false;
}

async function listAppDataSidecars(absolutePagePath: string): Promise<string[]> {
  const directory = path.dirname(absolutePagePath);
  const stem = path.basename(absolutePagePath).replace(/\.html$/i, "");
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name === `${stem}.app.json` || name.startsWith(`${stem}.app-data.`) && name.endsWith(".json"));
}

/** Move the manifest and every dynamic app-owned table as one rollback-safe set. */
async function moveAppDataSidecars(srcPagePath: string, destPagePath: string): Promise<string[]> {
  const sourceNames = await listAppDataSidecars(srcPagePath);
  if (sourceNames.length === 0) return [];
  const srcDir = path.dirname(srcPagePath);
  const destDir = path.dirname(destPagePath);
  const srcStem = path.basename(srcPagePath).replace(/\.html$/i, "");
  const destStem = path.basename(destPagePath).replace(/\.html$/i, "");
  const suffixes = sourceNames.map((name) => name.slice(srcStem.length));
  for (const suffix of suffixes) {
    const collision = await fs.stat(path.join(destDir, `${destStem}${suffix}`)).then(() => true).catch(() => false);
    if (collision) throw new VaultError("PAGE_EXISTS", `App data already exists at the destination (${suffix}).`, 409);
  }
  const moved: string[] = [];
  try {
    for (const suffix of suffixes) {
      await fs.rename(path.join(srcDir, `${srcStem}${suffix}`), path.join(destDir, `${destStem}${suffix}`));
      moved.push(suffix);
    }
    return moved;
  } catch (error) {
    for (const suffix of [...moved].reverse()) {
      await fs.rename(path.join(destDir, `${destStem}${suffix}`), path.join(srcDir, `${srcStem}${suffix}`)).catch(() => undefined);
    }
    throw error;
  }
}

async function restoreMovedAppDataSidecars(srcPagePath: string, destPagePath: string, suffixes: string[]): Promise<void> {
  const srcDir = path.dirname(srcPagePath);
  const destDir = path.dirname(destPagePath);
  const srcStem = path.basename(srcPagePath).replace(/\.html$/i, "");
  const destStem = path.basename(destPagePath).replace(/\.html$/i, "");
  for (const suffix of [...suffixes].reverse()) {
    await fs.rename(path.join(destDir, `${destStem}${suffix}`), path.join(srcDir, `${srcStem}${suffix}`));
  }
}

async function removeAppDataSidecars(absolutePagePath: string): Promise<void> {
  const directory = path.dirname(absolutePagePath);
  for (const name of await listAppDataSidecars(absolutePagePath)) {
    await fs.rm(path.join(directory, name), { force: true });
  }
}

/**
 * Relocate a Jupyter note's `.jupyter` working-directory folder alongside a
 * page rename/move. Throws COLLISION if the destination folder already exists.
 */
async function moveJupyterDirIfPresent(
  srcAbsolutePagePath: string,
  destAbsolutePagePath: string
): Promise<boolean> {
  const srcDir = srcAbsolutePagePath.replace(/\.html$/i, ".jupyter");
  const destDir = destAbsolutePagePath.replace(/\.html$/i, ".jupyter");
  const hasDir = await fs.stat(srcDir).then((s) => s.isDirectory()).catch(() => false);
  if (!hasDir) {
    return false;
  }
  const collision = await fs.stat(destDir).then(() => true).catch(() => false);
  if (collision) {
    throw new VaultError(
      "JUPYTER_DIR_COLLISION",
      "Cannot move page because the destination notebook folder already exists.",
      409
    );
  }
  await renameDirectory(srcDir, destDir);
  return true;
}

async function restoreMovedDirectory(destAbsolutePath: string, srcAbsolutePath: string) {
  const destExists = await fs.stat(destAbsolutePath).then((stat) => stat.isDirectory()).catch(() => false);
  const srcExists = await fs.stat(srcAbsolutePath).then(() => true).catch(() => false);
  if (destExists && !srcExists) {
    await renameDirectory(destAbsolutePath, srcAbsolutePath);
  }
}

async function removeFileIfStillOrphaned(filePath: string, protectedPath: string) {
  if (filePath === protectedPath) {
    return;
  }
  await fs.rm(filePath, { force: true }).catch(() => undefined);
}

async function stopJupyterSessionForPageIfNeeded(page: VaultPageDocument): Promise<void> {
  if (page.metadata.note_type !== "jupyter") {
    return;
  }
  await stopJupyterSession(page.path);
}

export interface CreatePageInput {
  sectionPath?: string | null;
  notebookPath?: string | null;
  title: string;
  noteType?: NoteType;
  parentId?: string | null;
}

export interface ImportDocxPageInput {
  sectionPath: string;
  fileName: string;
  buffer: Buffer;
  sourceUrl?: string;
  publishedUrl?: string;
}

export interface ExportDocxPageInput {
  path: string;
  title?: string;
  bodyHtml?: string;
}

function sanitizeImportedAssetFileName(fileName: string) {
  const base = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return base || "image.png";
}

async function uniqueImportedAssetFileName(directory: string, fileName: string) {
  const safeName = sanitizeImportedAssetFileName(fileName);
  const extension = path.extname(safeName);
  const stem = path.basename(safeName, extension) || "image";
  let attempt = 0;

  while (true) {
    const candidate = attempt === 0 ? safeName : `${stem}-${attempt + 1}${extension || ".png"}`;
    const exists = await fs.stat(path.join(directory, candidate)).then(() => true).catch(() => false);
    if (!exists) return candidate;
    attempt += 1;
  }
}

export async function createPage(input: CreatePageInput) {
  const title = input.title.trim() || "Untitled page";
  const parentId = input.parentId ?? null;

  let containerAbsolutePath: string;
  let containerRelativePath: string;

  if (parentId) {
    const parent = await readPage(parentId);
    const parentDirectory = toVaultRelativePath(path.posix.dirname(parent.path));

    if (input.sectionPath && input.sectionPath !== parentDirectory) {
      throw new VaultError(
        "INVALID_PARENT",
        "Nested pages must be created in the same section as their parent.",
        400
      );
    }

    // The parent path already determines the container (used below). The
    // client-supplied notebookPath is only the top-level notebook, so require
    // the parent to live *within* that notebook rather than be an exact match —
    // otherwise section-nested parents (parentDirectory = "Notebook/Section")
    // always fail the equality check even though they are valid children.
    if (
      input.notebookPath &&
      parentDirectory !== input.notebookPath &&
      !parentDirectory.startsWith(`${input.notebookPath}/`)
    ) {
      throw new VaultError(
        "INVALID_PARENT",
        "Nested pages must be created in the same notebook as their parent.",
        400
      );
    }

    const parentDepth = await computePageDepth(parentId);
    if (parentDepth >= 2) {
      throw new VaultError("DEPTH_CAP", "Page nesting cannot exceed 2 levels deep.", 400);
    }

    const parentDirectoryKind = parentDirectory.split("/").filter(Boolean).length === 1 ? "notebook" : "section";
    const container = resolveVaultPath(parentDirectory, parentDirectoryKind);
    containerAbsolutePath = container.absolutePath;
    containerRelativePath = container.relativePath;
  } else if (input.sectionPath) {
    const section = resolveVaultPath(input.sectionPath, "section");
    containerAbsolutePath = section.absolutePath;
    containerRelativePath = section.relativePath;
  } else if (input.notebookPath) {
    const notebook = resolveVaultPath(input.notebookPath, "notebook");
    containerAbsolutePath = notebook.absolutePath;
    containerRelativePath = notebook.relativePath;
  } else {
    throw new VaultError("INVALID_PATH", "\"sectionPath\" or \"notebookPath\" is required.", 400);
  }

  const containerStat = await fs.stat(containerAbsolutePath).catch(() => null);
  if (!containerStat?.isDirectory()) {
    const isRootTarget = !input.sectionPath && Boolean(input.notebookPath);
    throw new VaultError(
      isRootTarget ? "NOTEBOOK_NOT_FOUND" : "SECTION_NOT_FOUND",
      `${isRootTarget ? "Notebook" : "Section"} not found: ${containerRelativePath}`,
      404
    );
  }

  const desiredFileName = fileNameFromTitle(title);
  let fileName = desiredFileName;
  let counter = 2;

  while (true) {
    const candidatePath = path.join(containerAbsolutePath, fileName);
    const exists = await fs.stat(candidatePath).then(() => true).catch(() => false);
    if (!exists) {
      break;
    }

    const stem = desiredFileName.replace(/\.html$/i, "");
    fileName = `${stem}-${counter}${PAGE_FILE_EXTENSION}`;
    counter += 1;
  }

  const now = new Date().toISOString();
  const relativePath = toVaultRelativePath(path.posix.join(containerRelativePath, fileName));
  const noteType: NoteType = input.noteType ?? "text";
  const metadata: FrontmatterData = {
    title,
    created: now,
    updated: now,
    ...(noteType !== "text" ? { note_type: noteType } : {}),
    ...(parentId ? { parent_id: parentId } : {}),
  };
  const serialized = serializeFrontmatterDocument(metadata, "");
  await writeAtomically(path.join(containerAbsolutePath, fileName), serialized);

  // Jupyter notes are backed by a sibling working-directory folder containing a
  // seed notebook. Jupyter owns all notebook content thereafter; Smart Notes
  // only guarantees an openable folder + .ipynb exist.
  if (noteType === "jupyter") {
    const jupyterDirAbsolute = path.join(containerAbsolutePath, fileName).replace(/\.html$/i, ".jupyter");
    await fs.mkdir(jupyterDirAbsolute, { recursive: true });
    const notebookAbsolute = path.join(jupyterDirAbsolute, JUPYTER_NOTEBOOK_FILE_NAME);
    const notebookExists = await fs.stat(notebookAbsolute).then(() => true).catch(() => false);
    if (!notebookExists) {
      await writeAtomically(notebookAbsolute, emptyNotebookJson());
    }
  }

  // Log notes are backed by sibling `.log.json` (rows) and `.form.json` (JSON
  // Forms script) sidecars. The .html stub only carries frontmatter.
  if (noteType === "log") {
    const logSidecarAbsolute = path.join(containerAbsolutePath, fileName).replace(/\.html$/i, ".log.json");
    const formSidecarAbsolute = path.join(containerAbsolutePath, fileName).replace(/\.html$/i, ".form.json");
    const logExists = await fs.stat(logSidecarAbsolute).then(() => true).catch(() => false);
    if (!logExists) {
      await writeAtomically(logSidecarAbsolute, `${JSON.stringify(defaultLogDocument(), null, 2)}\n`);
    }
    const formExists = await fs.stat(formSidecarAbsolute).then(() => true).catch(() => false);
    if (!formExists) {
      await writeAtomically(
        formSidecarAbsolute,
        `${JSON.stringify(defaultLogFormDefinition(), null, 2)}\n`
      );
    }
  }

  if (noteType === "spreadsheet") {
    await writeSpreadsheetWorkbook(relativePath, createEmptySpreadsheetWorkbook());
  }

  invalidateVaultCache();
  return buildPageDocument(relativePath, serialized);
}

export async function importPageFromDocx(input: ImportDocxPageInput) {
  const parsed = await parseDocxBuffer(input.buffer, input.fileName);
  const created = await createPage({
    sectionPath: input.sectionPath,
    title: parsed.title,
  });

  const assetsRelative = siblingAssetDirectory(created.path);
  const { absolutePath: assetsAbsolutePath } = resolveVaultPath(assetsRelative, "section");
  const replacements = new Map<string, string>();

  if (parsed.images.length > 0) {
    await fs.mkdir(assetsAbsolutePath, { recursive: true });
  }

  for (const image of parsed.images) {
    const storedName = await uniqueImportedAssetFileName(assetsAbsolutePath, image.fileName);
    await fs.writeFile(path.join(assetsAbsolutePath, storedName), image.buffer);
    const assetRelative = toVaultRelativePath(path.posix.join(assetsRelative, storedName));
    const assetUrl = `/vault/${assetRelative.split("/").map(encodeURIComponent).join("/")}`;
    replacements.set(image.placeholder, assetUrl);
  }

  let body = parsed.bodyHtml;
  for (const [placeholder, assetUrl] of replacements) {
    body = body.split(placeholder).join(assetUrl);
  }

  const { absolutePath, relativePath } = await readPageSource(created.path);
  const now = new Date().toISOString();
  const metadata: FrontmatterData = {
    ...created.metadata,
    title: parsed.title,
    updated: now,
    ...(input.sourceUrl?.trim() ? { sourceUrl: input.sourceUrl.trim() } : {}),
    ...(input.publishedUrl?.trim() ? { publishedUrl: input.publishedUrl.trim() } : {}),
  };
  if (!metadata.created) {
    metadata.created = now;
  }

  const serialized = serializeFrontmatterDocument(metadata, body);
  await writeAtomically(absolutePath, serialized);
  invalidateVaultCache();
  return buildPageDocument(relativePath, serialized);
}

export async function exportPageAsDocx(input: ExportDocxPageInput) {
  const { source, relativePath } = await readPageSource(input.path);
  const page = buildPageDocument(relativePath, source);
  if (page.metadata.note_type === "ink") {
    throw new VaultError("UNSUPPORTED_EXPORT", "DOCX export is available for text pages only.");
  }

  const resolved = resolveVaultPath(relativePath, "page");
  return buildDocxBuffer({
    title: input.title?.trim() || page.title,
    bodyHtml: input.bodyHtml ?? page.body,
    vaultRoot: resolved.vaultRoot,
  });
}

async function computePageDepth(pagePath: string, visited = new Set<string>()): Promise<number> {
  if (visited.has(pagePath)) return 0;
  visited.add(pagePath);
  try {
    const { source, relativePath } = await readPageSource(pagePath);
    const { metadata } = parseFrontmatterDocument(source);
    const parentId = asNullableString(metadata.parent_id);
    if (!parentId) return 0;
    return 1 + (await computePageDepth(parentId, visited));
  } catch {
    return 0;
  }
}

export interface NestPageInput {
  path: string;
  parentId: string | null;
}

export async function nestPage(input: NestPageInput) {
  const page = await readPageDocument(input.path);
  if (page.designLinked) {
    throw new VaultError(
      "INVALID_INPUT",
      "Linked design pages cannot be nested; unlink or keep them as top-level pages in their section.",
      400
    );
  }
  const { absolutePath, relativePath } = resolveVaultPath(input.path, "page");

  if (input.parentId !== null) {
    if (input.parentId === relativePath) {
      throw new VaultError("INVALID_PARENT", "A page cannot be its own parent.", 400);
    }
    const parentDepth = await computePageDepth(input.parentId);
    if (parentDepth >= 2) {
      throw new VaultError("DEPTH_CAP", "Page nesting cannot exceed 2 levels deep.", 400);
    }
  }

  const nextMetadata: FrontmatterData = { ...page.metadata };
  if (input.parentId !== null) {
    nextMetadata.parent_id = input.parentId;
  } else {
    delete nextMetadata.parent_id;
  }

  const serialized = serializeFrontmatterDocument(nextMetadata, page.body);
  await writeAtomically(absolutePath, serialized);
  invalidateVaultCache();
  return buildPageDocument(relativePath, serialized);
}

export interface SetPageKeyNoteInput {
  path: string;
  keyNote: boolean;
}

export async function setPageKeyNote(input: SetPageKeyNoteInput) {
  const { absolutePath, relativePath } = resolveVaultPath(input.path, "page");
  const existingLink = await readDesignLinkSidecar(absolutePath);
  const now = new Date().toISOString();

  if (existingLink) {
    let body = "";
    let sourceMissing = false;
    try {
      body = await fs.readFile(absolutePath, "utf8");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        sourceMissing = true;
      } else {
        throw error;
      }
    }

    const nextLink: DesignLinkSidecar = {
      ...existingLink,
      updated: now,
      sourcePath: absolutePath,
    };
    if (input.keyNote) {
      nextLink.key_note = true;
    } else {
      delete nextLink.key_note;
    }

    await writeDesignLinkSidecar(absolutePath, nextLink);
    invalidateVaultCache();
    return buildLinkedDesignDocument(relativePath, body, nextLink, { sourceMissing });
  }

  const page = await readPageDocument(input.path);
  const nextMetadata = applyKeyNoteFlag(
    {
      ...page.metadata,
      updated: now,
    },
    input.keyNote
  );
  const serialized = serializeFrontmatterDocument(nextMetadata, page.body);
  await writeAtomically(absolutePath, serialized);
  invalidateVaultCache();
  return buildPageDocument(relativePath, serialized);
}

export async function reorderSectionPages(sectionPath: string, orderedIds: string[]): Promise<void> {
  const { absolutePath } = resolveVaultPath(sectionPath, "section");
  await writeSectionPageOrder(absolutePath, orderedIds);
  invalidateVaultCache();
}

export async function renamePage(pagePath: string, title: string) {
  const nextTitle = title.trim();
  if (!nextTitle) {
    throw new VaultError("INVALID_TITLE", "A page title is required.");
  }

  const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");
  const existingLink = await readDesignLinkSidecar(absolutePath);
  if (existingLink) {
    // Linked designs keep the ordinary HTML filename as ground truth; only the
    // display title in the sidecar changes.
    const now = new Date().toISOString();
    let body = "";
    let sourceMissing = false;
    try {
      body = await fs.readFile(absolutePath, "utf8");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        sourceMissing = true;
      } else {
        throw error;
      }
    }
    const nextLink: DesignLinkSidecar = {
      ...existingLink,
      title: nextTitle,
      updated: now,
      sourcePath: absolutePath,
    };
    await writeDesignLinkSidecar(absolutePath, nextLink);
    invalidateVaultCache();
    return buildLinkedDesignDocument(relativePath, body, nextLink, { sourceMissing });
  }

  const { source } = await readPageSource(pagePath);
  const page = buildPageDocument(relativePath, source);
  const currentDirectory = path.posix.dirname(relativePath);
  const nextRelativePath = toVaultRelativePath(path.posix.join(currentDirectory, fileNameFromTitle(nextTitle)));
  const { absolutePath: nextAbsolutePath } = resolveVaultPath(nextRelativePath, "page");

  if (nextRelativePath !== relativePath) {
    const collision = await fs.stat(nextAbsolutePath).then(() => true).catch(() => false);
    if (collision) {
      throw new VaultError("PAGE_EXISTS", `A page named "${nextTitle}" already exists in this section.`, 409);
    }
  }

  const now = new Date().toISOString();
  const metadata: FrontmatterData = {
    ...page.metadata,
    title: nextTitle,
    updated: now,
  };
  if (!metadata.created) {
    metadata.created = now;
  }

  const serialized = serializeFrontmatterDocument(metadata, page.body);
  const currentAssets = resolveVaultPath(siblingAssetDirectory(relativePath), "section");
  const nextAssets = resolveVaultPath(siblingAssetDirectory(nextRelativePath), "section");
  const hasAssets = await fs.stat(currentAssets.absolutePath).then(() => true).catch(() => false);
  if (hasAssets && nextRelativePath !== relativePath) {
    const nextAssetsExists = await fs.stat(nextAssets.absolutePath).then(() => true).catch(() => false);
    if (nextAssetsExists) {
      throw new VaultError(
        "ASSET_COLLISION",
        "Cannot rename page because the destination asset folder already exists.",
        409
      );
    }
  }

  if (nextRelativePath === relativePath) {
    await writeAtomically(absolutePath, serialized);
    invalidateVaultCache();
    return buildPageDocument(relativePath, serialized);
  }

  await stopJupyterSessionForPageIfNeeded(page);

  const movedSidecars: Array<
    | ".ink.json"
    | ".annotations.json"
    | ".companion.json"
    | ".ref.json"
    | ".log.json"
    | ".form.json"
    | ".design-link.json"
    | ".spreadsheet.json"
  > = [];
  let wroteNextPage = false;
  let movedAssets = false;
  let movedJupyterDir = false;
  let movedVersions = false;
  let movedAppDataSidecars: string[] = [];

  try {
    await writeAtomically(nextAbsolutePath, serialized);
    wroteNextPage = true;

    if (hasAssets) {
      await renameDirectory(currentAssets.absolutePath, nextAssets.absolutePath);
      movedAssets = true;
    }

    for (const extension of [
      ".ink.json",
      ".annotations.json",
      ".companion.json",
      ".ref.json",
      ".log.json",
      ".form.json",
      ".design-link.json",
      SPREADSHEET_SIDECAR_EXTENSION,
    ] as const) {
      if (await moveSidecarIfPresent(absolutePath, nextAbsolutePath, extension)) {
        movedSidecars.push(extension);
      }
    }

    movedAppDataSidecars = await moveAppDataSidecars(absolutePath, nextAbsolutePath);

    movedJupyterDir = await moveJupyterDirIfPresent(absolutePath, nextAbsolutePath);

    await movePageVersions(relativePath, nextRelativePath, versionedNoteType(page.metadata));
    movedVersions = true;
    await fs.rm(absolutePath, { force: false });
  } catch (error) {
    if (movedVersions) {
      await movePageVersions(
        nextRelativePath,
        relativePath,
        versionedNoteType(page.metadata)
      ).catch(() => undefined);
    }
    if (movedJupyterDir) {
      await restoreMovedDirectory(
        nextAbsolutePath.replace(/\.html$/i, ".jupyter"),
        absolutePath.replace(/\.html$/i, ".jupyter")
      ).catch(() => undefined);
    }
    if (movedAppDataSidecars.length > 0) {
      await restoreMovedAppDataSidecars(absolutePath, nextAbsolutePath, movedAppDataSidecars).catch(() => undefined);
    }
    for (const extension of [...movedSidecars].reverse()) {
      await moveSidecarIfPresent(nextAbsolutePath, absolutePath, extension).catch(() => undefined);
    }
    if (movedAssets) {
      await restoreMovedDirectory(nextAssets.absolutePath, currentAssets.absolutePath).catch(() => undefined);
    }
    if (wroteNextPage) {
      await removeFileIfStillOrphaned(nextAbsolutePath, absolutePath);
    }
    invalidateVaultCache();
    throw error;
  }
  invalidateVaultCache();
  return buildPageDocument(nextRelativePath, serialized);
}

export async function deletePage(pagePath: string) {
  const page = await readPageDocument(pagePath);
  const { absolutePath, relativePath } = resolveVaultPath(pagePath, "page");

  // Linked designs: remove SN metadata/sidecars only — never delete the ordinary HTML.
  if (page.designLinked) {
    await removeDesignLinkSidecar(absolutePath);
    await fs.rm(absolutePath.replace(/\.html$/i, ".annotations.json"), { force: true });
    await fs.rm(absolutePath.replace(/\.html$/i, ".companion.json"), { force: true });
    await fs.rm(absolutePath.replace(/\.html$/i, ".ref.json"), { force: true });
    const assetDirectory = resolveVaultPath(siblingAssetDirectory(relativePath), "section");
    const hasAssets = await fs.stat(assetDirectory.absolutePath).then(() => true).catch(() => false);
    if (hasAssets) {
      await fs.rm(assetDirectory.absolutePath, { recursive: true, force: true });
    }
    invalidateVaultCache();
    return { path: relativePath };
  }

  await deletePageVersions(relativePath, versionedNoteType(page.metadata));

  await stopJupyterSessionForPageIfNeeded(page);
  await fs.rm(absolutePath, { force: false });
  await fs.rm(absolutePath.replace(/\.html$/i, ".ink.json"), { force: true });
  await fs.rm(absolutePath.replace(/\.html$/i, ".annotations.json"), { force: true });
  await fs.rm(absolutePath.replace(/\.html$/i, ".companion.json"), { force: true });
  await fs.rm(absolutePath.replace(/\.html$/i, ".ref.json"), { force: true });
  await fs.rm(absolutePath.replace(/\.html$/i, ".log.json"), { force: true });
  await fs.rm(absolutePath.replace(/\.html$/i, ".form.json"), { force: true });
  await fs.rm(absolutePath.replace(/\.html$/i, ".design-link.json"), { force: true });
  await fs.rm(absolutePath.replace(/\.html$/i, SPREADSHEET_SIDECAR_EXTENSION), { force: true });
  await removeAppDataSidecars(absolutePath);
  await fs.rm(absolutePath.replace(/\.html$/i, ".jupyter"), { recursive: true, force: true });
  const assetDirectory = resolveVaultPath(siblingAssetDirectory(relativePath), "section");
  const hasAssets = await fs.stat(assetDirectory.absolutePath).then(() => true).catch(() => false);
  if (hasAssets) {
    await fs.rm(assetDirectory.absolutePath, { recursive: true, force: false });
  }
  invalidateVaultCache();
  return { path: relativePath };
}

// ---------------------------------------------------------------------------
// Notebook operations
// ---------------------------------------------------------------------------

export async function createNotebook(name: string) {
  const dirName = dirNameFromLabel(name);
  if (!dirName) {
    throw new VaultError("INVALID_NAME", "Notebook name is required.");
  }

  const vaultRoot = getVaultRoot();
  const absolutePath = path.join(vaultRoot, dirName);
  const collision = await fs.stat(absolutePath).then(() => true).catch(() => false);
  if (collision) {
    throw new VaultError("NOTEBOOK_EXISTS", `A notebook named "${dirName}" already exists.`, 409);
  }

  await fs.mkdir(absolutePath, { recursive: false });
  const notebookPath = toVaultRelativePath(dirName);
  invalidateVaultCache();
  return {
    path: notebookPath,
    name: dirName,
  };
}

export async function renameNotebook(notebookPath: string, newName: string) {
  if (isPortableNotebookPath(notebookPath)) {
    const displayName = newName.trim();
    if (!displayName) {
      throw new VaultError("INVALID_NAME", "Notebook name is required.");
    }
    const entry = findPortableNotebookByPath(notebookPath);
    if (!entry) {
      throw new VaultError("NOTEBOOK_NOT_FOUND", `Notebook not found: ${notebookPath}`, 404);
    }
    const renamed = renamePortableNotebook(entry.id, displayName);
    invalidateVaultCache();
    return { previousPath: notebookPath, path: notebookPath, name: renamed.name };
  }

  const dirName = dirNameFromLabel(newName);
  if (!dirName) {
    throw new VaultError("INVALID_NAME", "Notebook name is required.");
  }

  const { absolutePath, relativePath } = resolveVaultPath(notebookPath, "notebook");
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new VaultError("NOTEBOOK_NOT_FOUND", `Notebook not found: ${relativePath}`, 404);
  }

  const vaultRoot = getVaultRoot();
  const nextAbsolutePath = path.join(vaultRoot, dirName);
  const nextRelativePath = toVaultRelativePath(dirName);

  if (nextRelativePath !== relativePath) {
    const collision = await fs.stat(nextAbsolutePath).then(() => true).catch(() => false);
    if (collision) {
      throw new VaultError("NOTEBOOK_EXISTS", `A notebook named "${dirName}" already exists.`, 409);
    }
    await renameDirectory(absolutePath, nextAbsolutePath);
  }
  invalidateVaultCache();
  return { previousPath: relativePath, path: nextRelativePath, name: dirName };
}

export async function deleteNotebook(notebookPath: string) {
  if (isPortableNotebookPath(notebookPath)) {
    const entry = findPortableNotebookByPath(notebookPath);
    if (!entry) {
      throw new VaultError("NOTEBOOK_NOT_FOUND", `Notebook not found: ${notebookPath}`, 404);
    }
    const removed = unregisterPortableNotebook(entry.id);
    invalidateVaultCache();
    return { path: removed.path };
  }

  const { absolutePath, relativePath } = resolveVaultPath(notebookPath, "notebook");
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new VaultError("NOTEBOOK_NOT_FOUND", `Notebook not found: ${relativePath}`, 404);
  }

  await fs.rm(absolutePath, { recursive: true, force: false });
  invalidateVaultCache();
  return { path: relativePath };
}

// ---------------------------------------------------------------------------
// Section operations
// ---------------------------------------------------------------------------

export async function createSection(notebookPath: string, name: string) {
  const dirName = dirNameFromLabel(name);
  if (!dirName) {
    throw new VaultError("INVALID_NAME", "Section name is required.");
  }

  const { absolutePath: notebookAbsPath, relativePath: notebookRelPath } = resolveVaultPath(notebookPath, "notebook");
  const notebookStat = await fs.stat(notebookAbsPath).catch(() => null);
  if (!notebookStat?.isDirectory()) {
    throw new VaultError("NOTEBOOK_NOT_FOUND", `Notebook not found: ${notebookRelPath}`, 404);
  }

  const absolutePath = path.join(notebookAbsPath, dirName);
  const collision = await fs.stat(absolutePath).then(() => true).catch(() => false);
  if (collision) {
    throw new VaultError("SECTION_EXISTS", `A section named "${dirName}" already exists in this notebook.`, 409);
  }

  await fs.mkdir(absolutePath, { recursive: false });
  const sectionPath = toVaultRelativePath(path.posix.join(notebookRelPath, dirName));
  invalidateVaultCache();
  return { path: sectionPath, name: dirName, notebookPath: notebookRelPath };
}

export async function renameSection(sectionPath: string, newName: string) {
  const dirName = dirNameFromLabel(newName);
  if (!dirName) {
    throw new VaultError("INVALID_NAME", "Section name is required.");
  }

  const { absolutePath, relativePath } = resolveVaultPath(sectionPath, "section");
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new VaultError("SECTION_NOT_FOUND", `Section not found: ${relativePath}`, 404);
  }

  const parentDir = path.dirname(absolutePath);
  const nextAbsolutePath = path.join(parentDir, dirName);
  const parentRelative = path.posix.dirname(relativePath);
  const nextRelativePath = toVaultRelativePath(path.posix.join(parentRelative, dirName));

  if (nextRelativePath !== relativePath) {
    const collision = await fs.stat(nextAbsolutePath).then(() => true).catch(() => false);
    if (collision) {
      throw new VaultError("SECTION_EXISTS", `A section named "${dirName}" already exists.`, 409);
    }
    await renameDirectory(absolutePath, nextAbsolutePath);
  }
  invalidateVaultCache();
  return {
    previousPath: relativePath,
    path: nextRelativePath,
    name: dirName,
    notebookPath: parentRelative,
  };
}

export async function deleteSection(sectionPath: string) {
  const { absolutePath, relativePath } = resolveVaultPath(sectionPath, "section");
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new VaultError("SECTION_NOT_FOUND", `Section not found: ${relativePath}`, 404);
  }

  await fs.rm(absolutePath, { recursive: true, force: false });
  invalidateVaultCache();
  return { path: relativePath };
}

// ---------------------------------------------------------------------------
// Page move
// ---------------------------------------------------------------------------

export async function movePage(pagePath: string, targetSectionPath: string) {
  const { source, absolutePath: srcAbsPath, relativePath: srcRelPath } = await readPageSource(pagePath);
  const { absolutePath: targetAbsPath, relativePath: targetRelPath } = resolveVaultPath(targetSectionPath, "section");

  const targetStat = await fs.stat(targetAbsPath).catch(() => null);
  if (!targetStat?.isDirectory()) {
    throw new VaultError("SECTION_NOT_FOUND", `Target section not found: ${targetRelPath}`, 404);
  }

  const fileName = path.basename(srcAbsPath);
  const destAbsPath = path.join(targetAbsPath, fileName);
  const destRelPath = toVaultRelativePath(path.posix.join(targetRelPath, fileName));

  if (destRelPath === srcRelPath) {
    // Already in the target section, nothing to do.
    return buildPageDocument(srcRelPath, source);
  }

  const collision = await fs.stat(destAbsPath).then(() => true).catch(() => false);
  if (collision) {
    throw new VaultError("PAGE_EXISTS", `A page named "${fileName}" already exists in the target section.`, 409);
  }

  // Move assets directory if it exists.
  const srcAssetsAbsPath = resolveVaultPath(siblingAssetDirectory(srcRelPath), "section").absolutePath;
  const destAssetsRelPath = siblingAssetDirectory(destRelPath);
  const destAssetsAbsPath = resolveVaultPath(destAssetsRelPath, "section").absolutePath;
  const hasAssets = await fs.stat(srcAssetsAbsPath).then((s) => s.isDirectory()).catch(() => false);
  if (hasAssets) {
    const destAssetsCollision = await fs.stat(destAssetsAbsPath).then(() => true).catch(() => false);
    if (destAssetsCollision) {
      throw new VaultError("ASSET_COLLISION", "Cannot move page because the destination asset folder already exists.", 409);
    }
  }

  const page = buildPageDocument(srcRelPath, source);
  await stopJupyterSessionForPageIfNeeded(page);
  const movedSidecars: Array<
    ".ink.json" | ".annotations.json" | ".companion.json" | ".ref.json" | ".log.json" | ".form.json" | ".spreadsheet.json"
  > = [];
  let wroteDestination = false;
  let movedAssets = false;
  let movedJupyter = false;
  let movedVersions = false;
  let movedAppData: string[] = [];
  try {
    await writeAtomically(destAbsPath, source);
    wroteDestination = true;
    if (hasAssets) {
      await fs.rename(srcAssetsAbsPath, destAssetsAbsPath);
      movedAssets = true;
    }
    for (const extension of [
      ".ink.json",
      ".annotations.json",
      ".companion.json",
      ".ref.json",
      ".log.json",
      ".form.json",
      SPREADSHEET_SIDECAR_EXTENSION,
    ] as const) {
      if (await moveSidecarIfPresent(srcAbsPath, destAbsPath, extension)) movedSidecars.push(extension);
    }
    movedAppData = await moveAppDataSidecars(srcAbsPath, destAbsPath);
    movedJupyter = await moveJupyterDirIfPresent(srcAbsPath, destAbsPath);
    await movePageVersions(srcRelPath, destRelPath, versionedNoteType(page.metadata));
    movedVersions = true;
    await fs.rm(srcAbsPath, { force: false });
  } catch (error) {
    if (movedVersions) {
      await movePageVersions(destRelPath, srcRelPath, versionedNoteType(page.metadata)).catch(() => undefined);
    }
    if (movedJupyter) {
      await restoreMovedDirectory(
        destAbsPath.replace(/\.html$/i, ".jupyter"),
        srcAbsPath.replace(/\.html$/i, ".jupyter")
      ).catch(() => undefined);
    }
    if (movedAppData.length > 0) {
      await restoreMovedAppDataSidecars(srcAbsPath, destAbsPath, movedAppData).catch(() => undefined);
    }
    for (const extension of [...movedSidecars].reverse()) {
      await moveSidecarIfPresent(destAbsPath, srcAbsPath, extension).catch(() => undefined);
    }
    if (movedAssets) {
      await restoreMovedDirectory(destAssetsAbsPath, srcAssetsAbsPath).catch(() => undefined);
    }
    if (wroteDestination) await fs.rm(destAbsPath, { force: true }).catch(() => undefined);
    invalidateVaultCache();
    throw error;
  }
  invalidateVaultCache();
  return buildPageDocument(destRelPath, source);
}

// ---------------------------------------------------------------------------
// Inbox / Capture
// ---------------------------------------------------------------------------

/**
 * Finds or creates the Inbox section. Returns its vault-relative path.
 *
 * Strategy:
 * 1. Walk notebooks in alphabetical order; use the first section named "Inbox".
 * 2. If none, create an "Inbox" section in the first notebook.
 * 3. If the vault is empty, also create a default notebook first.
 */
export async function ensureInboxSection(notebookPath?: string): Promise<string> {
  const vaultRoot = getVaultRoot();

  if (notebookPath) {
    const { absolutePath, relativePath } = resolveVaultPath(notebookPath, "notebook");
    const notebookStat = await fs.stat(absolutePath).catch(() => null);
    if (!notebookStat?.isDirectory()) {
      throw new VaultError("NOTEBOOK_NOT_FOUND", `Notebook not found: ${relativePath}`, 404);
    }
    const inboxAbsolutePath = path.join(absolutePath, INBOX_SECTION_NAME);
    await fs.mkdir(inboxAbsolutePath, { recursive: true });
    return toVaultRelativePath(path.posix.join(relativePath, INBOX_SECTION_NAME));
  }

  // Use the live, alphabetically sorted tree so primary and portable notebooks
  // follow the same deterministic global-Inbox fallback contract.
  const { tree: notebooks } = await readVaultTree({ skipCache: true });
  for (const notebook of notebooks) {
    const inbox = notebook.sections.find((section) => section.name === INBOX_SECTION_NAME);
    if (inbox) {
      return inbox.path;
    }
  }

  if (notebooks.length > 0) {
    return ensureInboxSection(notebooks[0].path);
  }

  // Vault is empty: create the default notebook and Inbox.
  const targetNotebookName = "Personal Notebook";
  await fs.mkdir(path.join(vaultRoot, targetNotebookName), { recursive: true });
  const inboxAbsPath = path.join(vaultRoot, targetNotebookName, INBOX_SECTION_NAME);
  await fs.mkdir(inboxAbsPath, { recursive: true });
  return toVaultRelativePath(path.posix.join(targetNotebookName, INBOX_SECTION_NAME));
}

export async function captureToInbox(title?: string) {
  const inboxSectionPath = await ensureInboxSection();
  return createPage({
    sectionPath: inboxSectionPath,
    title: title?.trim() || "Untitled capture",
  });
}

export async function capturePage(input: {
  destination?: "inbox" | "page";
  title?: string;
  content?: string;
  notebookPath?: string;
  sectionPath?: string;
}) {
  const destination = input.destination ?? "inbox";
  const title = input.title?.trim() || "Untitled capture";
  const content = input.content ?? "";

  if (destination === "page") {
    if (!input.sectionPath) {
      throw new VaultError("INVALID_PATH", "\"sectionPath\" is required for destination=page.");
    }
    const created = await createPage({ sectionPath: input.sectionPath, title });
    if (!content) {
      return created;
    }
    return savePage({
      path: created.path,
      title: created.title,
      body: content,
    });
  }

  const inboxSectionPath = await ensureInboxSection(input.notebookPath);
  const created = await createPage({
    sectionPath: inboxSectionPath,
    title,
  });
  if (!content) {
    return created;
  }
  return savePage({
    path: created.path,
    title: created.title,
    body: content,
  });
}

export interface SpliceEditInput {
  path: string;
  /** Character offset (within the body markdown) where the replacement starts. */
  start: number;
  /** Character offset (within the body markdown) where the replacement ends. */
  end: number;
  /** The AI-generated replacement text. */
  replacement: string;
  /** Socket.IO id for the tab that initiated the write, when known. */
  originSocketId?: string;
  /** Tab-local client id for self-origin filtering when Socket.IO cannot suppress. */
  originClientId?: string;
}

/**
 * Splice the AI-generated `replacement` into the page body between `start` and
 * `end` character offsets, then write the file back atomically.  Surrounding
 * content is preserved.  Optionally emits a `file_updated` Socket.IO event if
 * the global `_smartNotesIo` socket server is available (set in server.js).
 */
export async function spliceEditPage(input: SpliceEditInput) {
  const { source, absolutePath, relativePath } = await readPageSource(input.path);
  const page = buildPageDocument(relativePath, source);

  const body = page.body;
  const before = body.slice(0, input.start).trimEnd();
  const after = body.slice(input.end).trimStart();

  const parts: string[] = [];
  if (before) parts.push(before);
  parts.push(input.replacement.trim());
  if (after) parts.push(after);

  const newBody = parts.join("\n\n");
  const savedPage = await savePage({
    path: input.path,
    title: page.title,
    body: newBody,
  });

  const fileUpdated: { path: string; content: string; originSocketId?: string; originClientId?: string } = {
    path: savedPage.path,
    content: savedPage.body,
  };
  if (input.originSocketId) {
    fileUpdated.originSocketId = input.originSocketId;
  }
  if (input.originClientId) {
    fileUpdated.originClientId = input.originClientId;
  }
  emitVaultSideEffects({ fileUpdated });

  return savedPage;
}

export async function previewAttachment(pagePath: string, sourcePath: string) {
  await readPageSource(pagePath);
  const attachment = await resolveAiAttachmentSource(sourcePath);
  const buffer = await fs.readFile(attachment.absolutePath);
  const mimeType =
    attachment.extension === ".png"
      ? "image/png"
      : attachment.extension === ".jpg" || attachment.extension === ".jpeg"
        ? "image/jpeg"
        : attachment.extension === ".gif"
          ? "image/gif"
          : "image/svg+xml";

  return {
    fileName: attachment.fileName,
    previewSrc: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

export async function copyAttachmentToNote(pagePath: string, sourcePath: string, description?: string) {
  await readPageSource(pagePath);
  const attachment = await resolveAiAttachmentSource(sourcePath);
  const destination = await uniqueAttachmentFileName(attachment.fileName);
  await fs.copyFile(attachment.absolutePath, destination.candidateAbsolutePath);

  const altText = (description?.trim() || path.basename(destination.candidateFileName, path.extname(destination.candidateFileName)))
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");

  return {
    fileName: destination.candidateFileName,
    relativePath: `attachments/${destination.candidateFileName}`,
    html: `<img src="./attachments/${destination.candidateFileName}" alt="${escapeHtml(altText)}" />`,
  };
}

// ---------------------------------------------------------------------------
// Comment operations
// Comments are stored in page frontmatter under the `comments` key.
// The body HTML is modified only by comment_address (not by list/resolve/delete).
// ---------------------------------------------------------------------------

export interface StoredComment {
  id: string;
  quote: string;
  text: string;
  createdAt: string;
  resolvedAt: string | null;
}

export async function readPageComments(pagePath: string): Promise<StoredComment[]> {
  const page = await readPage(pagePath);
  const raw = page.metadata.comments;
  if (!Array.isArray(raw)) return [];
  return raw as unknown as StoredComment[];
}

export async function savePageComments(
  pagePath: string,
  comments: StoredComment[],
  /** Current in-memory body. When provided, takes precedence over whatever is on disk
   *  so a comment save never discards unsaved editor content. */
  currentBody?: string
): Promise<StoredComment[]> {
  const { source, absolutePath, relativePath } = await readPageSource(pagePath);
  const page = buildPageDocument(relativePath, source);

  const nextMetadata: FrontmatterData = {
    ...page.metadata,
    // Omit key entirely when empty so frontmatter stays clean.
    ...(comments.length > 0 ? { comments: comments as unknown as FrontmatterValue } : {}),
  };
  if (comments.length === 0) {
    delete nextMetadata.comments;
  }

  // Prefer the caller-supplied body so a comment save never clobbers
  // in-memory content that hasn't been flushed to disk yet.
  const body = currentBody !== undefined ? currentBody : page.body;
  const serialized = serializeFrontmatterDocument(nextMetadata, body);
  await writeAtomically(absolutePath, serialized);
  return comments;
}

export const __testInternals = {
  writeAtomically,
};
