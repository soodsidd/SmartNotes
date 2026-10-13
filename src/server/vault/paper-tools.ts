/**
 * SN-282 / SN-302: Companion paper tools. Every mutation goes through the same
 * vault primitives as the UI (createPaper, savePage, uploadPageAsset, deletePage)
 * so Bibliography ownership, snapshots, and attachment durability stay identical.
 */
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import * as cheerio from "cheerio";
import {
  BIBLIOGRAPHY_PATH,
  PAPER_ID_PATTERN,
  isBibliographyPath,
  paperPath,
  paperReferenceHtml,
  paperReferenceIds,
  removePaperReferences,
} from "@/lib/papers";
import { escapeHtml } from "./html-utils";
import { VaultError } from "./errors";
import { appendHtmlBlock } from "./page-format";
import { createPaper, deletePage, readPage, readVaultTree, savePage } from "./pages";
import { uploadPageAsset } from "./assets";
import { findEmbeddedPdfReferences } from "./companion-context";
import { resolveVaultPath, toVaultRelativePath } from "./paths";
import { snapshotPageContent } from "./versions";

export const PAPER_PDF_DOWNLOAD_LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  timeoutMs: 60_000,
  maxRedirects: 5,
} as const;

/** A new paper's body is the "<p></p>" placeholder; replace it instead of appending under it. */
function appendToPaperBody(body: string, fragment: string): string {
  return /^\s*(<p>\s*<\/p>\s*)*$/i.test(body) ? fragment : appendHtmlBlock(body, fragment);
}

export interface PaperSummary {
  id: string;
  path: string;
  title: string;
  referrers: Array<{ path: string; title: string }>;
}

/** Accept a paper id, a canonical `.bibliography/<id>.html` path, or `/vault/...` form. */
export function resolvePaperPath(value: string): string {
  const trimmed = value.trim().replace(/^\/vault\//, "").replace(/\\/g, "/");
  if (PAPER_ID_PATTERN.test(trimmed)) return paperPath(trimmed);
  const withExtension = /\.html$/i.test(trimmed) ? trimmed : `${trimmed}.html`;
  const id = withExtension.slice(BIBLIOGRAPHY_PATH.length + 1, -".html".length);
  if (!isBibliographyPath(withExtension) || !PAPER_ID_PATTERN.test(id)) {
    throw new VaultError("NOT_A_PAPER", `"${value}" is not a Bibliography paper. Pass a paper id or a .bibliography/<id>.html path.`, 400);
  }
  return paperPath(id);
}

async function allPages() {
  const { tree } = await readVaultTree({ skipCache: true });
  return tree.flatMap((notebook) => [...notebook.pages, ...notebook.sections.flatMap((section) => section.pages)]);
}

export async function listPapers(query = ""): Promise<PaperSummary[]> {
  const pages = await allPages();
  const needle = query.trim().toLowerCase();
  return pages
    .filter((page) => isBibliographyPath(page.path) && (!needle || page.title.toLowerCase().includes(needle)))
    .map((page) => {
      const id = String(page.metadata?.paper_id ?? "");
      return {
        id,
        path: page.path,
        title: page.title,
        referrers: pages
          .filter((other) => other.path !== page.path && paperReferenceIds(other.content).includes(id))
          .map((other) => ({ path: other.path, title: other.title })),
      };
    });
}

/** Adds the SN-279 reference node; the virtual child row follows from the parent HTML. */
export async function addPaperReference(pagePath: string, paper: string) {
  const canonical = await readPage(resolvePaperPath(paper));
  const id = String(canonical.metadata.paper_id);
  const page = await readPage(pagePath);
  if (page.path === canonical.path) {
    throw new VaultError("INVALID_INPUT", "A paper cannot reference itself.", 400);
  }
  if (paperReferenceIds(page.body).includes(id)) {
    return { page, paper: canonical, added: false };
  }
  await snapshotPageContent(page.path);
  const saved = await savePage({ path: page.path, title: page.title, body: appendToPaperBody(page.body, paperReferenceHtml(id)) });
  return { page: saved, paper: canonical, added: true };
}

export async function createPaperForCompanion(input: { title: string; homeNotebookPath?: string; referenceFromPath?: string }) {
  const { tree } = await readVaultTree({ skipCache: true });
  const home = input.homeNotebookPath ?? tree.find((notebook) => input.referenceFromPath?.startsWith(`${notebook.path}/`))?.path;
  if (!home) throw new VaultError("INVALID_NOTEBOOK", "Choose a home notebook for this paper.", 400);
  const paper = await createPaper(input.title, home);
  const reference = input.referenceFromPath ? await addPaperReference(input.referenceFromPath, paper.path) : null;
  return { paper, referencedFrom: reference?.page ?? null };
}

/**
 * Defined safe removal: every reference node for the paper is cleared from its
 * referring pages first (each snapshotted, so it is restorable), then the paper
 * and its assets are deleted. No dangling "Unavailable paper" chips remain.
 */
export async function removePaper(paper: string) {
  const canonicalPath = resolvePaperPath(paper);
  const canonical = await readPage(canonicalPath);
  const id = String(canonical.metadata.paper_id);
  const cleared: Array<{ path: string; title: string; body: string }> = [];
  for (const page of await allPages()) {
    if (page.path === canonicalPath || !paperReferenceIds(page.content).includes(id)) continue;
    const current = await readPage(page.path);
    await snapshotPageContent(current.path);
    const saved = await savePage({ path: current.path, title: current.title, body: removePaperReferences(current.body, id) });
    cleared.push({ path: saved.path, title: saved.title, body: saved.body });
  }
  await deletePage(canonicalPath);
  return { id, path: canonicalPath, title: canonical.title, clearedReferences: cleared };
}

// ---------------------------------------------------------------------------
// PDF download + attach
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type LookupLike = (hostname: string) => Promise<Array<{ address: string }>>;

function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    if (ip.startsWith("::ffff:")) return isPrivateAddress(ip.slice(7));
    return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }
  return false;
}

async function assertPublicUrl(raw: string, lookup: LookupLike): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new VaultError("INVALID_URL", `"${raw}" is not a valid URL.`, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new VaultError("INVALID_URL", "Only http(s) PDF URLs can be downloaded.", 400);
  }
  const host = url.hostname.toLowerCase();
  const addresses = net.isIP(host.replace(/^\[|\]$/g, "")) ? [{ address: host }] : await lookup(host).catch(() => {
    throw new VaultError("PDF_DOWNLOAD_FAILED", `Could not resolve ${host}.`, 502);
  });
  if (host === "localhost" || host.endsWith(".localhost") || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new VaultError("INVALID_URL", "PDF downloads from local or private network addresses are not allowed.", 400);
  }
  return url;
}

function fileNameFromResponse(url: URL, response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*\s*=\s*(?:UTF-8'')?["']?([^;"']+)/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*["']?([^;"']+)/i)?.[1];
  let name = "";
  try {
    name = encoded ? decodeURIComponent(encoded) : plain ?? decodeURIComponent(path.posix.basename(url.pathname));
  } catch {
    name = plain ?? "";
  }
  return name.trim();
}

function pdfFileName(requested: string, fallback: string): string {
  const base = path.basename((requested || fallback || "paper").trim()).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "paper";
  return /\.pdf$/i.test(base) ? base : `${base.replace(/\.[^.]*$/, "") || "paper"}.pdf`;
}

async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new VaultError("PDF_TOO_LARGE", `PDF exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB download limit.`, 413);
  }
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new VaultError("PDF_TOO_LARGE", `PDF exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB download limit.`, 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function downloadPdf(
  rawUrl: string,
  options: { fetchImpl?: FetchLike; lookup?: LookupLike; maxBytes?: number; timeoutMs?: number } = {}
) {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const lookup = options.lookup ?? ((hostname) => dns.lookup(hostname, { all: true }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PAPER_PDF_DOWNLOAD_LIMITS.timeoutMs);
  try {
    let url = await assertPublicUrl(rawUrl, lookup);
    for (let hop = 0; ; hop += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: "application/pdf,*/*;q=0.5", "user-agent": "SmartNotes/1.0 (paper PDF attach)" },
        });
      } catch (error) {
        const aborted = controller.signal.aborted;
        throw new VaultError("PDF_DOWNLOAD_FAILED", aborted ? "PDF download timed out." : `PDF download failed: ${(error as Error).message}`, 502);
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        if (hop >= PAPER_PDF_DOWNLOAD_LIMITS.maxRedirects) throw new VaultError("PDF_DOWNLOAD_FAILED", "Too many redirects.", 502);
        // Every hop is re-validated so a public URL cannot redirect into the local network.
        url = await assertPublicUrl(new URL(response.headers.get("location")!, url).toString(), lookup);
        continue;
      }
      if (!response.ok) {
        throw new VaultError("PDF_DOWNLOAD_FAILED", `PDF download failed with HTTP ${response.status}.`, 502);
      }
      const buffer = await readBounded(response, options.maxBytes ?? PAPER_PDF_DOWNLOAD_LIMITS.maxBytes);
      // Content-Type is often wrong (octet-stream, or an HTML landing page); the magic bytes decide.
      if (buffer.subarray(0, 1024).indexOf("%PDF-") === -1) {
        throw new VaultError("NOT_A_PDF", `The URL did not return a PDF (content-type ${response.headers.get("content-type") ?? "unknown"}). Use the direct PDF link, not the landing page.`, 422);
      }
      return { buffer, url: url.toString(), suggestedName: fileNameFromResponse(url, response) };
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Same chip markup the editor's FileAttachment node renders for a PDF upload. */
export function pdfAttachmentChipHtml(href: string, fileName: string): string {
  const safeHref = escapeHtml(href);
  const safeName = escapeHtml(fileName);
  return `<p><span href="${safeHref}" filename="${safeName}" data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${safeHref}">${safeName}</span></span></p>`;
}

export async function attachPdfToPaper(
  input: { paper: string; url: string; fileName?: string },
  options: Parameters<typeof downloadPdf>[1] = {}
) {
  const canonicalPath = resolvePaperPath(input.paper);
  await readPage(canonicalPath);
  const download = await downloadPdf(input.url, options);
  const fileName = pdfFileName(input.fileName ?? "", download.suggestedName);
  const asset = await uploadPageAsset(canonicalPath, fileName, download.buffer);
  // Re-read after the download so concurrent note edits are not overwritten.
  const page = await readPage(canonicalPath);
  await snapshotPageContent(page.path);
  const saved = await savePage({ path: page.path, title: page.title, body: appendToPaperBody(page.body, pdfAttachmentChipHtml(asset.url, asset.fileName)) });
  return {
    page: saved,
    attachment: { href: asset.url, path: asset.path, fileName: asset.fileName, bytes: download.buffer.length, sourceUrl: download.url },
  };
}

// ---------------------------------------------------------------------------
// SN-302: Promote an existing vault PDF to a Bibliography paper
// ---------------------------------------------------------------------------

function decodeVaultSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Normalize a vault-relative path or `/vault/...` href to a vault-relative `.pdf` path. */
export function normalizeVaultPdfSource(sourcePathOrHref: string): string {
  const raw = sourcePathOrHref.trim();
  if (!raw) {
    throw new VaultError("INVALID_INPUT", "Pass sourcePath or href for a vault PDF.", 400);
  }
  if (/^https?:\/\//i.test(raw)) {
    throw new VaultError(
      "INVALID_URL",
      "paper_create_from_pdf accepts a vault PDF path/href, not a web URL. Use paper_attach_pdf for http(s) downloads.",
      400
    );
  }
  const cleaned = raw.replace(/\\/g, "/").split("#")[0]!.split("?")[0]!.trim();
  const withoutVault = cleaned.startsWith("/vault/")
    ? cleaned.slice("/vault/".length)
    : cleaned.replace(/^\/+/, "");
  const relative = toVaultRelativePath(withoutVault.split("/").map(decodeVaultSegment).join("/"));
  if (!relative || !relative.toLowerCase().endsWith(".pdf")) {
    throw new VaultError("NOT_A_PDF", `"${sourcePathOrHref}" is not a vault PDF path or /vault/… href.`, 400);
  }
  return relative;
}

export function titleFromPdfFileName(fileName: string): string {
  const base = path.posix.basename(fileName.trim() || "paper.pdf");
  const withoutExt = base.replace(/\.pdf$/i, "").trim();
  return withoutExt || "Untitled paper";
}

function hrefMatchNeedles(sourcePathOrHref: string): string[] {
  const relative = normalizeVaultPdfSource(sourcePathOrHref);
  const encoded = relative.split("/").map(encodeURIComponent).join("/");
  return [relative, `/vault/${relative}`, `/vault/${encoded}`, encoded];
}

function hrefMatchesSource(href: string, needles: string[]): boolean {
  const cleaned = href.trim().replace(/\\/g, "/").split("#")[0]!.split("?")[0]!;
  const decoded = decodeVaultSegment(cleaned);
  return needles.some((needle) => cleaned === needle || decoded === needle || cleaned.endsWith(needle) || decoded.endsWith(needle));
}

/** Remove PDF attachment chips that point at the given vault asset; empty wrapper paragraphs go too. */
export function removePdfAttachmentChip(html: string, sourcePathOrHref: string): string {
  const needles = hrefMatchNeedles(sourcePathOrHref);
  const $ = cheerio.load(html, undefined, false);
  $("[data-file-type='pdf']").each((_index, element) => {
    const node = $(element);
    const href =
      node.attr("href") ||
      node.find("[data-href]").attr("data-href") ||
      node.find("a").attr("href") ||
      "";
    if (!hrefMatchesSource(href, needles)) return;
    const parent = node.parent();
    node.remove();
    if (parent.is("p") && !parent.text().trim() && parent.children().length === 0) {
      parent.remove();
    }
  });
  return $.root().html() ?? html;
}

async function readVaultPdfBytes(sourcePath: string) {
  const resolved = resolveVaultPath(sourcePath, "section");
  const stat = await fs.stat(resolved.absolutePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new VaultError("PDF_UNAVAILABLE", `Vault PDF not found: ${sourcePath}`, 404);
  }
  const buffer = await fs.readFile(resolved.absolutePath);
  if (buffer.subarray(0, 1024).indexOf("%PDF-") === -1) {
    throw new VaultError("NOT_A_PDF", `"${sourcePath}" is not a PDF file.`, 422);
  }
  return { buffer, absolutePath: resolved.absolutePath, fileName: path.posix.basename(sourcePath) };
}

/**
 * Find a Bibliography paper that already owns/links this exact vault PDF asset.
 * Prefer paper-asset ownership, then paper_source provenance, then embedded chips.
 */
export async function findPaperForVaultPdf(sourcePathOrHref: string) {
  const sourcePath = normalizeVaultPdfSource(sourcePathOrHref);
  const assetOwner = sourcePath.match(/^\.bibliography\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.assets\//i);
  if (assetOwner) {
    const paper = await readPage(paperPath(assetOwner[1]!));
    return { id: String(paper.metadata.paper_id), path: paper.path, title: paper.title, page: paper };
  }

  const pages = await allPages();
  for (const page of pages) {
    if (!isBibliographyPath(page.path)) continue;
    const source = typeof page.metadata?.paper_source === "string" ? page.metadata.paper_source.trim() : "";
    if (source && !/^https?:\/\//i.test(source)) {
      try {
        if (normalizeVaultPdfSource(source) === sourcePath) {
          return { id: String(page.metadata?.paper_id ?? ""), path: page.path, title: page.title, page };
        }
      } catch {
        // Non-vault paper_source values (titles, DOIs without scheme) are ignored for ownership.
      }
    }
    const refs = findEmbeddedPdfReferences(page.path, page.content);
    if (refs.some((ref) => ref.href === sourcePath)) {
      return { id: String(page.metadata?.paper_id ?? ""), path: page.path, title: page.title, page };
    }
  }
  return null;
}

async function removeChipFromReferringPage(pagePath: string, sourcePath: string) {
  const page = await readPage(pagePath);
  const nextBody = removePdfAttachmentChip(page.body, sourcePath);
  if (nextBody === page.body) return { page, replaced: false };
  await snapshotPageContent(page.path);
  const saved = await savePage({ path: page.path, title: page.title, body: nextBody });
  return { page: saved, replaced: true };
}

/**
 * Shared promote primitive (UI + Companion): create (or reuse) a paper, copy the
 * vault PDF onto it as a page asset by default, insert a paper chip on the source
 * page, and optionally remove the original PDF chip.
 */
export async function createPaperFromVaultPdf(input: {
  sourcePath?: string;
  href?: string;
  title?: string;
  homeNotebookPath?: string;
  referenceFromPath?: string;
  replaceChip?: boolean;
}) {
  const sourcePath = normalizeVaultPdfSource(input.sourcePath || input.href || "");
  const referenceFromPath = input.referenceFromPath?.trim() || undefined;
  const replaceChip = input.replaceChip === true;

  const existing = await findPaperForVaultPdf(sourcePath);
  if (existing) {
    const reference = referenceFromPath ? await addPaperReference(referenceFromPath, existing.path) : null;
    const removed = replaceChip && referenceFromPath
      ? await removeChipFromReferringPage(referenceFromPath, sourcePath)
      : { page: reference?.page ?? null, replaced: false };
    return {
      paper: { id: existing.id, path: existing.path, title: existing.title },
      created: false,
      referencedFrom: removed.page ?? reference?.page ?? null,
      replacedChip: removed.replaced,
      attachment: null as null,
    };
  }

  const { tree } = await readVaultTree({ skipCache: true });
  const home =
    input.homeNotebookPath?.trim() ||
    tree.find((notebook) => referenceFromPath?.startsWith(`${notebook.path}/`))?.path;
  if (!home) {
    throw new VaultError("INVALID_NOTEBOOK", "Choose a home notebook for this paper.", 400);
  }

  const pdf = await readVaultPdfBytes(sourcePath);
  const title = (input.title?.trim() || titleFromPdfFileName(pdf.fileName)).trim();
  const paper = await createPaper(title, home, sourcePath);
  const asset = await uploadPageAsset(paper.path, pdf.fileName, pdf.buffer);
  const paperPage = await readPage(paper.path);
  await snapshotPageContent(paperPage.path);
  const savedPaper = await savePage({
    path: paperPage.path,
    title: paperPage.title,
    body: appendToPaperBody(paperPage.body, pdfAttachmentChipHtml(asset.url, asset.fileName)),
  });

  const reference = referenceFromPath ? await addPaperReference(referenceFromPath, savedPaper.path) : null;
  const removed = replaceChip && referenceFromPath
    ? await removeChipFromReferringPage(referenceFromPath, sourcePath)
    : { page: reference?.page ?? null, replaced: false };

  return {
    paper: { id: String(savedPaper.metadata.paper_id), path: savedPaper.path, title: savedPaper.title },
    created: true,
    referencedFrom: removed.page ?? reference?.page ?? null,
    replacedChip: removed.replaced,
    attachment: { href: asset.url, path: asset.path, fileName: asset.fileName, bytes: pdf.buffer.length, sourcePath },
  };
}
