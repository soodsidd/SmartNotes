import { createHash } from "node:crypto";
import type { AppManifest, AppTableAttachment } from "@/lib/app-contract";
import { VaultError } from "./errors";
import { stripHtml } from "./html-utils";
import { readAppManifest } from "./app-runtime";
import { readPage, readVaultTree } from "./pages";
import type { VaultPageSummary } from "./types";

/** Hard cap so inventory never dumps every vault App into one companion turn. */
export const APP_INVENTORY_MAX_LIMIT = 100;
export const APP_INVENTORY_DEFAULT_LIMIT = 50;
/** Short plain-text summary in list rows (never full source). */
export const APP_INVENTORY_SUMMARY_CHARS = 180;
/** Bounded source fetch for reuse/adapt; companions must opt into larger windows carefully. */
export const APP_INVENTORY_DEFAULT_SOURCE_CHARS = 8_192;
export const APP_INVENTORY_MAX_SOURCE_CHARS = 32_768;

export interface AppInventoryAttachmentSummary {
  id: string;
  name: string;
  kind: AppTableAttachment["kind"];
  /** Present for kind=log — vault-relative Log page path only. */
  pagePath?: string;
  fieldIds?: string[];
}

export interface AppInventoryListEntry {
  path: string;
  title: string;
  enabled: boolean;
  template?: { id: string; version: number };
  sourceSummary: string;
  sourceChars: number;
  attachments: AppInventoryAttachmentSummary[];
  updatedAt: string | null;
}

export interface AppInventoryListResult {
  apps: AppInventoryListEntry[];
  total: number;
  limit: number;
  offset: number;
  truncated: boolean;
  hint: string;
}

export interface AppInventoryGetResult {
  path: string;
  title: string;
  enabled: boolean;
  template?: { id: string; version: number };
  sourceSummary: string;
  sourceChars: number;
  source: string;
  sourceTruncated: boolean;
  sourceHash: string;
  attachments: AppInventoryAttachmentSummary[];
  manifest: Pick<AppManifest, "version" | "enabled" | "template" | "tables">;
  updatedAt: string | null;
  hint: string;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function summarizeAttachment(table: AppTableAttachment): AppInventoryAttachmentSummary {
  if (table.kind === "log") {
    return { id: table.id, name: table.name, kind: "log", pagePath: table.pagePath };
  }
  return {
    id: table.id,
    name: table.name,
    kind: "app",
    fieldIds: table.schema.fields.map((field) => field.id),
  };
}

function summarizeSource(body: string, maxChars = APP_INVENTORY_SUMMARY_CHARS): string {
  const plain = stripHtml(body).replace(/\s+/g, " ").trim();
  if (plain.length <= maxChars) return plain;
  return `${plain.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function collectAppPages(tree: Awaited<ReturnType<typeof readVaultTree>>): VaultPageSummary[] {
  const pages: VaultPageSummary[] = [];
  for (const notebook of tree.tree) {
    for (const page of notebook.pages) {
      if (page.noteType === "app") pages.push(page);
    }
    for (const section of notebook.sections) {
      for (const page of section.pages) {
        if (page.noteType === "app") pages.push(page);
      }
    }
  }
  pages.sort((a, b) => a.path.localeCompare(b.path));
  return pages;
}

async function toListEntry(page: VaultPageSummary): Promise<AppInventoryListEntry> {
  const body = typeof page.content === "string" ? page.content : "";
  let manifest: AppManifest;
  try {
    manifest = await readAppManifest(page.path);
  } catch {
    manifest = { version: 1, enabled: true, tables: [] };
  }
  return {
    path: page.path,
    title: page.title,
    enabled: manifest.enabled,
    ...(manifest.template ? { template: manifest.template } : {}),
    sourceSummary: summarizeSource(body),
    sourceChars: body.length,
    attachments: manifest.tables.map(summarizeAttachment),
    updatedAt: page.updatedAt,
  };
}

/**
 * Companion-callable vault inventory of existing App pages (note_type=app).
 * Returns size-bounded summaries only — never full source for every app.
 */
export async function listAppInventory(options: {
  limit?: unknown;
  offset?: unknown;
} = {}): Promise<AppInventoryListResult> {
  const limit = clampInt(options.limit, APP_INVENTORY_DEFAULT_LIMIT, 1, APP_INVENTORY_MAX_LIMIT);
  const offset = clampInt(options.offset, 0, 0, 100_000);
  const tree = await readVaultTree();
  const all = collectAppPages(tree);
  const slice = all.slice(offset, offset + limit);
  const apps = await Promise.all(slice.map((page) => toListEntry(page)));
  const truncated = offset + apps.length < all.length;
  return {
    apps,
    total: all.length,
    limit,
    offset,
    truncated,
    hint:
      all.length === 0
        ? "No App pages in this vault. Use app_template_list / app_create_from_template when creating a new App."
        : truncated
          ? `Showing ${apps.length} of ${all.length} App pages. Pass offset/limit to page, or app_inventory_get for one path's bounded source.`
          : "Check this inventory before creating a similar App from a blank template; reuse or adapt with app_inventory_get + app_update.",
  };
}

/**
 * Bounded fetch of one App page for reuse/adapt. Includes truncated source and
 * attachment metadata; never returns attached table row payloads.
 */
export async function getAppInventoryEntry(
  pagePath: string,
  options: { maxSourceChars?: unknown } = {}
): Promise<AppInventoryGetResult> {
  const maxSourceChars = clampInt(
    options.maxSourceChars,
    APP_INVENTORY_DEFAULT_SOURCE_CHARS,
    256,
    APP_INVENTORY_MAX_SOURCE_CHARS
  );
  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "app") {
    throw new VaultError("INVALID_APP", `Page is not an App page: ${page.path}`, 400);
  }
  const manifest = await readAppManifest(page.path);
  const sourceTruncated = page.body.length > maxSourceChars;
  const source = sourceTruncated
    ? `${page.body.slice(0, maxSourceChars)}\n/* … truncated; ${page.body.length} chars total; raise maxSourceChars up to ${APP_INVENTORY_MAX_SOURCE_CHARS} or use page_get for full body */`
    : page.body;
  return {
    path: page.path,
    title: page.title,
    enabled: manifest.enabled,
    ...(manifest.template ? { template: manifest.template } : {}),
    sourceSummary: summarizeSource(page.body),
    sourceChars: page.body.length,
    source,
    sourceTruncated,
    sourceHash: createHash("sha256").update(page.body, "utf8").digest("hex").slice(0, 16),
    attachments: manifest.tables.map(summarizeAttachment),
    manifest: {
      version: manifest.version,
      enabled: manifest.enabled,
      ...(manifest.template ? { template: manifest.template } : {}),
      tables: manifest.tables,
    },
    updatedAt: page.updatedAt,
    hint: sourceTruncated
      ? "Source was truncated for size. Raise maxSourceChars (cap 32768) or call page_get for the full body; adapt with app_update without replacing attached data."
      : "Reuse or adapt this App with app_update. Prefer adapting an existing App over creating a parallel blank template when the pattern already fits.",
  };
}
