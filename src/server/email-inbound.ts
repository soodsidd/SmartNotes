import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { getAppStateDir } from "@/server/app-state";
import { emitVaultSideEffects } from "@/server/vault/socket-events";
import { getVaultRoot } from "@/server/vault/config";
import { serializeFrontmatterDocument } from "@/server/vault/frontmatter";
import { escapeHtml, stripHtml } from "@/server/vault/html-utils";
import { loadNotebookRegistry } from "@/server/vault/notebook-registry";
import {
  ensureInboxSection,
  invalidateVaultTreeCache,
  readPage,
  readVaultTree,
  toApiPageDocument,
} from "@/server/vault/pages";
import { fileNameFromTitle, resolveVaultPath, toVaultRelativePath } from "@/server/vault/paths";

export const MAX_RAW_EMAIL_BYTES = 5 * 1024 * 1024;
export const EMAIL_ENVELOPE_FROM_HEADER = "x-smart-notes-envelope-from";

const EMAIL_STATE_DIRECTORY = "email-inbound";
const TRANSACTION_DIRECTORY = "transactions";
const DEDUPE_DIRECTORY = "dedupe";
const TEMP_FILE_PREFIX = ".sn-email-";

export class EmailInboundError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "EmailInboundError";
    this.code = code;
    this.status = status;
  }
}

export interface EmailRoutingMetadata {
  requestedPrefix: string | null;
  matchedNotebookPath: string | null;
  fallbackReason: "no-prefix" | "empty-prefix" | "empty-title" | "unresolved" | "ambiguous" | null;
}

export interface EmailReferenceSidecar {
  version: 1;
  sourceUrl: string;
  type: "email";
  tags: ["email"];
  email: {
    messageId: string | null;
    sender: string;
    envelopeSender: string;
    recipients: string[];
    receivedAt: string | null;
    originalSubject: string;
    routing: EmailRoutingMetadata;
    ignoredAttachmentCount: number;
    dedupeKind: "message-id" | "raw-mime-sha256";
  };
}

export interface EmailInboundResult {
  created: boolean;
  id: string;
  page: ReturnType<typeof toApiPageDocument>;
  reference: EmailReferenceSidecar;
}

interface DedupeRecord {
  version: 1;
  keyHash: string;
  pagePath: string;
  reference: EmailReferenceSidecar;
  createdAt: string;
}

interface TransactionFile {
  kind: "page" | "reference" | "dedupe";
  temporaryPath: string;
  targetPath: string;
  sha256: string;
}

interface TransactionJournal {
  version: 1;
  id: string;
  state: "preparing";
  files: TransactionFile[];
}

interface TestHooks {
  beforeCommitFile?: (file: TransactionFile, index: number) => void | Promise<void>;
}

let testHooks: TestHooks = {};
let ingestQueue: Promise<void> = Promise.resolve();

export function setEmailInboundTestHooksForTesting(hooks: TestHooks): void {
  testHooks = hooks;
}

export function resetEmailInboundTestHooksForTesting(): void {
  testHooks = {};
}

export function resetEmailInboundProcessStateForTesting(): void {
  testHooks = {};
  ingestQueue = Promise.resolve();
}

function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Hashing both inputs first keeps timingSafeEqual on equal-length buffers. */
export function constantTimeTokenEqual(candidate: string, expected: string): boolean {
  const candidateDigest = crypto.createHash("sha256").update(candidate).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(candidateDigest, expectedDigest);
}

export function parseAllowedSenders(value: string | undefined): Set<string> {
  return new Set(
    String(value ?? "")
      .split(/[;,\n\r]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function normalizeEnvelopeSender(value: string | null): string {
  const sender = String(value ?? "").trim().toLowerCase();
  if (!sender || !/^[^@\s<>,]+@[^@\s<>,]+$/.test(sender)) {
    throw new EmailInboundError(
      "ENVELOPE_SENDER_REQUIRED",
      "A valid authenticated envelope sender is required.",
      403
    );
  }
  return sender;
}

export function logEmailInbound(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown> = {}
): void {
  const payload = JSON.stringify({ event, ...details });
  if (level === "error") {
    console.error(`[email-inbound] ${payload}`);
  } else if (level === "warn") {
    console.warn(`[email-inbound] ${payload}`);
  } else {
    console.info(`[email-inbound] ${payload}`);
  }
}

function addressValues(address: AddressObject | AddressObject[] | undefined): string[] {
  const groups = Array.isArray(address) ? address : address ? [address] : [];
  return groups.flatMap((group) => group.value)
    .map((entry) => entry.address?.trim().toLowerCase() ?? "")
    .filter(Boolean);
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[)>\]},.!?;:'"]+$/g, "");
}

export function firstSafeHttpUrl(...sources: Array<string | undefined | false>): string | null {
  for (const source of sources) {
    if (!source) continue;
    const matches = source.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
    for (const match of matches) {
      const candidate = trimUrlPunctuation(match.replace(/&amp;/gi, "&"));
      try {
        const parsed = new URL(candidate);
        if (
          (parsed.protocol === "http:" || parsed.protocol === "https:") &&
          parsed.hostname &&
          !parsed.username &&
          !parsed.password &&
          !/[\u0000-\u001f\u007f]/.test(candidate)
        ) {
          return parsed.toString();
        }
      } catch {
        // Ignore malformed or unsafe URL candidates and keep scanning.
      }
    }
  }
  return null;
}

function plainTextToHtml(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

const ALLOWED_EMAIL_TAGS = new Set([
  "p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
  "ul", "ol", "li", "strong", "em", "b", "i", "u", "s", "a", "table", "thead",
  "tbody", "tfoot", "tr", "th", "td", "hr",
]);

const REMOVED_EMAIL_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "img", "svg", "canvas", "video", "audio",
  "source", "form", "input", "button", "textarea", "select", "option", "noscript", "template",
  "meta", "link", "base", "head",
]);

function safeLinkHref(value: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) return value;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname &&
      !parsed.username &&
      !parsed.password
    ) {
      return parsed.toString();
    }
  } catch {
    // Invalid URL attributes are removed below.
  }
  return null;
}

export function sanitizeEmailHtml(html: string): string {
  const $ = cheerio.load(html, null, false);
  $("*").toArray().forEach((element) => {
    if (!("tagName" in element)) return;
    const htmlElement = element as Element;
    const tagName = htmlElement.tagName.toLowerCase();
    const node = $(htmlElement);
    if (REMOVED_EMAIL_TAGS.has(tagName)) {
      node.remove();
      return;
    }
    if (!ALLOWED_EMAIL_TAGS.has(tagName)) {
      node.replaceWith(node.contents());
      return;
    }

    const originalAttributes = { ...htmlElement.attribs };
    for (const attributeName of Object.keys(originalAttributes)) {
      node.removeAttr(attributeName);
    }
    if (tagName === "a") {
      const href = originalAttributes.href ? safeLinkHref(originalAttributes.href.trim()) : null;
      if (href) node.attr("href", href);
      if (originalAttributes.title) node.attr("title", originalAttributes.title);
      node.attr("rel", "noopener noreferrer");
    }
    if (tagName === "td" || tagName === "th") {
      for (const attribute of ["colspan", "rowspan"] as const) {
        const value = originalAttributes[attribute];
        if (value && /^\d{1,3}$/.test(value)) node.attr(attribute, value);
      }
    }
  });
  return $.root().html()?.trim() ?? "";
}

function hasUsableHtmlBody(html: string): boolean {
  const text = stripHtml(html).replace(/\u00a0/g, " ").trim();
  return Boolean(text);
}

function normalizedBody(parsed: ParsedMail): { html: string; urlSource: string } {
  const parsedHtml = typeof parsed.html === "string" ? parsed.html : "";
  if (parsedHtml) {
    const sanitized = sanitizeEmailHtml(parsedHtml);
    if (sanitized && hasUsableHtmlBody(sanitized)) {
      return { html: sanitized, urlSource: sanitized };
    }
  }

  const plain = parsed.text?.trim() ?? "";
  if (plain) {
    return { html: plainTextToHtml(plain), urlSource: plain };
  }

  throw new EmailInboundError("EMPTY_EMAIL_BODY", "Email has no usable body after attachments are removed.", 400);
}

function normalizeMessageId(messageId: string | undefined): string | null {
  const normalized = messageId?.trim();
  return normalized ? normalized : null;
}

function receivedAt(parsed: ParsedMail): string | null {
  const date = parsed.date;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function resolveEmailRouting(subject: string): Promise<{
  title: string;
  notebookPath?: string;
  metadata: EmailRoutingMetadata;
}> {
  const commaIndex = subject.indexOf(",");
  if (commaIndex < 0) {
    return {
      title: subject,
      metadata: { requestedPrefix: null, matchedNotebookPath: null, fallbackReason: "no-prefix" },
    };
  }

  const requestedPrefix = subject.slice(0, commaIndex).trim();
  const routedTitle = subject.slice(commaIndex + 1).trim();
  if (!requestedPrefix) {
    return {
      title: subject,
      metadata: { requestedPrefix, matchedNotebookPath: null, fallbackReason: "empty-prefix" },
    };
  }
  if (!routedTitle) {
    return {
      title: subject,
      metadata: { requestedPrefix, matchedNotebookPath: null, fallbackReason: "empty-title" },
    };
  }

  const normalizedPrefix = requestedPrefix.toLocaleLowerCase();
  const { tree } = await readVaultTree({ skipCache: true });
  const matches = tree.filter((notebook) =>
    notebook.name.toLocaleLowerCase() === normalizedPrefix ||
    notebook.path.toLocaleLowerCase() === normalizedPrefix
  );

  if (matches.length === 1) {
    return {
      title: routedTitle,
      notebookPath: matches[0].path,
      metadata: {
        requestedPrefix,
        matchedNotebookPath: matches[0].path,
        fallbackReason: null,
      },
    };
  }

  return {
    title: subject,
    metadata: {
      requestedPrefix,
      matchedNotebookPath: null,
      fallbackReason: matches.length > 1 ? "ambiguous" : "unresolved",
    },
  };
}

function emailStateRoot(): string {
  return path.join(getAppStateDir(), EMAIL_STATE_DIRECTORY);
}

function dedupePath(keyHash: string): string {
  return path.join(emailStateRoot(), DEDUPE_DIRECTORY, `${keyHash}.json`);
}

function journalPath(transactionId: string): string {
  return path.join(emailStateRoot(), TRANSACTION_DIRECTORY, transactionId, "journal.json");
}

async function writeJsonAtomically(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function allowedVaultRoots(): string[] {
  return [getVaultRoot(), ...loadNotebookRegistry().notebooks.map((entry) => entry.rootPath)];
}

function isSafeJournalFile(file: TransactionFile): boolean {
  if (!path.basename(file.temporaryPath).startsWith(TEMP_FILE_PREFIX)) return false;
  if (file.kind === "dedupe") {
    return isPathInside(file.targetPath, path.join(emailStateRoot(), DEDUPE_DIRECTORY));
  }
  if (!allowedVaultRoots().some((root) => isPathInside(file.targetPath, root))) return false;
  if (file.kind === "page") return file.targetPath.toLowerCase().endsWith(".html");
  return file.targetPath.toLowerCase().endsWith(".ref.json");
}

async function fileMatchesHash(filePath: string, expectedHash: string): Promise<boolean> {
  try {
    return sha256(await fs.readFile(filePath)) === expectedHash;
  } catch {
    return false;
  }
}

async function rollBackJournal(journal: TransactionJournal): Promise<void> {
  for (const file of journal.files) {
    if (!isSafeJournalFile(file)) continue;
    await fs.rm(file.temporaryPath, { force: true }).catch(() => undefined);
    if (await fileMatchesHash(file.targetPath, file.sha256)) {
      await fs.rm(file.targetPath, { force: true }).catch(() => undefined);
    }
  }
}

async function recoverInterruptedTransactions(): Promise<void> {
  const transactionsRoot = path.join(emailStateRoot(), TRANSACTION_DIRECTORY);
  const entries = await fs.readdir(transactionsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transactionDirectory = path.join(transactionsRoot, entry.name);
    const stored = await fs.readFile(path.join(transactionDirectory, "journal.json"), "utf8").catch(() => null);
    if (!stored) {
      await fs.rm(transactionDirectory, { recursive: true, force: true });
      continue;
    }
    try {
      const journal = JSON.parse(stored) as TransactionJournal;
      if (journal.version !== 1 || !Array.isArray(journal.files)) throw new Error("Invalid journal");
      await rollBackJournal(journal);
      logEmailInbound("warn", "transaction-recovered", { transactionId: journal.id });
      await fs.rm(transactionDirectory, { recursive: true, force: true });
    } catch (error) {
      logEmailInbound("error", "transaction-recovery-failed", {
        transactionId: entry.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new EmailInboundError("EMAIL_TRANSACTION_RECOVERY_FAILED", "Email transaction recovery failed.", 500);
    }
  }
}

async function nextPageTarget(sectionPath: string, title: string): Promise<{ absolutePath: string; relativePath: string }> {
  const section = resolveVaultPath(sectionPath, "section");
  const desired = fileNameFromTitle(title);
  const stem = desired.replace(/\.html$/i, "");
  let attempt = 1;
  while (true) {
    const fileName = attempt === 1 ? desired : `${stem}-${attempt}.html`;
    const absolutePath = path.join(section.absolutePath, fileName);
    const referencePath = absolutePath.replace(/\.html$/i, ".ref.json");
    const [pageExists, referenceExists] = await Promise.all([
      fs.stat(absolutePath).then(() => true).catch(() => false),
      fs.stat(referencePath).then(() => true).catch(() => false),
    ]);
    if (!pageExists && !referenceExists) {
      return {
        absolutePath,
        relativePath: toVaultRelativePath(path.posix.join(section.relativePath, fileName)),
      };
    }
    attempt += 1;
  }
}

async function readDedupeRecord(keyHash: string): Promise<DedupeRecord | null> {
  const stored = await fs.readFile(dedupePath(keyHash), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stored) return null;
  try {
    const record = JSON.parse(stored) as DedupeRecord;
    if (record.version !== 1 || record.keyHash !== keyHash || !record.pagePath || !record.reference) {
      throw new Error("Invalid dedupe record");
    }
    return record;
  } catch (error) {
    throw new EmailInboundError(
      "EMAIL_DEDUPE_CORRUPT",
      error instanceof Error ? error.message : "Email dedupe record is corrupt.",
      500
    );
  }
}

async function duplicateResult(record: DedupeRecord): Promise<EmailInboundResult> {
  try {
    const page = await readPage(record.pagePath);
    const { absolutePath } = resolveVaultPath(record.pagePath, "page");
    const storedReference = JSON.parse(
      await fs.readFile(absolutePath.replace(/\.html$/i, ".ref.json"), "utf8")
    ) as EmailReferenceSidecar;
    if (JSON.stringify(storedReference) !== JSON.stringify(record.reference)) {
      throw new Error("Reference metadata does not match dedupe state");
    }
    return {
      created: false,
      id: page.path,
      page: toApiPageDocument(page),
      reference: record.reference,
    };
  } catch {
    throw new EmailInboundError(
      "EMAIL_DEDUPE_ORPHANED",
      "Email dedupe state points to a missing page; refusing to create a duplicate.",
      500
    );
  }
}

async function commitEmailTransaction(input: {
  title: string;
  html: string;
  sectionPath: string;
  keyHash: string;
  reference: EmailReferenceSidecar;
}): Promise<EmailInboundResult> {
  const target = await nextPageTarget(input.sectionPath, input.title);
  const referenceTarget = target.absolutePath.replace(/\.html$/i, ".ref.json");
  const dedupeTarget = dedupePath(input.keyHash);
  const now = new Date().toISOString();
  const pageContent = serializeFrontmatterDocument({ title: input.title, created: now, updated: now }, input.html);
  const referenceContent = `${JSON.stringify(input.reference, null, 2)}\n`;
  const dedupe: DedupeRecord = {
    version: 1,
    keyHash: input.keyHash,
    pagePath: target.relativePath,
    reference: input.reference,
    createdAt: now,
  };
  const dedupeContent = `${JSON.stringify(dedupe, null, 2)}\n`;
  const transactionId = crypto.randomUUID();
  const tempName = (kind: string) => `${TEMP_FILE_PREFIX}${transactionId}-${kind}.tmp`;
  const files: TransactionFile[] = [
    {
      kind: "page",
      temporaryPath: path.join(path.dirname(target.absolutePath), tempName("page")),
      targetPath: target.absolutePath,
      sha256: sha256(pageContent),
    },
    {
      kind: "reference",
      temporaryPath: path.join(path.dirname(referenceTarget), tempName("reference")),
      targetPath: referenceTarget,
      sha256: sha256(referenceContent),
    },
    {
      kind: "dedupe",
      temporaryPath: path.join(path.dirname(dedupeTarget), tempName("dedupe")),
      targetPath: dedupeTarget,
      sha256: sha256(dedupeContent),
    },
  ];
  const journal: TransactionJournal = { version: 1, id: transactionId, state: "preparing", files };
  const storedJournalPath = journalPath(transactionId);

  await fs.mkdir(path.dirname(dedupeTarget), { recursive: true });
  await writeJsonAtomically(storedJournalPath, journal);
  try {
    const contents = [pageContent, referenceContent, dedupeContent];
    for (let index = 0; index < files.length; index += 1) {
      await fs.writeFile(files[index].temporaryPath, contents[index], { encoding: "utf8", flag: "wx" });
    }
    for (let index = 0; index < files.length; index += 1) {
      await testHooks.beforeCommitFile?.(files[index], index);
      await fs.rename(files[index].temporaryPath, files[index].targetPath);
    }
    // The immutable journal is the recovery marker. Removing its directory is
    // the transaction commit point; any crash before this line is rolled back.
    await fs.rm(path.dirname(storedJournalPath), { recursive: true, force: true });
  } catch (error) {
    await rollBackJournal(journal);
    await fs.rm(path.dirname(storedJournalPath), { recursive: true, force: true });
    throw error;
  }

  invalidateVaultTreeCache();
  const page = await readPage(target.relativePath);
  emitVaultSideEffects({ treeChanged: true });
  return {
    created: true,
    id: page.path,
    page: toApiPageDocument(page),
    reference: input.reference,
  };
}

function withIngestLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = ingestQueue.then(operation, operation);
  ingestQueue = result.then(() => undefined, () => undefined);
  return result;
}

function mailtoSource(sender: string): string {
  return `mailto:${sender}`;
}

export async function processInboundEmail(
  rawMime: Buffer,
  allowedSenders: Set<string>,
  envelopeSender: string
): Promise<EmailInboundResult> {
  return withIngestLock(async () => {
    await recoverInterruptedTransactions();

    let parsed: ParsedMail;
    try {
      parsed = await simpleParser(rawMime, {
        skipHtmlToText: true,
        skipTextToHtml: true,
      });
    } catch (error) {
      throw new EmailInboundError(
        "INVALID_MIME",
        error instanceof Error ? error.message : "Unable to parse raw MIME email.",
        400
      );
    }

    const headerSenders = addressValues(parsed.from);
    if (headerSenders.length !== 1) {
      throw new EmailInboundError("INVALID_MIME", "Email must contain exactly one From mailbox.", 400);
    }
    const sender = headerSenders[0];
    if (!allowedSenders.has(envelopeSender)) {
      throw new EmailInboundError("SENDER_NOT_ALLOWED", "Email sender is not allowed.", 403);
    }
    if (sender !== envelopeSender) {
      throw new EmailInboundError(
        "SENDER_MISMATCH",
        "MIME From must match the authenticated envelope sender.",
        403
      );
    }

    const { html, urlSource } = normalizedBody(parsed);
    const originalSubject = parsed.subject?.trim() || "Untitled email";
    const routing = await resolveEmailRouting(originalSubject);
    const messageId = normalizeMessageId(parsed.messageId);
    const rawMimeHash = sha256(rawMime);
    const dedupeKind = messageId ? "message-id" as const : "raw-mime-sha256" as const;
    const dedupeIdentity = messageId ? `message-id:${messageId.toLowerCase()}` : `raw-mime-sha256:${rawMimeHash}`;
    const keyHash = sha256(dedupeIdentity);
    const existing = await readDedupeRecord(keyHash);
    if (existing) {
      logEmailInbound("info", "duplicate", { keyHash: keyHash.slice(0, 12), pagePath: existing.pagePath });
      return duplicateResult(existing);
    }

    const recipients = Array.from(new Set(addressValues(parsed.to)));
    if (recipients.length === 0) {
      throw new EmailInboundError("INVALID_MIME", "Email recipient is missing.", 400);
    }
    const sourceUrl = firstSafeHttpUrl(urlSource) ?? mailtoSource(sender);
    const reference: EmailReferenceSidecar = {
      version: 1,
      sourceUrl,
      type: "email",
      tags: ["email"],
      email: {
        messageId,
        sender,
        envelopeSender,
        recipients,
        receivedAt: receivedAt(parsed),
        originalSubject,
        routing: routing.metadata,
        ignoredAttachmentCount: parsed.attachments.length,
        dedupeKind,
      },
    };
    const sectionPath = await ensureInboxSection(routing.notebookPath);

    logEmailInbound("info", "routing", {
      requestedPrefix: routing.metadata.requestedPrefix,
      matchedNotebookPath: routing.metadata.matchedNotebookPath,
      fallbackReason: routing.metadata.fallbackReason,
      sectionPath,
      keyHash: keyHash.slice(0, 12),
    });

    try {
      const result = await commitEmailTransaction({
        title: routing.title,
        html,
        sectionPath,
        keyHash,
        reference,
      });
      logEmailInbound("info", "created", { keyHash: keyHash.slice(0, 12), pagePath: result.page.path });
      return result;
    } catch (error) {
      logEmailInbound("error", "transaction-failed", {
        keyHash: keyHash.slice(0, 12),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new EmailInboundError("VAULT_WRITE_FAILED", "Email could not be committed to the vault.", 500);
    }
  });
}
