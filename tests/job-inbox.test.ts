import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { POST as postIngest } from "@/app/api/ingest/route";
import { POST as postEmailInbound } from "@/app/api/email/inbound/route";
import { createPage, invalidateVaultTreeCacheForTesting, movePage, readPage, readVaultTree, savePage } from "@/server/vault/pages";
import { setPageRole } from "@/server/vault/recipes";
import { bootstrapAppRuntime, executeAppRpc, readAppManifest, saveAppManifest, executeOwnerAppDataMutation } from "@/server/vault/app-runtime";
import {
  EMAIL_ENVELOPE_FROM_HEADER,
  EMAIL_ENVELOPE_TO_HEADER,
  resetEmailInboundProcessStateForTesting,
} from "@/server/email-inbound";
import {
  appendJobPosting, appendJobPostingsFromContent, deleteJobPosting, enrichJobPosting, findJobInboxApp, linkedinJobUrls,
  parseLinkedInJobHtml, promoteJobPosting, queryJobPostings, resolveJobApplication, updateJobPosting, upgradeJobInboxSource,
} from "@/server/vault/job-inbox";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import { parseAppFrameMessage } from "@/lib/app-frame";
import { getAppTemplate } from "@/server/vault/app-templates";

const LINKEDIN_HTML = `<!doctype html><html><head><title>Staff Engineer at Acme | LinkedIn</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "JobPosting", title: "Staff Engineer",
  hiringOrganization: { "@type": "Organization", name: "Acme Robotics" },
  description: "<p>Build <strong>robots</strong>.</p><ul><li>Rust</li></ul>",
})}</script></head><body></body></html>`;

const noFetch = (async () => { throw new Error("network disabled in tests"); }) as unknown as typeof fetch;
const linkedinFetch = (async () => new Response(LINKEDIN_HTML, { status: 200 })) as unknown as typeof fetch;

let root: string;
const saved: Record<string, string | undefined> = {};
const ENV = ["SMART_NOTES_VAULT", "SMART_NOTES_STATE_DIR", "SMART_NOTES_INGEST_TOKEN", "SMART_NOTES_INGEST_DESTINATIONS",
  "SMART_NOTES_INGEST_DEFAULT_DESTINATION", "SMART_NOTES_EMAIL_INBOUND_TOKEN", "SMART_NOTES_EMAIL_ALLOWED_SENDERS"];

beforeEach(async () => {
  for (const key of ENV) saved[key] = process.env[key];
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sn306-"));
  process.env.SMART_NOTES_VAULT = root;
  process.env.SMART_NOTES_STATE_DIR = path.join(root, ".state");
  process.env.SMART_NOTES_INGEST_TOKEN = "ingest-token";
  process.env.SMART_NOTES_INGEST_DESTINATIONS = JSON.stringify([{ id: "notebook", label: "Notebook", notebookPath: "Notebook" }]);
  process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION = "notebook";
  process.env.SMART_NOTES_EMAIL_INBOUND_TOKEN = "email-token";
  process.env.SMART_NOTES_EMAIL_ALLOWED_SENDERS = "me@example.com";
  await fs.mkdir(path.join(root, "Notebook", "Inbox"), { recursive: true });
  resetEmailInboundProcessStateForTesting();
  invalidateVaultTreeCacheForTesting();
});

afterEach(async () => {
  resetEmailInboundProcessStateForTesting();
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  invalidateVaultTreeCacheForTesting();
  delete (global as Record<string, unknown>)["_smartNotesIo"];
  await fs.rm(root, { recursive: true, force: true });
});

async function pagePaths(): Promise<string[]> {
  invalidateVaultTreeCacheForTesting();
  const tree = await readVaultTree();
  return tree.tree.flatMap((notebook) => [...notebook.pages, ...notebook.sections.flatMap((s) => s.pages)].map((p) => p.path)).sort();
}

describe("LinkedIn enrichment", () => {
  test("canonicalizes LinkedIn job URLs and parses JSON-LD postings", () => {
    expect(linkedinJobUrls("see https://uk.linkedin.com/comm/jobs/view/4242?trk=x and https://www.linkedin.com/jobs/view/4242/"))
      .toEqual(["https://www.linkedin.com/jobs/view/4242"]);
    expect(linkedinJobUrls([
      "https://www.linkedin.com/jobs/view/111",
      "https://linkedin.com/comm/jobs/view/222?trk=x",
      "https://www.linkedin.com/jobs/view/111/",
      "https://www.linkedin.com/jobs/view/333",
    ].join("\n"))).toEqual([
      "https://www.linkedin.com/jobs/view/111",
      "https://www.linkedin.com/jobs/view/222",
      "https://www.linkedin.com/jobs/view/333",
    ]);
    expect(parseLinkedInJobHtml(LINKEDIN_HTML)).toEqual({ company: "Acme Robotics", role: "Staff Engineer", jd: expect.stringContaining("Build robots") });
  });

  test("falls back to og/title metadata and marks fetch failures without throwing", async () => {
    const og = `<html><head><meta property="og:title" content="Data Lead at Beta Co | LinkedIn"><meta property="og:description" content="Own the warehouse."></head></html>`;
    expect(parseLinkedInJobHtml(og)).toEqual({ company: "Beta Co", role: "Data Lead", jd: "Own the warehouse." });
    const failed = await enrichJobPosting({ title: "Lead", content: "https://www.linkedin.com/jobs/view/9", source: "ingest" }, noFetch);
    expect(failed).toMatchObject({ enrichmentStatus: "failed", sourceUrl: "https://www.linkedin.com/jobs/view/9", role: "Lead" });
    const skipped = await enrichJobPosting({ title: "Lead", content: "<p>Plain JD</p>", source: "ingest", sourceUrl: "https://jobs.example/1" }, noFetch);
    expect(skipped).toMatchObject({ enrichmentStatus: "skipped", jd: "Plain JD", sourceUrl: "https://jobs.example/1" });
  });

  test("splits LinkedIn alert digests into one posting per job ID (Resume Repo parity)", async () => {
    const fetched: string[] = [];
    const digestFetch = (async (url: RequestInfo | URL) => {
      fetched.push(String(url));
      return new Response(LINKEDIN_HTML, { status: 200 });
    }) as unknown as typeof fetch;
    const body = [
      "Your job alert",
      "https://www.linkedin.com/comm/jobs/view/101?trk=eml",
      "https://www.linkedin.com/jobs/view/202",
      "https://uk.linkedin.com/jobs/view/101/",
      "https://www.linkedin.com/jobs/view/303?ref=x",
    ].join("\n");
    const first = await appendJobPostingsFromContent({
      title: "3 new jobs for you", content: body, source: "email", sourceKey: "email:<digest@example.com>",
    }, digestFetch);
    expect(first.created).toBe(true);
    expect(first.postings).toHaveLength(3);
    expect(first.postings.map((p) => p.values.sourceUrl)).toEqual([
      "https://www.linkedin.com/jobs/view/101",
      "https://www.linkedin.com/jobs/view/202",
      "https://www.linkedin.com/jobs/view/303",
    ]);
    expect(first.postings.map((p) => p.values.sourceKey)).toEqual([
      "email:<digest@example.com>:101",
      "email:<digest@example.com>:202",
      "email:<digest@example.com>:303",
    ]);
    expect(fetched).toEqual([
      "https://www.linkedin.com/jobs/view/101",
      "https://www.linkedin.com/jobs/view/202",
      "https://www.linkedin.com/jobs/view/303",
    ]);
    const replay = await appendJobPostingsFromContent({
      title: "3 new jobs for you", content: body, source: "email", sourceKey: "email:<digest@example.com>",
    }, noFetch);
    expect(replay.created).toBe(false);
    expect(replay.postings).toHaveLength(3);
    expect((await queryJobPostings(first.pagePath)).total).toBe(3);
  });
});

describe("record store", () => {
  test("appends enriched records into a provisioned Career Job Inbox App, deduped by source key, without pages", async () => {
    const before = await pagePaths();
    const first = await appendJobPosting({ title: "Staff Engineer", content: "https://www.linkedin.com/jobs/view/77", source: "ingest", sourceUrl: "https://www.linkedin.com/jobs/view/77" }, linkedinFetch);
    expect(first.created).toBe(true);
    expect(first.posting.values).toMatchObject({ company: "Acme Robotics", role: "Staff Engineer", status: "New", enrichmentStatus: "complete" });
    const again = await appendJobPosting({ title: "Staff Engineer", content: "https://www.linkedin.com/jobs/view/77", source: "ingest", sourceUrl: "https://www.linkedin.com/jobs/view/77" }, linkedinFetch);
    expect(again).toMatchObject({ created: false, posting: { id: first.posting.id } });
    // Only the Job Inbox App page itself is added; postings never become pages.
    expect(await pagePaths()).toEqual([...before, first.pagePath].sort());
    expect(await findJobInboxApp()).toBe(first.pagePath);
    expect(first.pagePath.startsWith("Career/Inbox/")).toBe(true);
    await appendJobPosting({ title: "Other role", content: "jd", source: "ingest", sourceUrl: "https://jobs.example/2" }, noFetch);
    expect((await queryJobPostings(first.pagePath)).total).toBe(2);
    expect(await pagePaths()).toEqual([...before, first.pagePath].sort());
  });

  test("updates status, notes, and score with validation; generic delete stays blocked; deleteJobPosting works", async () => {
    const { pagePath, posting } = await appendJobPosting({ title: "Role", content: "jd", source: "ingest" }, noFetch);
    const updated = await updateJobPosting(pagePath, posting.id, { status: "Applied", notes: "Sent", score: 80 });
    expect(updated.values).toMatchObject({ status: "Applied", notes: "Sent", score: 80, jd: "jd" });
    await expect(updateJobPosting(pagePath, posting.id, { status: "Deleted" })).rejects.toMatchObject({ code: "INVALID_JOB_STATUS" });
    await expect(updateJobPosting(pagePath, posting.id, { score: 101 })).rejects.toMatchObject({ code: "INVALID_JOB_SCORE" });
    const { sessionToken } = await bootstrapAppRuntime(pagePath);
    for (const run of [executeAppRpc, executeOwnerAppDataMutation]) {
      await expect(run({ path: pagePath, sessionToken, tableId: "postings", operation: "delete", rowId: posting.id }))
        .rejects.toMatchObject({ code: "JOB_RECORD_IMMUTABLE" });
    }
    // Saved views remain ordinary deletable App rows.
    const view = await executeAppRpc({ path: pagePath, sessionToken, tableId: "views", operation: "add", values: { name: "Mine", state: "{}" } }) as { row: { id: string } };
    await expect(executeAppRpc({ path: pagePath, sessionToken, tableId: "views", operation: "delete", rowId: view.row.id })).resolves.toBeTruthy();
    expect((await queryJobPostings(pagePath, [posting.id])).postings).toHaveLength(1);
    const deleted = await deleteJobPosting(pagePath, posting.id);
    expect(deleted).toMatchObject({ deleted: true, rowId: posting.id, applicationId: null });
    expect((await queryJobPostings(pagePath, [posting.id])).postings).toHaveLength(0);
    await expect(deleteJobPosting(pagePath, posting.id)).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });

  test("companion job_inbox commands query selected IDs and update records", async () => {
    const a = await appendJobPosting({ title: "A", content: "jd", source: "ingest", sourceKey: "a" }, noFetch);
    await appendJobPosting({ title: "B", content: "jd", source: "ingest", sourceKey: "b" }, noFetch);
    const query = await executeVaultCommand({ group: "job_inbox", action: "query", args: { path: a.pagePath, ids: [a.posting.id] } });
    expect(query.data).toMatchObject({ total: 1, postings: [{ id: a.posting.id }] });
    const update = await executeVaultCommand({ group: "job_inbox", action: "update", args: { path: a.pagePath, rowId: a.posting.id, status: "Skipped" } });
    expect(update.data).toMatchObject({ posting: { values: { status: "Skipped" } } });
    const removed = await executeVaultCommand({ group: "job_inbox", action: "delete", args: { path: a.pagePath, rowId: a.posting.id } });
    expect(removed.data).toMatchObject({ deleted: true, rowId: a.posting.id });
    expect((await queryJobPostings(a.pagePath, [a.posting.id])).postings).toHaveLength(0);
    await expect(executeVaultCommand({ group: "job_inbox", action: "query", args: { path: a.pagePath, ids: "nope" } })).rejects.toMatchObject({ code: "INVALID_JOB_QUERY" });
  });
});

describe("intake routing", () => {
  const ingest = (body: Record<string, unknown>, headers: Record<string, string>) => postIngest(new Request("http://localhost/api/ingest", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  }));

  test("ingest type=job and share destination career-jobs append records; ordinary ingest still creates pages", async () => {
    const job = await ingest({ title: "Role", sourceUrl: "https://jobs.example/1", content: "<p>JD</p>", type: "job" }, { Authorization: "Bearer ingest-token" });
    expect(job.status).toBe(201);
    const jobBody = await job.json();
    expect(jobBody.posting.values).toMatchObject({ source: "ingest", status: "New" });
    const dup = await ingest({ title: "Role", sourceUrl: "https://jobs.example/1", content: "<p>JD</p>", type: "job" }, { Authorization: "Bearer ingest-token" });
    expect(dup.status).toBe(200);

    const share = await ingest({ title: "Shared", sourceUrl: "https://jobs.example/2", content: "<p>JD</p>", type: "web", destination: { id: "career-jobs" } }, { Origin: "http://localhost" });
    expect(share.status).toBe(201);
    expect((await share.json()).posting.values.source).toBe("share");
    const pagesAfterJobs = await pagePaths();
    expect(pagesAfterJobs).toEqual([jobBody.appPath]);

    const article = await ingest({ title: "Article", sourceUrl: "https://example.test/a", content: "<p>x</p>", type: "article" }, { Authorization: "Bearer ingest-token" });
    expect(article.status).toBe(201);
    expect((await pagePaths()).length).toBe(2);
    expect((await queryJobPostings(jobBody.appPath)).total).toBe(2);
  });

  test("email with a Job subject appends one record per Message-ID; other email still captures a page", async () => {
    const mail = (subject: string, id: string) => Buffer.from([
      "From: Me <me@example.com>", "To: notes@example.com", `Subject: ${subject}`, "Date: Mon, 10 Aug 2026 12:34:56 -0700",
      "Content-Type: text/plain; charset=utf-8", `Message-ID: <${id}@example.com>`, "", "Apply at https://jobs.example/9",
    ].join("\r\n"), "utf8");
    const send = (raw: Buffer, extra: Record<string, string> = {}) => postEmailInbound(new Request("http://localhost/api/email/inbound", {
      method: "POST", body: new Uint8Array(raw),
      headers: {
        Authorization: "Bearer email-token",
        "Content-Type": "message/rfc822",
        [EMAIL_ENVELOPE_FROM_HEADER]: "me@example.com",
        ...extra,
      },
    }));
    expect((await send(mail("[Job] Platform Engineer", "job1"))).status).toBeLessThan(300);
    expect((await send(mail("[Job] Platform Engineer", "job1"))).status).toBeLessThan(300);
    const app = await findJobInboxApp();
    expect(app).not.toBeNull();
    const { postings } = await queryJobPostings(app!);
    expect(postings).toHaveLength(1);
    expect(postings[0].values).toMatchObject({ source: "email", title: "Platform Engineer", sourceUrl: "https://jobs.example/9" });
    expect(await pagePaths()).toEqual([app]);

    expect((await send(mail("Weekly notes", "other1"))).status).toBeLessThan(300);
    expect((await pagePaths()).length).toBe(2);
    expect((await queryJobPostings(app!)).total).toBe(1);

    // jobs@ envelope recipient routes to Job Inbox even without a Job: subject
    // (MIME To may still show the original mailbox when mail is forwarded).
    const jobsAt = await send(mail("Staff Camera Engineer — Tesla", "jobs-at-1"), {
      [EMAIL_ENVELOPE_TO_HEADER]: "jobs@lucidrss.com",
    });
    expect(jobsAt.status).toBeLessThan(300);
    expect((await queryJobPostings(app!)).total).toBe(2);
    expect((await queryJobPostings(app!)).postings.map((p) => p.values.title)).toEqual(
      expect.arrayContaining(["Platform Engineer", "Staff Camera Engineer — Tesla"]),
    );

    // Auto-forward / job-board mail keeps the original From — allowlist must not block jobs@.
    const boardMail = Buffer.from([
      "From: Careers <noreply@boards.example>", "To: jobs@lucidrss.com",
      "Subject: Senior Optics Engineer", "Date: Mon, 10 Aug 2026 12:34:56 -0700",
      "Content-Type: text/plain; charset=utf-8", "Message-ID: <board-1@boards.example>", "",
      "Apply https://boards.example/jobs/42",
    ].join("\r\n"), "utf8");
    const boardResp = await postEmailInbound(new Request("http://localhost/api/email/inbound", {
      method: "POST", body: new Uint8Array(boardMail),
      headers: {
        Authorization: "Bearer email-token",
        "Content-Type": "message/rfc822",
        [EMAIL_ENVELOPE_FROM_HEADER]: "noreply@boards.example",
        [EMAIL_ENVELOPE_TO_HEADER]: "jobs@lucidrss.com",
      },
    }));
    expect(boardResp.status).toBeLessThan(300);
    expect((await queryJobPostings(app!)).total).toBe(3);

    // Gmail CAF auto-forward: envelope is soodsidd+caf_=jobs=…@gmail.com, From stays the board.
    const cafMail = Buffer.from([
      "From: Job Alerts <jobalerts-noreply@linkedin.com>", "To: soodsidd@gmail.com",
      "Subject: Staff Robotics Engineer", "Date: Mon, 10 Aug 2026 12:34:56 -0700",
      "Content-Type: text/plain; charset=utf-8", "Message-ID: <caf-1@linkedin.com>", "",
      "Apply https://www.linkedin.com/jobs/view/99",
    ].join("\r\n"), "utf8");
    const cafResp = await postEmailInbound(new Request("http://localhost/api/email/inbound", {
      method: "POST", body: new Uint8Array(cafMail),
      headers: {
        Authorization: "Bearer email-token",
        "Content-Type": "message/rfc822",
        [EMAIL_ENVELOPE_FROM_HEADER]: "soodsidd+caf_=jobs=lucidrss.com@gmail.com",
        [EMAIL_ENVELOPE_TO_HEADER]: "jobs@lucidrss.com",
      },
    }));
    expect(cafResp.status).toBeLessThan(300);
    expect((await queryJobPostings(app!)).total).toBe(4);

    // Gmail forwards often strip to empty after HTML sanitization — must not bounce.
    const emptyForward = Buffer.from([
      "From: Me <me@example.com>", "To: recruiter@example.com",
      "Subject: Staff Engineer at Acme", "Date: Mon, 10 Aug 2026 12:34:56 -0700",
      "Content-Type: text/html; charset=utf-8", "Message-ID: <empty-forward@example.com>", "",
      "<html><body><img src=\"https://tracker.example/pixel\"></body></html>",
    ].join("\r\n"), "utf8");
    const emptyResp = await send(emptyForward, { [EMAIL_ENVELOPE_TO_HEADER]: "jobs@lucidrss.com" });
    expect(emptyResp.status).toBeLessThan(300);
    expect((await queryJobPostings(app!)).total).toBe(5);
    expect((await queryJobPostings(app!)).postings.map((p) => p.values.title)).toEqual(
      expect.arrayContaining(["Staff Engineer at Acme"]),
    );
  });
});

describe("Promote", () => {
  test("creates the application page with JD, source and back-link; link survives a move; idempotent", async () => {
    const { pagePath, posting } = await appendJobPosting({ title: "Staff Engineer", content: "https://www.linkedin.com/jobs/view/5", source: "ingest", sourceUrl: "https://www.linkedin.com/jobs/view/5" }, linkedinFetch);
    const result = await promoteJobPosting(pagePath, posting.id, false);
    expect(result).toMatchObject({ created: true, fitPagePath: null });
    expect(result.applicationPath.startsWith("Career/Applications/")).toBe(true);
    const page = await readPage(result.applicationPath);
    expect(page.title).toBe("Acme Robotics – Staff Engineer");
    expect(page.body).toContain("Build robots");
    expect(page.body).toContain('href="https://www.linkedin.com/jobs/view/5"');
    expect(page.body).toContain(`job=${encodeURIComponent(posting.id)}`);
    const row = (await queryJobPostings(pagePath, [posting.id])).postings[0];
    expect(row.values).toMatchObject({ status: "Promoted", applicationPath: result.applicationPath, applicationId: result.applicationId });

    await fs.mkdir(path.join(root, "Career", "Archive"), { recursive: true });
    invalidateVaultTreeCacheForTesting();
    const moved = await movePage(result.applicationPath, "Career/Archive");
    invalidateVaultTreeCacheForTesting();
    expect(await resolveJobApplication(result.applicationId!)).toBe(moved.path);
    const again = await promoteJobPosting(pagePath, posting.id, false);
    expect(again).toMatchObject({ created: false, applicationPath: moved.path });
    expect((await pagePaths()).filter((p) => p.startsWith("Career/Applications/") || p.startsWith("Career/Archive/"))).toEqual([moved.path]);
  });

  test("Run Fit analysis creates a child page; a missing recipe keeps the application with a warning", async () => {
    const a = await appendJobPosting({ title: "Role A", company: "Co", content: "jd", source: "ingest", sourceKey: "a" }, noFetch);
    const noRecipe = await promoteJobPosting(a.pagePath, a.posting.id, true);
    expect(noRecipe).toMatchObject({ created: true, fitPagePath: null });
    expect(noRecipe.warning).toMatch(/Fit analysis could not run/);

    const recipe = await createPage({ notebookPath: "Career", title: "Fit analysis" });
    await setPageRole(recipe.path, "recipe", true);
    const b = await appendJobPosting({ title: "Role B", company: "Co", content: "jd", source: "ingest", sourceKey: "b" }, noFetch);
    const withFit = await promoteJobPosting(b.pagePath, b.posting.id, true);
    expect(withFit.fitPagePath).toBeTruthy();
    expect(withFit.warning).toBeUndefined();
    expect((await queryJobPostings(b.pagePath, [b.posting.id])).postings[0].values.fitPagePath).toBe(withFit.fitPagePath);
  });
});

describe("App frame bridge", () => {
  test("accepts only well-formed job-promote, job-delete, and job-open-application requests", () => {
    const base = { source: "smart-notes-app-frame", nonce: "n1", requestId: "q_1" };
    expect(parseAppFrameMessage({ ...base, kind: "job-promote", rowId: "r_abcdef12", runFit: true }, "n1")).toMatchObject({ kind: "job-promote", runFit: true });
    expect(parseAppFrameMessage({ ...base, kind: "job-promote", rowId: "../x", runFit: true }, "n1")).toBeNull();
    expect(parseAppFrameMessage({ ...base, kind: "job-promote", rowId: "r_abcdef12", runFit: "yes" }, "n1")).toBeNull();
    expect(parseAppFrameMessage({ ...base, kind: "job-promote", rowId: "r_abcdef12", runFit: true, extra: 1 }, "n1")).toBeNull();
    expect(parseAppFrameMessage({ ...base, kind: "job-delete", rowId: "r_abcdef12" }, "n1")).toMatchObject({ kind: "job-delete", rowId: "r_abcdef12" });
    expect(parseAppFrameMessage({ ...base, kind: "job-delete", rowId: "../x" }, "n1")).toBeNull();
    expect(parseAppFrameMessage({ ...base, kind: "job-delete", rowId: "r_abcdef12", extra: 1 }, "n1")).toBeNull();
    expect(parseAppFrameMessage({ ...base, kind: "job-open-application", applicationId: "123e4567-e89b-12d3-a456-426614174000" }, "n1")).toMatchObject({ kind: "job-open-application" });
    expect(parseAppFrameMessage({ ...base, kind: "job-open-application", applicationId: "Career/x.html" }, "n1")).toBeNull();
  });

  test("Job Inbox template embeds the table-core grid library and declares postings + views tables", () => {
    const template = getAppTemplate("job-inbox");
    expect(template.source).toContain("function createTable");
    expect(template.source).not.toMatch(/<\/script>[\s\S]*<\/script>/);
    expect(template.manifest?.tables.map((t) => t.id)).toEqual(["postings", "views"]);
  });

  test("SN-309 mobile-first UI keeps every triage control with accessible labels and no prompt()", () => {
    const { source, version } = getAppTemplate("job-inbox");
    expect(version).toBe(3);
    for (const id of ["views", "save-view", "delete-view", "toggle-filters", "sort", "select-all", "bulk-status", "ask-companion",
      "panel-status", "panel-score", "panel-notes", "save-details", "delete-posting", "promote", "run-fit", "application", "close-panel"]) {
      expect(source).toContain(`id="${id}"`);
    }
    expect(source).toContain("smartNotesApp.jobInbox.delete");
    // Icon-only buttons must carry an accessible name.
    for (const button of source.match(/<button[^>]*class="icon"[^>]*>/g) ?? []) expect(button).toMatch(/aria-label="[^"]+"/);
    // The App frame sandbox has no allow-modals, so prompt() would silently fail.
    expect(source).not.toMatch(/\bprompt\(/);
    expect(source).not.toMatch(/\bconfirm\(/);
  });

  test("upgrades unmodified v1/v2 Job Inbox sources and preserves data; leaves custom sources alone", async () => {
    const { pagePath } = await appendJobPosting({ title: "Role", content: "jd", source: "ingest", sourceKey: "keep" }, noFetch);
    const page = await readPage(pagePath);
    const v1Body = '<main><div class="toolbar"><button id="ask-companion">Ask companion about selected</button></div></main>';
    const manifest = await readAppManifest(pagePath);
    await savePage({ path: pagePath, title: page.title, body: v1Body });
    await saveAppManifest(pagePath, { ...manifest, template: { id: "job-inbox", version: 1 } });

    expect(await upgradeJobInboxSource(pagePath)).toBe(true);
    expect((await readPage(pagePath)).body).toContain('id="delete-posting"');
    expect((await readAppManifest(pagePath)).template).toEqual({ id: "job-inbox", version: 3 });
    expect((await queryJobPostings(pagePath)).postings.map((p) => p.values.sourceKey)).toEqual(["keep"]);
    expect(await upgradeJobInboxSource(pagePath)).toBe(false);

    const v2Body = '<main><button id="toggle-filters"></button><button id="promote"></button><script>function createTable(){}</script></main>';
    await savePage({ path: pagePath, title: page.title, body: v2Body });
    await saveAppManifest(pagePath, { ...manifest, template: { id: "job-inbox", version: 2 } });
    expect(await upgradeJobInboxSource(pagePath)).toBe(true);
    expect((await readPage(pagePath)).body).toContain('id="delete-posting"');
    expect((await readAppManifest(pagePath)).template).toEqual({ id: "job-inbox", version: 3 });

    await savePage({ path: pagePath, title: page.title, body: "<main>my custom inbox</main>" });
    await saveAppManifest(pagePath, { ...manifest, template: { id: "job-inbox", version: 1 } });
    expect(await upgradeJobInboxSource(pagePath)).toBe(false);
    expect((await readPage(pagePath)).body).toBe("<main>my custom inbox</main>");
  });
});
