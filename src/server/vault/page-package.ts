import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import type { FrontmatterData, FrontmatterValue, VaultPageDocument } from "./types";
import { VaultError } from "./errors";
import { serializeFrontmatterDocument } from "./frontmatter";
import {
  fileNameFromTitle,
  resolveVaultPath,
  siblingAssetDirectory,
  toVaultRelativePath,
} from "./paths";
import { invalidateVaultTreeCache, readPage } from "./pages";

export const PAGE_PACKAGE_FORMAT = "smart-notes-page";
export const PAGE_PACKAGE_VERSION = 1;
export const PAGE_PACKAGE_EXTENSION = ".snpkg";
export const PAGE_PACKAGE_MEDIA_TYPE = "application/vnd.smart-notes.page+zip";

export const PAGE_PACKAGE_LIMITS = {
  compressedBytes: 50 * 1024 * 1024,
  totalUncompressedBytes: 100 * 1024 * 1024,
  manifestBytes: 8 * 1024 * 1024,
  bodyBytes: 5 * 1024 * 1024,
  annotationsBytes: 20 * 1024 * 1024,
  assetBytes: 50 * 1024 * 1024,
  assetCount: 256,
} as const;

interface PagePackageAssetManifest {
  entry: string;
  sourceUrls: string[];
}

interface PagePackageManifestV1 {
  format: typeof PAGE_PACKAGE_FORMAT;
  version: typeof PAGE_PACKAGE_VERSION;
  page: {
    title: string;
    noteType: "text";
    metadata: FrontmatterData;
    bodyHtml: string;
  };
  assets: PagePackageAssetManifest[];
  annotationsEntry?: "annotations.json";
}

interface ValidatedPagePackage {
  manifest: PagePackageManifestV1;
  assets: Array<PagePackageAssetManifest & { fileName: string; data: Buffer }>;
  annotations: Buffer | null;
}

export interface ImportPagePackageInput {
  sectionPath: string;
  buffer: Buffer;
}

function pagePackageError(code: string, message: string, status = 400): VaultError {
  return new VaultError(code, message, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertFrontmatterValue(value: unknown, depth = 0): asserts value is FrontmatterValue {
  if (depth > 20) {
    throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package metadata is too deeply nested.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item) => assertFrontmatterValue(item, depth + 1));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package metadata contains an unsafe key.");
      }
      assertFrontmatterValue(item, depth + 1);
    }
    return;
  }
  throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package metadata contains an unsupported value.");
}

function safeArchiveEntryName(entryName: string): string {
  if (
    !entryName ||
    entryName.includes("\\") ||
    entryName.includes("\0") ||
    entryName.startsWith("/") ||
    /^[A-Za-z]:/.test(entryName)
  ) {
    throw pagePackageError("UNSAFE_PAGE_PACKAGE_PATH", `Unsafe package path: ${entryName || "(empty)"}.`);
  }
  const segments = entryName.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw pagePackageError("UNSAFE_PAGE_PACKAGE_PATH", `Unsafe package path: ${entryName}.`);
  }
  return entryName;
}

function safeAssetEntry(entryName: string): string {
  safeArchiveEntryName(entryName);
  const segments = entryName.split("/");
  if (segments.length !== 2 || segments[0] !== "assets" || !segments[1]) {
    throw pagePackageError("UNSAFE_PAGE_PACKAGE_PATH", `Asset package path must be assets/<file>: ${entryName}.`);
  }
  if (/[\x00-\x1f<>:"|?*]/.test(segments[1])) {
    throw pagePackageError("UNSAFE_PAGE_PACKAGE_PATH", `Unsafe asset file name: ${segments[1]}.`);
  }
  return segments[1];
}

function encodeVaultPath(relativePath: string): string {
  return `/vault/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function decodeVaultUrl(value: string): { relativePath: string; suffix: string } | null {
  if (!value.startsWith("/vault/")) return null;
  const hashIndex = value.indexOf("#");
  const queryIndex = value.indexOf("?");
  const suffixIndex = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);
  const pathname = value.slice(0, suffixIndex);
  const suffix = value.slice(suffixIndex);
  try {
    const decodedSegments = pathname
      .slice("/vault/".length)
      .split("/")
      .map((segment) => decodeURIComponent(segment));
    if (
      decodedSegments.some(
        (segment) => !segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")
      )
    ) {
      throw new Error("unsafe segment");
    }
    return { relativePath: decodedSegments.join("/"), suffix };
  } catch {
    throw pagePackageError("UNSAFE_PAGE_PACKAGE_PATH", `Unsafe vault asset URL: ${value}.`);
  }
}

function referencedVaultUrls(bodyHtml: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const attributePattern = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of bodyHtml.matchAll(attributePattern)) {
    const value = match[2];
    if (!value.startsWith("/vault/") || seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
  }
  return urls;
}

function portableMetadata(page: VaultPageDocument): FrontmatterData {
  const metadata: FrontmatterData = { ...page.metadata };
  delete metadata.comments;
  delete metadata.parent_id;
  delete metadata.note_type;
  metadata.title = page.title;
  return metadata;
}

function assertTextPage(page: VaultPageDocument): void {
  const noteType = page.metadata.note_type;
  if (noteType !== undefined && noteType !== "text") {
    throw pagePackageError(
      "UNSUPPORTED_PAGE_PACKAGE_TYPE",
      "Page packages currently support text pages only."
    );
  }
}

export async function exportPagePackage(pagePath: string): Promise<{ buffer: Buffer; title: string }> {
  const page = await readPage(pagePath);
  assertTextPage(page);

  const pageResolution = resolveVaultPath(page.path, "page");
  const assetDirectoryRelative = siblingAssetDirectory(page.path);
  const assetDirectoryAbsolute = pageResolution.absolutePath.replace(/\.html$/i, ".assets");
  const assetByFileName = new Map<
    string,
    { fileName: string; data: Buffer; sourceUrls: string[] }
  >();

  for (const sourceUrl of referencedVaultUrls(page.body)) {
    const decoded = decodeVaultUrl(sourceUrl);
    if (!decoded) continue;
    const prefix = `${assetDirectoryRelative}/`;
    if (!decoded.relativePath.startsWith(prefix)) continue;
    const fileName = decoded.relativePath.slice(prefix.length);
    if (!fileName || fileName.includes("/")) {
      throw pagePackageError("UNSAFE_PAGE_PACKAGE_PATH", `Unsafe sibling asset URL: ${sourceUrl}.`);
    }
    safeAssetEntry(`assets/${fileName}`);
    const key = fileName.toLocaleLowerCase("en-US");
    const existing = assetByFileName.get(key);
    if (existing) {
      if (existing.fileName !== fileName) {
        throw pagePackageError(
          "INVALID_PAGE_PACKAGE",
          `Referenced assets differ only by letter case: ${existing.fileName} and ${fileName}.`
        );
      }
      existing.sourceUrls.push(sourceUrl);
      continue;
    }

    const absolutePath = path.join(assetDirectoryAbsolute, fileName);
    const stat = await fs.lstat(absolutePath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw pagePackageError(
        "PAGE_PACKAGE_ASSET_MISSING",
        `Referenced page asset is missing or unsupported: ${fileName}.`
      );
    }
    if (stat.size > PAGE_PACKAGE_LIMITS.assetBytes) {
      throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", `Page asset is too large to package: ${fileName}.`, 413);
    }
    assetByFileName.set(key, {
      fileName,
      data: await fs.readFile(absolutePath),
      sourceUrls: [sourceUrl],
    });
  }

  if (assetByFileName.size > PAGE_PACKAGE_LIMITS.assetCount) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page package contains too many assets.", 413);
  }

  const bodyBytes = Buffer.byteLength(page.body, "utf8");
  if (bodyBytes > PAGE_PACKAGE_LIMITS.bodyBytes) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page HTML is too large to package.", 413);
  }

  const annotationsAbsolutePath = pageResolution.absolutePath.replace(/\.html$/i, ".annotations.json");
  const annotations = await fs.readFile(annotationsAbsolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (annotations && annotations.length > PAGE_PACKAGE_LIMITS.annotationsBytes) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page ink annotations are too large to package.", 413);
  }

  const assets: PagePackageAssetManifest[] = [];
  const zip = new AdmZip();
  for (const asset of assetByFileName.values()) {
    const entry = `assets/${asset.fileName}`;
    zip.addFile(entry, asset.data);
    assets.push({ entry, sourceUrls: asset.sourceUrls });
  }

  const manifest: PagePackageManifestV1 = {
    format: PAGE_PACKAGE_FORMAT,
    version: PAGE_PACKAGE_VERSION,
    page: {
      title: page.title,
      noteType: "text",
      metadata: portableMetadata(page),
      bodyHtml: page.body,
    },
    assets,
    ...(annotations ? { annotationsEntry: "annotations.json" as const } : {}),
  };
  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (manifestBuffer.length > PAGE_PACKAGE_LIMITS.manifestBytes) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page package manifest is too large.", 413);
  }
  zip.addFile("manifest.json", manifestBuffer);
  if (annotations) zip.addFile("annotations.json", annotations);

  const buffer = zip.toBuffer();
  if (buffer.length > PAGE_PACKAGE_LIMITS.compressedBytes) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page package is too large.", 413);
  }
  return { buffer, title: page.title };
}

function readBoundedEntry(entry: AdmZip.IZipEntry, maxBytes: number): Buffer {
  if (entry.header.size > maxBytes) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", `Package entry is too large: ${entry.entryName}.`, 413);
  }
  let data: Buffer;
  try {
    data = entry.getData();
  } catch {
    throw pagePackageError("INVALID_PAGE_PACKAGE", `Package entry could not be read: ${entry.entryName}.`);
  }
  if (data.length > maxBytes) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", `Package entry is too large: ${entry.entryName}.`, 413);
  }
  return data;
}

function parseManifest(value: unknown): PagePackageManifestV1 {
  if (!isRecord(value)) {
    throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package manifest must be a JSON object.");
  }
  if (value.format !== PAGE_PACKAGE_FORMAT) {
    throw pagePackageError("INVALID_PAGE_PACKAGE", "This file is not a Smart Notes page package.");
  }
  if (value.version !== PAGE_PACKAGE_VERSION) {
    throw pagePackageError(
      "UNSUPPORTED_PAGE_PACKAGE_VERSION",
      `Page package version ${String(value.version)} is not supported.`
    );
  }
  if (!isRecord(value.page)) {
    throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package is missing page metadata.");
  }
  if (value.page.noteType !== "text") {
    throw pagePackageError(
      "UNSUPPORTED_PAGE_PACKAGE_TYPE",
      "Page packages currently support text pages only."
    );
  }
  if (typeof value.page.title !== "string" || !value.page.title.trim() || value.page.title.length > 500) {
    throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package title is missing or invalid.");
  }
  if (typeof value.page.bodyHtml !== "string") {
    throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package HTML body is missing.");
  }
  if (Buffer.byteLength(value.page.bodyHtml, "utf8") > PAGE_PACKAGE_LIMITS.bodyBytes) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page package HTML body is too large.", 413);
  }
  if (!isRecord(value.page.metadata)) {
    throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package metadata is invalid.");
  }
  assertFrontmatterValue(value.page.metadata);
  if (!Array.isArray(value.assets) || value.assets.length > PAGE_PACKAGE_LIMITS.assetCount) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page package asset list is invalid or too large.", 413);
  }
  for (const asset of value.assets) {
    if (
      !isRecord(asset) ||
      typeof asset.entry !== "string" ||
      !Array.isArray(asset.sourceUrls) ||
      asset.sourceUrls.length < 1 ||
      asset.sourceUrls.some((url) => typeof url !== "string" || !url.startsWith("/vault/"))
    ) {
      throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package asset metadata is invalid.");
    }
    safeAssetEntry(asset.entry);
  }
  if (value.annotationsEntry !== undefined && value.annotationsEntry !== "annotations.json") {
    throw pagePackageError("UNSAFE_PAGE_PACKAGE_PATH", "Page package annotation path is invalid.");
  }
  return value as unknown as PagePackageManifestV1;
}

export function validatePagePackage(buffer: Buffer): ValidatedPagePackage {
  if (buffer.length > PAGE_PACKAGE_LIMITS.compressedBytes) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page package is too large.", 413);
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package is not a readable ZIP archive.");
  }

  const entries = zip.getEntries();
  if (entries.length > PAGE_PACKAGE_LIMITS.assetCount + 2) {
    throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page package contains too many files.", 413);
  }
  const byName = new Map<string, AdmZip.IZipEntry>();
  let declaredTotal = 0;
  for (const entry of entries) {
    const entryNameForValidation = entry.isDirectory && entry.entryName.endsWith("/")
      ? entry.entryName.slice(0, -1)
      : entry.entryName;
    const name = safeArchiveEntryName(entryNameForValidation);
    if (entry.isDirectory) {
      throw pagePackageError("INVALID_PAGE_PACKAGE", `Page package contains an unexpected directory: ${name}.`);
    }
    const key = name.toLocaleLowerCase("en-US");
    if (byName.has(key)) {
      throw pagePackageError("INVALID_PAGE_PACKAGE", `Page package contains a duplicate path: ${name}.`);
    }
    declaredTotal += entry.header.size;
    if (declaredTotal > PAGE_PACKAGE_LIMITS.totalUncompressedBytes) {
      throw pagePackageError("PAGE_PACKAGE_TOO_LARGE", "Page package expands beyond the allowed size.", 413);
    }
    byName.set(key, entry);
  }

  const manifestEntry = byName.get("manifest.json");
  if (!manifestEntry) {
    throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package is missing manifest.json.");
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(readBoundedEntry(manifestEntry, PAGE_PACKAGE_LIMITS.manifestBytes).toString("utf8"));
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package manifest is not valid JSON.");
  }
  const manifest = parseManifest(manifestJson);

  const expectedEntries = new Set(["manifest.json"]);
  const seenAssetEntries = new Set<string>();
  const seenSourceUrls = new Set<string>();
  const assets = manifest.assets.map((asset) => {
    const entryKey = asset.entry.toLocaleLowerCase("en-US");
    if (seenAssetEntries.has(entryKey)) {
      throw pagePackageError("INVALID_PAGE_PACKAGE", `Page package repeats asset entry: ${asset.entry}.`);
    }
    seenAssetEntries.add(entryKey);
    for (const sourceUrl of asset.sourceUrls) {
      if (seenSourceUrls.has(sourceUrl)) {
        throw pagePackageError("INVALID_PAGE_PACKAGE", `Page package repeats asset URL: ${sourceUrl}.`);
      }
      seenSourceUrls.add(sourceUrl);
      decodeVaultUrl(sourceUrl);
    }
    const entry = byName.get(entryKey);
    if (!entry) {
      throw pagePackageError("INVALID_PAGE_PACKAGE", `Page package is missing asset: ${asset.entry}.`);
    }
    expectedEntries.add(entryKey);
    return {
      ...asset,
      fileName: safeAssetEntry(asset.entry),
      data: readBoundedEntry(entry, PAGE_PACKAGE_LIMITS.assetBytes),
    };
  });

  let annotations: Buffer | null = null;
  if (manifest.annotationsEntry) {
    const entry = byName.get("annotations.json");
    if (!entry) {
      throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package is missing its ink annotations.");
    }
    expectedEntries.add("annotations.json");
    annotations = readBoundedEntry(entry, PAGE_PACKAGE_LIMITS.annotationsBytes);
    try {
      JSON.parse(annotations.toString("utf8"));
    } catch {
      throw pagePackageError("INVALID_PAGE_PACKAGE", "Page package ink annotations are not valid JSON.");
    }
  }

  for (const key of byName.keys()) {
    if (!expectedEntries.has(key)) {
      throw pagePackageError("INVALID_PAGE_PACKAGE", `Page package contains an unexpected file: ${byName.get(key)?.entryName}.`);
    }
  }

  return { manifest, assets, annotations };
}

const PAGE_OWNED_DIRECT_SUFFIXES = [
  ".html",
  ".assets",
  ".ink.json",
  ".annotations.json",
  ".companion.json",
  ".ref.json",
  ".log.json",
  ".form.json",
  ".design-link.json",
  ".app.json",
  ".spreadsheet.json",
  ".jupyter",
] as const;

const PAGE_OWNED_VERSION_SUFFIXES = ["", ".ink", ".annotations", ".spreadsheet"] as const;

async function pageOwnedNamespaceExists(sectionAbsolutePath: string, stem: string): Promise<boolean> {
  const entries = await fs.readdir(sectionAbsolutePath, { withFileTypes: true });
  const lowerStem = stem.toLocaleLowerCase("en-US");
  const directNames = new Set(
    PAGE_OWNED_DIRECT_SUFFIXES.map((suffix) => `${lowerStem}${suffix}`)
  );
  if (
    entries.some((entry) => {
      const lowerName = entry.name.toLocaleLowerCase("en-US");
      return directNames.has(lowerName) ||
        (lowerName.startsWith(`${lowerStem}.app-data.`) && lowerName.endsWith(".json"));
    })
  ) {
    return true;
  }

  const versionsEntry = entries.find(
    (entry) => entry.name.toLocaleLowerCase("en-US") === ".versions" && entry.isDirectory()
  );
  if (!versionsEntry) return false;
  const versionEntries = await fs.readdir(path.join(sectionAbsolutePath, versionsEntry.name)).catch(() => []);
  const versionNames = new Set(
    PAGE_OWNED_VERSION_SUFFIXES.map((suffix) => `${lowerStem}${suffix}`)
  );
  return versionEntries.some((name) => versionNames.has(name.toLocaleLowerCase("en-US")));
}

async function chooseImportPaths(sectionAbsolutePath: string, title: string) {
  const desiredFileName = fileNameFromTitle(title);
  const desiredStem = desiredFileName.replace(/\.html$/i, "");
  let counter = 1;
  while (true) {
    const stem = counter === 1 ? desiredStem : `${desiredStem}-${counter}`;
    const pagePath = path.join(sectionAbsolutePath, `${stem}.html`);
    const assetsPath = path.join(sectionAbsolutePath, `${stem}.assets`);
    const annotationsPath = path.join(sectionAbsolutePath, `${stem}.annotations.json`);
    if (!(await pageOwnedNamespaceExists(sectionAbsolutePath, stem))) {
      return { stem, pagePath, assetsPath, annotationsPath };
    }
    counter += 1;
  }
}

function rewriteAssetUrls(bodyHtml: string, replacements: Map<string, string>): string {
  return bodyHtml.replace(/\b(src|href)(\s*=\s*)(["'])(.*?)\3/gi, (match, attribute, equals, quote, value) => {
    const replacement = replacements.get(value);
    return replacement ? `${attribute}${equals}${quote}${replacement}${quote}` : match;
  });
}

export async function importPagePackage(input: ImportPagePackageInput): Promise<VaultPageDocument> {
  const validated = validatePagePackage(input.buffer);
  const section = resolveVaultPath(input.sectionPath, "section");
  const sectionStat = await fs.stat(section.absolutePath).catch(() => null);
  if (!sectionStat?.isDirectory()) {
    throw pagePackageError("SECTION_NOT_FOUND", `Section not found: ${section.relativePath}.`, 404);
  }

  const targets = await chooseImportPaths(section.absolutePath, validated.manifest.page.title);
  const relativePagePath = toVaultRelativePath(
    path.posix.join(section.relativePath, `${targets.stem}.html`)
  );
  const relativeAssetDirectory = siblingAssetDirectory(relativePagePath);
  const replacements = new Map<string, string>();
  for (const asset of validated.assets) {
    const targetUrlBase = encodeVaultPath(path.posix.join(relativeAssetDirectory, asset.fileName));
    for (const sourceUrl of asset.sourceUrls) {
      const decoded = decodeVaultUrl(sourceUrl);
      replacements.set(sourceUrl, `${targetUrlBase}${decoded?.suffix ?? ""}`);
    }
  }

  const metadata: FrontmatterData = { ...validated.manifest.page.metadata };
  delete metadata.comments;
  delete metadata.parent_id;
  delete metadata.note_type;
  metadata.title = validated.manifest.page.title.trim();
  const serialized = serializeFrontmatterDocument(
    metadata,
    rewriteAssetUrls(validated.manifest.page.bodyHtml, replacements)
  );

  const stagingDirectory = path.join(section.absolutePath, `.sn-page-import-${randomUUID()}.tmp`);
  const stagedPagePath = path.join(stagingDirectory, "page.html");
  const stagedAssetsPath = path.join(stagingDirectory, "assets");
  const stagedAnnotationsPath = path.join(stagingDirectory, "annotations.json");
  const committedPaths: Array<{ path: string; recursive: boolean }> = [];
  let pageCommitted = false;

  try {
    await fs.mkdir(stagingDirectory);
    await fs.writeFile(stagedPagePath, serialized, { encoding: "utf8", flag: "wx" });
    if (validated.assets.length) {
      await fs.mkdir(stagedAssetsPath);
      for (const asset of validated.assets) {
        await fs.writeFile(path.join(stagedAssetsPath, asset.fileName), asset.data, { flag: "wx" });
      }
    }
    if (validated.annotations) {
      await fs.writeFile(stagedAnnotationsPath, validated.annotations, { flag: "wx" });
    }

    if (validated.assets.length) {
      await fs.mkdir(targets.assetsPath);
      committedPaths.push({ path: targets.assetsPath, recursive: true });
      for (const asset of validated.assets) {
        await fs.link(
          path.join(stagedAssetsPath, asset.fileName),
          path.join(targets.assetsPath, asset.fileName)
        );
      }
    }
    if (validated.annotations) {
      await fs.link(stagedAnnotationsPath, targets.annotationsPath);
      committedPaths.push({ path: targets.annotationsPath, recursive: false });
    }
    await fs.link(stagedPagePath, targets.pagePath);
    pageCommitted = true;
  } catch (error) {
    if (!pageCommitted) {
      for (const committed of committedPaths.reverse()) {
        await fs.rm(committed.path, { recursive: committed.recursive, force: true }).catch(() => undefined);
      }
    }
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof VaultError) throw error;
    throw pagePackageError(
      "PAGE_PACKAGE_IMPORT_FAILED",
      "Page package could not be imported; the vault was left unchanged.",
      500
    );
  }

  await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  invalidateVaultTreeCache();
  return readPage(relativePagePath);
}
