import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { VaultError } from "./errors";
import { resolveVaultPath } from "./paths";
import { spreadsheetSidecarAbsolutePath } from "./spreadsheet";

export const MAX_PAGE_VERSIONS = 5;

export interface PageVersionEntry {
  id: string;
  ts: string;
  hash: string;
  size: number;
}

interface VersionIndex {
  entries: PageVersionEntry[];
}

import { pageStemFromPath, PAGE_FILE_EXTENSION } from "./page-format";

function formatVersionTimestamp(date: Date) {
  return date.toISOString().replace(/:/g, "-");
}

export function computeContentHash(content: string) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex").slice(0, 6);
}

type VersionKind = "page" | "ink" | "annotations" | "spreadsheet";

function versionsRelativeDir(pagePath: string, kind: VersionKind) {
  const sectionDir = path.posix.dirname(pagePath);
  const stem =
    kind === "ink"
      ? `${pageStemFromPath(pagePath)}.ink`
      : kind === "spreadsheet"
        ? `${pageStemFromPath(pagePath)}.spreadsheet`
      : kind === "annotations"
        ? `${pageStemFromPath(pagePath)}.annotations`
        : pageStemFromPath(pagePath);
  return path.posix.join(sectionDir, ".versions", stem);
}

function versionFileName(ts: string, hash: string, extension: string) {
  return `${ts}_${hash}${extension}`;
}

function parseVersionFileName(fileName: string, extension: string): { id: string; ts: string; hash: string } | null {
  if (!fileName.endsWith(extension)) {
    return null;
  }
  const stem = fileName.slice(0, -extension.length);
  const separator = stem.lastIndexOf("_");
  if (separator <= 0) {
    return null;
  }
  const ts = stem.slice(0, separator);
  const hash = stem.slice(separator + 1);
  if (!hash || !ts) {
    return null;
  }
  return { id: stem, ts, hash };
}

async function readVersionIndex(indexPath: string): Promise<VersionIndex> {
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as PageVersionEntry[];
    if (!Array.isArray(parsed)) {
      return { entries: [] };
    }
    return { entries: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { entries: [] };
    }
    throw error;
  }
}

async function writeVersionIndex(indexPath: string, entries: PageVersionEntry[]) {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(entries, null, 2), "utf8");
}

async function enforceVersionCap(
  versionsDir: string,
  entries: PageVersionEntry[],
  extension: string
): Promise<PageVersionEntry[]> {
  const next = [...entries];
  while (next.length > MAX_PAGE_VERSIONS) {
    const oldest = next.shift();
    if (!oldest) {
      break;
    }
    await fs.rm(path.join(versionsDir, `${oldest.id}${extension}`), { force: true });
  }
  return next;
}

async function createSnapshot(input: {
  pagePath: string;
  kind: VersionKind;
  content: string;
  extension: string;
  snapshotDate?: Date;
}) {
  const versionsDir = versionsRelativeDir(input.pagePath, input.kind);
  const { absolutePath: versionsAbsDir } = resolveVaultPath(versionsDir, "section");
  const indexPath = path.join(versionsAbsDir, "index.json");

  const hash = computeContentHash(input.content);
  const index = await readVersionIndex(indexPath);
  const latest = index.entries[index.entries.length - 1];
  if (latest?.hash === hash) {
    return { created: false as const, entry: latest };
  }

  const now = input.snapshotDate ?? new Date();
  const ts = formatVersionTimestamp(now);
  const id = `${ts}_${hash}`;
  const fileName = versionFileName(ts, hash, input.extension);

  await fs.mkdir(versionsAbsDir, { recursive: true });
  await fs.writeFile(path.join(versionsAbsDir, fileName), input.content, "utf8");

  const entry: PageVersionEntry = {
    id,
    ts: now.toISOString(),
    hash,
    size: Buffer.byteLength(input.content, "utf8"),
  };

  let entries = [...index.entries, entry];
  entries = await enforceVersionCap(versionsAbsDir, entries, input.extension);
  await writeVersionIndex(indexPath, entries);

  return { created: true as const, entry };
}

export async function listPageVersions(pagePath: string, kind: VersionKind = "page") {
  const versionsDir = versionsRelativeDir(pagePath, kind);
  const { absolutePath: versionsAbsDir } = resolveVaultPath(versionsDir, "section");
  const indexPath = path.join(versionsAbsDir, "index.json");
  const index = await readVersionIndex(indexPath);
  return [...index.entries].reverse();
}

export async function readPageVersionContent(
  pagePath: string,
  versionId: string,
  kind: VersionKind = "page"
) {
  const extension = kind === "ink" || kind === "annotations" || kind === "spreadsheet" ? ".json" : PAGE_FILE_EXTENSION;
  const versionsDir = versionsRelativeDir(pagePath, kind);
  const { absolutePath: versionsAbsDir } = resolveVaultPath(versionsDir, "section");
  const filePath = path.join(versionsAbsDir, `${versionId}${extension}`);

  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new VaultError("VERSION_NOT_FOUND", `Version not found: ${versionId}`, 404);
    }
    throw error;
  }
}

export async function snapshotPageContent(pagePath: string) {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  let source: string;
  try {
    source = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new VaultError("PAGE_NOT_FOUND", `Page not found: ${pagePath}`, 404);
    }
    throw error;
  }

  return createSnapshot({
    pagePath,
    kind: "page",
    content: source,
    extension: PAGE_FILE_EXTENSION,
  });
}

export async function snapshotInkContent(pagePath: string) {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  const sidecarPath = absolutePath.replace(/\.html$/i, ".ink.json");
  let source: string;
  try {
    source = await fs.readFile(sidecarPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { created: false as const, entry: null };
    }
    throw error;
  }

  return createSnapshot({
    pagePath,
    kind: "ink",
    content: source,
    extension: ".json",
  });
}

export async function snapshotSpreadsheetContent(pagePath: string) {
  let source: string;
  try {
    source = await fs.readFile(spreadsheetSidecarAbsolutePath(pagePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { created: false as const, entry: null };
    }
    throw error;
  }

  return createSnapshot({
    pagePath,
    kind: "spreadsheet",
    content: source,
    extension: ".json",
  });
}

export async function snapshotAnnotationsContent(pagePath: string, snapshotDate?: Date) {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  const sidecarPath = absolutePath.replace(/\.html$/i, ".annotations.json");
  let source: string;
  try {
    source = await fs.readFile(sidecarPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { created: false as const, entry: null };
    }
    throw error;
  }

  return createSnapshot({
    pagePath,
    kind: "annotations",
    content: source,
    extension: ".json",
    snapshotDate,
  });
}

function versionTimestampFromId(versionId: string) {
  const separator = versionId.lastIndexOf("_");
  if (separator <= 0) {
    return versionId;
  }
  return versionId.slice(0, separator);
}

async function findAnnotationsVersionByTimestamp(pagePath: string, versionTs: string) {
  const versions = await listPageVersions(pagePath, "annotations");
  return versions.find((entry) => versionTimestampFromId(entry.id) === versionTs) ?? null;
}

export async function snapshotTextPageWithAnnotations(pagePath: string) {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  let pageSource: string;
  try {
    pageSource = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new VaultError("PAGE_NOT_FOUND", `Page not found: ${pagePath}`, 404);
    }
    throw error;
  }

  const snapshotDate = new Date();
  const pageSnapshot = await createSnapshot({
    pagePath,
    kind: "page",
    content: pageSource,
    extension: PAGE_FILE_EXTENSION,
    snapshotDate,
  });
  await snapshotAnnotationsContent(pagePath, snapshotDate);
  return pageSnapshot;
}

export async function snapshotPageByNoteType(pagePath: string, noteType: "text" | "ink" | "spreadsheet") {
  if (noteType === "ink") {
    return snapshotInkContent(pagePath);
  }
  if (noteType === "spreadsheet") {
    return snapshotSpreadsheetContent(pagePath);
  }
  return snapshotTextPageWithAnnotations(pagePath);
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

async function writeAtomically(targetPath: string, content: string) {
  const directory = path.dirname(targetPath);
  const tempPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );

  await fs.writeFile(tempPath, content, "utf8");
  try {
    await renameFileAtomically(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
export async function restorePageVersion(pagePath: string, versionId: string, noteType: "text" | "ink" | "spreadsheet") {
  const { absolutePath } = resolveVaultPath(pagePath, "page");

  if (noteType === "ink") {
    await snapshotInkContent(pagePath);
    const content = await readPageVersionContent(pagePath, versionId, "ink");
    const sidecarAbsPath = absolutePath.replace(/\.html$/i, ".ink.json");
    await writeAtomically(sidecarAbsPath, content);
    return { path: pagePath, kind: "ink" as const };
  }

  if (noteType === "spreadsheet") {
    await snapshotSpreadsheetContent(pagePath);
    const content = await readPageVersionContent(pagePath, versionId, "spreadsheet");
    await writeAtomically(spreadsheetSidecarAbsolutePath(pagePath), content);
    return { path: pagePath, kind: "spreadsheet" as const };
  }

  await snapshotTextPageWithAnnotations(pagePath);
  const content = await readPageVersionContent(pagePath, versionId, "page");
  await writeAtomically(absolutePath, content);

  const versionTs = versionTimestampFromId(versionId);
  const annotationsVersion = await findAnnotationsVersionByTimestamp(pagePath, versionTs);
  if (annotationsVersion) {
    const annotationsContent = await readPageVersionContent(pagePath, annotationsVersion.id, "annotations");
    const annotationsAbsPath = absolutePath.replace(/\.html$/i, ".annotations.json");
    await writeAtomically(annotationsAbsPath, annotationsContent);
  } else {
    await fs.rm(absolutePath.replace(/\.html$/i, ".annotations.json"), { force: true });
  }

  return { path: pagePath, kind: "page" as const };
}

export async function movePageVersions(
  previousPagePath: string,
  nextPagePath: string,
  noteType: "text" | "ink" | "spreadsheet"
) {
  const previousStem = pageStemFromPath(previousPagePath);
  const nextStem = pageStemFromPath(nextPagePath);
  if (previousStem === nextStem && path.posix.dirname(previousPagePath) === path.posix.dirname(nextPagePath)) {
    return;
  }

  const kinds: VersionKind[] =
    noteType === "ink" ? ["page", "ink"] : noteType === "spreadsheet" ? ["page", "spreadsheet"] : ["page", "annotations"];

  for (const kind of kinds) {
    const previousDir = versionsRelativeDir(previousPagePath, kind);
    const nextDir = versionsRelativeDir(nextPagePath, kind);
    if (previousDir === nextDir) {
      continue;
    }

    const { absolutePath: previousAbs } = resolveVaultPath(previousDir, "section");
    const { absolutePath: nextAbs } = resolveVaultPath(nextDir, "section");
    const exists = await fs.stat(previousAbs).then((stat) => stat.isDirectory()).catch(() => false);
    if (!exists) {
      continue;
    }

    await fs.mkdir(path.dirname(nextAbs), { recursive: true });
    const nextExists = await fs.stat(nextAbs).then(() => true).catch(() => false);
    if (nextExists) {
      await fs.rm(nextAbs, { recursive: true, force: true });
    }
    await fs.rename(previousAbs, nextAbs);
  }
}

export async function deletePageVersions(pagePath: string, noteType: "text" | "ink" | "spreadsheet") {
  const kinds: VersionKind[] =
    noteType === "ink" ? ["page", "ink"] : noteType === "spreadsheet" ? ["page", "spreadsheet"] : ["page", "annotations"];
  for (const kind of kinds) {
    const versionsDir = versionsRelativeDir(pagePath, kind);
    const { absolutePath } = resolveVaultPath(versionsDir, "section");
    await fs.rm(absolutePath, { recursive: true, force: true });
  }
}

export const __testInternals = {
  versionsRelativeDir,
  formatVersionTimestamp,
  parseVersionFileName,
  enforceVersionCap,
  versionFileName,
  versionTimestampFromId,
  findAnnotationsVersionByTimestamp,
};
