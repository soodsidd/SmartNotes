/**
 * SN-282: Companion paper tools. Every mutation goes through the same vault
 * primitives as the UI (createPaper, savePage, uploadPageAsset, deletePage) so
 * Bibliography ownership, snapshots, and attachment durability stay identical.
 */
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
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
import { snapshotPageContent } from "./versions";

export const PAPER_PDF_DOWNLOAD_LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  timeoutMs: 60_000,
  maxRedirects: 5,
} as const;

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
  const saved = await savePage({ path: page.path, title: page.title, body: appendHtmlBlock(page.body, paperReferenceHtml(id)) });
  return { page: saved, paper: canonical, added: true };
}

export async function createPaperForCompanion(input: { title: string; referenceFromPath?: string }) {
  const paper = await createPaper(input.title);
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
  return `<p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${safeHref}">${escapeHtml(fileName)}</span></span></p>`;
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
  const saved = await savePage({ path: page.path, title: page.title, body: appendHtmlBlock(page.body, pdfAttachmentChipHtml(asset.url, asset.fileName)) });
  return {
    page: saved,
    attachment: { href: asset.url, path: asset.path, fileName: asset.fileName, bytes: download.buffer.length, sourceUrl: download.url },
  };
}
