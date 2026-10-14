import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { readAppDataSnapshot, readAppManifest, saveAppManifest, executeServiceAppDataMutation } from "./app-runtime";
import { getAppTemplate } from "./app-templates";
import { JOB_INBOX_TEMPLATE_ID, JOB_STATUSES, type JobStatus } from "./job-inbox-template";
import { createNotebook, createPage, createSection, readPage, readVaultTree, savePage, updatePageMetadata } from "./pages";
import { runRecipe } from "./recipes";
import { VaultError } from "./errors";
import { escapeHtml, stripHtml } from "./html-utils";
import type { LogRow } from "@/lib/log-contract";

export interface JobPostingInput {
  title: string;
  sourceUrl?: string;
  content: string;
  source: "email" | "ingest" | "share";
  sourceKey?: string;
  postedAt?: string;
  company?: string;
  role?: string;
}

type JobValues = {
  sourceKey: string; source: JobPostingInput["source"]; sourceUrl: string; title: string;
  company: string; role: string; jd: string; status: JobStatus; score: number | null;
  notes: string; postedAt: string | null; enrichmentStatus: "pending" | "partial" | "complete" | "failed" | "skipped";
  applicationId: string; applicationPath: string; fitPagePath: string;
};

let jobQueue: Promise<void> = Promise.resolve();
async function withJobLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = jobQueue;
  let release!: () => void;
  jobQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await action(); } finally { release(); }
}

function jobPages(tree: Awaited<ReturnType<typeof readVaultTree>>) {
  const career = tree.tree.find((entry) => entry.path.toLowerCase() === "career");
  return career ? [...career.pages, ...career.sections.flatMap((section) => section.pages)].filter((page) => page.noteType === "app") : [];
}

/** The App page is provisioned only for explicit job intake, never ordinary capture. */
export async function ensureJobInboxApp(): Promise<string> {
  const existing = await findJobInboxApp();
  if (existing) return existing;
  const tree = await readVaultTree();
  if (!tree.tree.some((entry) => entry.path.toLowerCase() === "career")) {
    await createNotebook("Career");
  }
  const fresh = await readVaultTree();
  const career = fresh.tree.find((entry) => entry.path.toLowerCase() === "career");
  if (!career) throw new VaultError("CAREER_NOT_FOUND", "Career notebook could not be created.", 500);
  const inbox = career.sections.find((entry) => entry.name.toLowerCase() === "inbox") ?? await createSection(career.path, "Inbox");
  const template = getAppTemplate(JOB_INBOX_TEMPLATE_ID);
  const page = await createPage({ sectionPath: inbox.path, title: template.name, noteType: "app" });
  await savePage({ path: page.path, title: page.title, body: template.source });
  await saveAppManifest(page.path, template.manifest);
  return page.path;
}

export async function findJobInboxApp(): Promise<string | null> {
  const apps = jobPages(await readVaultTree());
  for (const page of apps) {
    const manifest = await readAppManifest(page.path);
    if (manifest.template?.id === JOB_INBOX_TEMPLATE_ID) return page.path;
  }
  return null;
}

export async function assertJobInboxApp(pagePath: string): Promise<string> {
  const page = await readPage(pagePath);
  const manifest = await readAppManifest(page.path);
  if (manifest.template?.id !== JOB_INBOX_TEMPLATE_ID || !manifest.tables.some((table) => table.id === "postings" && table.kind === "app")) {
    throw new VaultError("INVALID_JOB_INBOX", "The target is not a Job Inbox App.", 400);
  }
  return page.path;
}

export function linkedinJobUrls(text: string): string[] {
  const matches = text.matchAll(/https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/gi);
  return [...new Set([...matches].map((match) => `https://www.linkedin.com/jobs/view/${match[1]}`))];
}

export function parseLinkedInJobHtml(html: string) {
  const $ = cheerio.load(html);
  let structured: Record<string, unknown> | null = null;
  $('script[type="application/ld+json"]').each((_, element) => {
    if (structured) return;
    try {
      const parsed = JSON.parse($(element).text());
      const candidates = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed];
      if (Array.isArray(candidates)) structured = candidates.find((entry) => entry?.["@type"] === "JobPosting" || entry?.["@type"]?.includes?.("JobPosting")) ?? null;
    } catch { /* A broken public metadata block is not fatal. */ }
  });
  const job = structured as Record<string, unknown> | null;
  const title = String(job?.title ?? $('meta[property="og:title"]').attr("content") ?? $('title').text() ?? "").replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  const parts = title.split(/\s+at\s+/i);
  const hiring = job?.hiringOrganization;
  const company = String(typeof hiring === "object" && hiring ? (hiring as Record<string, unknown>).name ?? "" : hiring ?? (parts.length > 1 ? parts.pop() : "") ?? "").trim();
  const role = String(job?.title ?? parts[0] ?? "").trim();
  const description = String(job?.description ?? $('[class*="description"]').first().html() ?? $('meta[property="og:description"]').attr("content") ?? "");
  return { company, role, jd: stripHtml(description).replace(/\s+/g, " ").trim() };
}

export async function enrichJobPosting(input: JobPostingInput, fetchPage: typeof fetch = fetch): Promise<Pick<JobValues, "company" | "role" | "jd" | "sourceUrl" | "enrichmentStatus">> {
  const urls = linkedinJobUrls(`${input.sourceUrl ?? ""} ${input.content}`);
  const sourceUrl = urls[0] ?? input.sourceUrl ?? "";
  const fallback = { company: input.company?.trim() ?? "", role: input.role?.trim() || input.title.trim(), jd: stripHtml(input.content).trim().slice(0, 100_000), sourceUrl };
  if (!urls.length) return { ...fallback, enrichmentStatus: "skipped" };
  try {
    const response = await fetchPage(urls[0], { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "SmartNotes-JobInbox/1.0" } });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 2_000_000) throw new Error("LinkedIn page unavailable");
    const html = (await response.text()).slice(0, 2_000_000);
    const parsed = parseLinkedInJobHtml(html);
    return { company: parsed.company || fallback.company, role: parsed.role || fallback.role, jd: parsed.jd || fallback.jd, sourceUrl, enrichmentStatus: parsed.jd ? "complete" : "partial" };
  } catch {
    return { ...fallback, enrichmentStatus: "failed" };
  }
}

async function postingRows(pagePath: string): Promise<LogRow[]> {
  const snapshot = await readAppDataSnapshot(pagePath);
  return snapshot.tables.find((table) => table.id === "postings")?.rows ?? [];
}

export async function queryJobPostings(pagePath: string, ids?: unknown) {
  const path = await assertJobInboxApp(pagePath);
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== "string"))) {
    throw new VaultError("INVALID_JOB_QUERY", "ids must be an array of at most 50 posting IDs.", 400);
  }
  const wanted = ids === undefined ? null : new Set(ids as string[]);
  const rows = (await postingRows(path)).filter((row) => !wanted || wanted.has(row.id));
  return { appPath: path, total: rows.length, postings: rows.slice(0, 200) };
}

export async function appendJobPosting(input: JobPostingInput, fetchPage: typeof fetch = fetch) {
  if (!input.title.trim() || !input.content.trim()) throw new VaultError("INVALID_JOB", "A job title and content are required.", 400);
  return withJobLock(async () => {
    const pagePath = await ensureJobInboxApp();
    const key = input.sourceKey?.trim() || crypto.createHash("sha256").update(`${input.source}\0${input.sourceUrl ?? ""}\0${input.title}`).digest("hex");
    const existing = (await postingRows(pagePath)).find((row) => row.values.sourceKey === key);
    if (existing) return { created: false, pagePath, posting: existing };
    const enriched = await enrichJobPosting(input, fetchPage);
    const values: JobValues = {
      sourceKey: key, source: input.source, sourceUrl: enriched.sourceUrl, title: input.title.trim(),
      company: enriched.company, role: enriched.role, jd: enriched.jd, status: "New", score: null,
      notes: "", postedAt: input.postedAt ?? null, enrichmentStatus: enriched.enrichmentStatus,
      applicationId: "", applicationPath: "", fitPagePath: "",
    };
    const result = await executeServiceAppDataMutation({ path: pagePath, tableId: "postings", operation: "add", values }) as { row: LogRow };
    return { created: true, pagePath, posting: result.row };
  });
}

export async function updateJobPosting(pagePath: string, rowId: string, patch: { status?: unknown; notes?: unknown; score?: unknown }) {
  return withJobLock(async () => {
    const path = await assertJobInboxApp(pagePath);
    const row = (await postingRows(path)).find((candidate) => candidate.id === rowId);
    if (!row) throw new VaultError("JOB_NOT_FOUND", "Posting not found.", 404);
    const status = patch.status === undefined ? row.values.status : patch.status;
    if (!JOB_STATUSES.includes(status as JobStatus)) throw new VaultError("INVALID_JOB_STATUS", "Unknown job status.", 400);
    if (patch.notes !== undefined && (typeof patch.notes !== "string" || patch.notes.length > 100_000)) throw new VaultError("INVALID_JOB_NOTES", "Notes must be text under 100,000 characters.", 400);
    if (patch.score !== undefined && patch.score !== null && (typeof patch.score !== "number" || !Number.isFinite(patch.score) || patch.score < 0 || patch.score > 100)) throw new VaultError("INVALID_JOB_SCORE", "Score must be between 0 and 100.", 400);
    const values = { ...row.values, status, ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.score !== undefined ? { score: patch.score } : {}) };
    const result = await executeServiceAppDataMutation({ path, tableId: "postings", operation: "update", rowId, values }) as { row: LogRow };
    return result.row;
  });
}

async function applicationsSection(notebook: string): Promise<string> {
  const tree = await readVaultTree();
  const entry = tree.tree.find((item) => item.path === notebook);
  if (!entry) throw new VaultError("CAREER_NOT_FOUND", "Career notebook is missing.", 404);
  const existing = entry.sections.find((section) => section.name.toLowerCase() === "applications");
  return existing?.path ?? (await createSection(notebook, "Applications")).path;
}

export async function resolveJobApplication(applicationId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return null;
  const tree = await readVaultTree();
  for (const notebook of tree.tree) {
    for (const page of [...notebook.pages, ...notebook.sections.flatMap((section) => section.pages)]) {
      if (page.metadata?.job_application_id === applicationId) return page.path;
    }
  }
  return null;
}

export async function promoteJobPosting(pagePath: string, rowId: string, runFit = true) {
  return withJobLock(async () => {
    const path = await assertJobInboxApp(pagePath);
    const row = (await postingRows(path)).find((candidate) => candidate.id === rowId);
    if (!row) throw new VaultError("JOB_NOT_FOUND", "Posting not found.", 404);
    const values = row.values as unknown as JobValues;
    if (values.applicationId) {
      return { created: false, applicationPath: await resolveJobApplication(values.applicationId) ?? values.applicationPath, fitPagePath: values.fitPagePath || null };
    }
    const sectionPath = await applicationsSection(path.split("/")[0]);
    const company = values.company || "Unknown company";
    const role = values.role || values.title;
    const page = await createPage({ sectionPath, title: `${company} – ${role}` });
    const applicationId = crypto.randomUUID();
    const source = /^https?:\/\//i.test(values.sourceUrl) ? `<p>Source: <a href="${escapeHtml(values.sourceUrl)}">${escapeHtml(values.sourceUrl)}</a></p>` : "";
    const back = `/?page=${encodeURIComponent(path)}&job=${encodeURIComponent(rowId)}`;
    const body = `<h1>${escapeHtml(company)} – ${escapeHtml(role)}</h1>${source}<p><a href="${escapeHtml(back)}">Back to Job Inbox posting</a></p><h2>Job description</h2><p>${escapeHtml(values.jd).replace(/\n/g, "<br>")}</p>`;
    await savePage({ path: page.path, title: page.title, body });
    await updatePageMetadata(page.path, { job_application_id: applicationId, job_posting_id: rowId });
    let fitPagePath = "";
    let warning: string | undefined;
    if (runFit) {
      try { fitPagePath = (await runRecipe(page.path, "Fit analysis")).page.path; }
      catch (error) { warning = `Application created; Fit analysis could not run: ${error instanceof Error ? error.message : String(error)}`; }
    }
    await executeServiceAppDataMutation({ path, tableId: "postings", operation: "update", rowId, values: { ...values, status: "Promoted", applicationId, applicationPath: page.path, fitPagePath } });
    return { created: true, applicationPath: page.path, applicationId, fitPagePath: fitPagePath || null, warning };
  });
}
