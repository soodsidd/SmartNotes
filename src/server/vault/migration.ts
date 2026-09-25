import fs from "node:fs/promises";
import path from "node:path";
import { getVaultRoot } from "./config";
import { parseFrontmatterDocument, serializeFrontmatterDocument } from "./frontmatter";
import {
  LEGACY_PAGE_FILE_EXTENSION,
  PAGE_FILE_EXTENSION,
  pageStemFromPath,
} from "./page-format";
import { toVaultRelativePath } from "./paths";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { marked } = require("marked") as { marked: { parse: (src: string) => string; setOptions: (opts: object) => void } };

marked.setOptions({ gfm: true, breaks: false });

export interface MigrationResult {
  converted: string[];
  skipped: string[];
  errors: Array<{ path: string; message: string }>;
}

function markdownBodyToHtml(body: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    return "";
  }
  return marked.parse(trimmed) as string;
}

async function listMarkdownPages(vaultRoot: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(LEGACY_PAGE_FILE_EXTENSION)) {
        results.push(toVaultRelativePath(path.relative(vaultRoot, absolutePath)));
      }
    }
  }

  await walk(vaultRoot);
  return results;
}

async function migrateVersionSnapshots(sectionDir: string, stem: string) {
  const versionsDir = path.join(sectionDir, ".versions", stem);
  const indexPath = path.join(versionsDir, "index.json");
  const indexRaw = await fs.readFile(indexPath, "utf8").catch(() => null);
  if (!indexRaw) {
    return;
  }

  const entries = JSON.parse(indexRaw) as Array<{ id: string; ts: string; hash: string; size: number }>;
  for (const entry of entries) {
    const oldFile = path.join(versionsDir, `${entry.id}${LEGACY_PAGE_FILE_EXTENSION}`);
    const newFile = path.join(versionsDir, `${entry.id}${PAGE_FILE_EXTENSION}`);
    const exists = await fs.stat(oldFile).then(() => true).catch(() => false);
    if (exists) {
      await fs.rename(oldFile, newFile);
    }
  }
}

/**
 * One-shot migration: convert all legacy .md vault pages to .html and delete the .md files.
 * Ink sidecars (.ink.json) are untouched; only the page stub extension changes.
 */
export async function migrateMarkdownPagesToHtml(vaultRoot = getVaultRoot()): Promise<MigrationResult> {
  const converted: string[] = [];
  const skipped: string[] = [];
  const errors: MigrationResult["errors"] = [];

  const markdownPages = await listMarkdownPages(vaultRoot);
  for (const relativeMdPath of markdownPages) {
    const htmlPath = relativeMdPath.replace(/\.md$/i, PAGE_FILE_EXTENSION);
    const absoluteMdPath = path.join(vaultRoot, relativeMdPath);
    const absoluteHtmlPath = path.join(vaultRoot, htmlPath);

    try {
      const htmlExists = await fs.stat(absoluteHtmlPath).then(() => true).catch(() => false);
      if (htmlExists) {
        skipped.push(relativeMdPath);
        await fs.rm(absoluteMdPath, { force: true });
        continue;
      }

      const source = await fs.readFile(absoluteMdPath, "utf8");
      const { metadata, body } = parseFrontmatterDocument(source);
      const htmlBody = markdownBodyToHtml(body);
      const serialized = serializeFrontmatterDocument(metadata, htmlBody);
      await fs.writeFile(absoluteHtmlPath, serialized, "utf8");
      await fs.rm(absoluteMdPath, { force: true });

      const sectionDir = path.dirname(absoluteHtmlPath);
      await migrateVersionSnapshots(sectionDir, pageStemFromPath(htmlPath));

      converted.push(htmlPath);
    } catch (error) {
      errors.push({
        path: relativeMdPath,
        message: error instanceof Error ? error.message : "Unknown migration error",
      });
    }
  }

  return { converted, skipped, errors };
}
