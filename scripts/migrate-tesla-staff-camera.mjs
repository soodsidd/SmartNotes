#!/usr/bin/env node
/**
 * One-shot operator migration: Resume Repo Tesla / Staff Camera Development Engineer
 * → Smart Notes Career notebook (Job Inbox + Applications tree).
 *
 * Usage (from career tip worktree, with production on :3002):
 *   node scripts/migrate-tesla-staff-camera.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = process.env.SMART_NOTES_ORIGIN || "http://localhost:3002";
const RESUME_REPO = process.env.RESUME_REPO || "C:\\Projects\\Resume Repo";
const APP_DIR = path.join(RESUME_REPO, "outputs", "Tesla", "Staff Camera Development Engineer");
const APPEARANCE = path.join(RESUME_REPO, "appearances", "midnight-gradient");
const PORTFOLIO_ASSETS = path.join(RESUME_REPO, "portfolio", "assets");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function headers(json = true) {
  const h = { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function api(method, urlPath, body) {
  const res = await fetch(`${ORIGIN}${urlPath}`, {
    method,
    headers: headers(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} → ${res.status}: ${typeof data === "object" ? JSON.stringify(data) : text}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Small deterministic markdown → TipTap-friendly HTML (good enough for outline/JD). */
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inUl = false;
  let inOl = false;
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const text = para.join(" ").trim();
    if (text) out.push(`<p>${inline(text)}</p>`);
    para = [];
  };
  const closeLists = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };
  const inline = (s) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      closeLists();
      continue;
    }
    if (line.startsWith("<!--") && line.endsWith("-->")) {
      flushPara();
      closeLists();
      out.push(`<blockquote><p><em>${inline(line.slice(4, -3).trim())}</em></p></blockquote>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li><p>${inline(ul[1])}</p></li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(`<li><p>${inline(ol[1])}</p></li>`);
      continue;
    }
    closeLists();
    para.push(line.trim());
  }
  flushPara();
  closeLists();
  return out.join("\n");
}

function inlineStylesheet(html, css) {
  const style = `<style>\n${css}\n</style>`;
  if (/<link[^>]+stylesheet[^>]*>/i.test(html)) {
    return html.replace(/<link[^>]+stylesheet[^>]*>\s*/i, `${style}\n`);
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}\n</head>`);
  }
  return `${style}\n${html}`;
}

async function createPage({ sectionPath, notebookPath, title, noteType, parentId }) {
  const page = (await api("POST", "/api/page", {
    sectionPath: sectionPath ?? null,
    notebookPath: notebookPath ?? null,
    title,
    noteType: noteType ?? "text",
    parentId: parentId ?? null,
  })).page;
  return page;
}

async function savePage(pagePath, title, body) {
  return (await api("PUT", "/api/page", { path: pagePath, title, body })).page;
}

async function uploadAsset(pagePath, filePath, fileName = path.basename(filePath)) {
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), fileName);
  const res = await fetch(`${ORIGIN}/api/assets?path=${encodeURIComponent(pagePath)}`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`upload ${fileName} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log(`Migrating Tesla Staff Camera → ${ORIGIN}`);

  const jdMd = await fs.readFile(path.join(APP_DIR, "JD.md"), "utf8");
  const outlineMd = await fs.readFile(path.join(APP_DIR, "outline.md"), "utf8");
  const resumeHtmlRaw = await fs.readFile(path.join(APP_DIR, "resume_v3.html"), "utf8");
  const portfolioHtmlRaw = await fs.readFile(path.join(APP_DIR, "portfolio_v3.html"), "utf8");
  const resumeCss = await fs.readFile(path.join(APPEARANCE, "resume.css"), "utf8");
  const portfolioCss = await fs.readFile(path.join(APPEARANCE, "portfolio.css"), "utf8");

  // 1) Job Inbox record
  const ingest = await api("POST", "/api/ingest", {
    type: "job",
    title: "Tesla – Staff Camera Development Engineer",
    content: jdMd,
    sourceUrl: "https://www.tesla.com/careers",
    destination: { id: "career-jobs" },
  });
  const appPath = ingest.appPath;
  let posting = ingest.posting;
  console.log(`Job Inbox: ${appPath} posting=${posting.id} created=${ingest.created}`);

  // Bootstrap an owner App session, then patch company/role/score/notes.
  const boot = await api("GET", `/api/page/app?path=${encodeURIComponent(appPath)}`);
  const sessionToken = boot.sessionToken;
  if (!sessionToken) throw new Error(`No sessionToken from App bootstrap: ${JSON.stringify(boot).slice(0, 400)}`);

  const patched = await api("POST", "/api/page/app/data", {
    path: appPath,
    sessionToken,
    tableId: "postings",
    operation: "update",
    rowId: posting.id,
    values: {
      ...posting.values,
      company: "Tesla",
      role: "Staff Camera Development Engineer",
      title: "Tesla – Staff Camera Development Engineer",
      score: 78,
      notes: "Migrated demo from Resume Repo outputs/Tesla/Staff Camera Development Engineer (v3 resume + portfolio).",
      enrichmentStatus: "complete",
    },
  });
  posting = patched.data?.row ?? posting;
  console.log("Posting patched with Tesla company/role/score");

  // 2) Promote → Career/Applications page (skip Fit recipe; we author Fit manually)
  const promote = await api("POST", "/api/job-inbox/promote", {
    path: appPath,
    rowId: posting.id,
    runFit: false,
    sessionToken,
  });
  const applicationPath = promote.applicationPath;
  console.log(`Application: ${applicationPath} created=${promote.created}`);

  // 3) Enrich application hub page
  const hubBody = [
    `<h1>Tesla – Staff Camera Development Engineer</h1>`,
    `<p><em>Migrated demo from Resume Repo</em> · referral / open-scope Optimus-adjacent</p>`,
    `<p><a href="/?page=${encodeURIComponent(appPath)}&job=${encodeURIComponent(posting.id)}">Back to Job Inbox posting</a></p>`,
    `<h2>Package</h2>`,
    `<ul>`,
    `<li>Fit analysis (child)</li>`,
    `<li>Resume outline (child)</li>`,
    `<li>Resume — design page + PDF (child)</li>`,
    `<li>Portfolio — design page + PDF (child)</li>`,
    `</ul>`,
    `<h2>Job description</h2>`,
    mdToHtml(jdMd),
  ].join("\n");
  await savePage(applicationPath, "Tesla – Staff Camera Development Engineer", hubBody);

  // 4) Fit analysis (from outline positioning + JD fit themes)
  const fit = await createPage({
    parentId: applicationPath,
    title: "Fit analysis",
  });
  const fitBody = [
    `<h1>Fit analysis</h1>`,
    `<p><strong>Company:</strong> Tesla · <strong>Role:</strong> Staff Camera Development Engineer (open-scope referral via Optimus camera)</p>`,
    `<p><strong>Score (demo):</strong> 78 / 100 · Pursue</p>`,
    `<h2>Positioning</h2>`,
    `<p>Present as a complete product-development engineer with mechatronics and precision-mechanism depth — broad enough for any Tesla hardware hiring manager, specific enough that actuator, flexure, sensor-integration, camera/optics, and production signals are obvious in the bullets.</p>`,
    `<h2>Strengths vs opportunity</h2>`,
    `<ul>`,
    `<li><p>End-to-end product ownership from concept through production (semiconductor metrology, light scattering, TEM, industrial inspection).</p></li>`,
    `<li><p>Mechatronics depth: precision mechanisms, flexures, piezo/MEMS actuators, electronics packaging, LabVIEW/Python, systems integration.</p></li>`,
    `<li><p>Sensor and opto-mechanical work that maps to Optimus camera / sensing roles without over-narrowing the resume.</p></li>`,
    `<li><p>Production ramp, DFM, supplier qualification — relevant to Gen 3 pilot and volume targets.</p></li>`,
    `</ul>`,
    `<h2>Gaps / watch-outs</h2>`,
    `<ul>`,
    `<li><p>No Tesla / automotive OEM badge on the resume — referral narrative must carry culture fit.</p></li>`,
    `<li><p>Camera-module volume manufacturing at robot scale is adjacent, not identical, to prior instrument work.</p></li>`,
    `</ul>`,
    `<h2>Decision</h2>`,
    `<p>Pursue. Send resume_v3 + portfolio_v3 to the Optimus camera contact for routing across actuator / precision / sensing / structural / production teams.</p>`,
    `<h2>Source</h2>`,
    `<p>Derived from Resume Repo <code>outline.md</code> + <code>JD.md</code> during Career workspace migration (demo).</p>`,
  ].join("\n");
  await savePage(fit.path, "Fit analysis", fitBody);
  console.log(`Fit analysis: ${fit.path}`);

  // 5) Outline
  const outline = await createPage({ parentId: applicationPath, title: "Resume outline" });
  await savePage(outline.path, "Resume outline", `<h1>Resume outline</h1>\n${mdToHtml(outlineMd)}`);
  console.log(`Outline: ${outline.path}`);

  // 6) Resume design page
  const resume = await createPage({ parentId: applicationPath, title: "Resume", noteType: "design" });
  let resumeHtml = inlineStylesheet(resumeHtmlRaw, resumeCss);
  await savePage(resume.path, "Resume", resumeHtml);
  const resumePdf = await uploadAsset(resume.path, path.join(APP_DIR, "resume_v3.pdf"), "resume_v3.pdf");
  // Link PDF at top of design for convenience (kept as HTML comment + visible note via sibling text would be better; keep design clean and attach only)
  console.log(`Resume: ${resume.path} pdf=${resumePdf.url || resumePdf.path}`);

  // 7) Portfolio design page + images
  const portfolio = await createPage({ parentId: applicationPath, title: "Portfolio", noteType: "design" });
  let portfolioHtml = inlineStylesheet(portfolioHtmlRaw, portfolioCss);

  // Collect referenced /assets/... files
  const refs = [...portfolioHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const uniqueRefs = [...new Set(refs)];
  const urlMap = new Map();
  for (const ref of uniqueRefs) {
    const rel = ref.replace(/^\/assets\//, "");
    const disk = path.join(PORTFOLIO_ASSETS, rel.replace(/\//g, path.sep));
    try {
      await fs.access(disk);
    } catch {
      console.warn(`Missing portfolio asset: ${disk}`);
      continue;
    }
    // Preserve nested names by flattening with __ for uniqueness
    const fileName = rel.includes("/") ? rel.replace(/\//g, "__") : path.basename(rel);
    const uploaded = await uploadAsset(portfolio.path, disk, fileName);
    const url = uploaded.url || uploaded.asset?.url;
    if (url) urlMap.set(ref, url);
    console.log(`  asset ${ref} → ${url}`);
  }
  for (const [from, to] of urlMap) {
    portfolioHtml = portfolioHtml.split(from).join(to);
  }
  await savePage(portfolio.path, "Portfolio", portfolioHtml);
  const portfolioPdf = await uploadAsset(portfolio.path, path.join(APP_DIR, "portfolio_v3.pdf"), "portfolio_v3.pdf");
  console.log(`Portfolio: ${portfolio.path} pdf=${portfolioPdf.url || portfolioPdf.path}`);

  // 8) Add child links onto the hub for one-click navigation
  const linkedHub = [
    `<h1>Tesla – Staff Camera Development Engineer</h1>`,
    `<p><em>Migrated demo from Resume Repo</em> · referral / open-scope Optimus-adjacent</p>`,
    `<p><a href="/?page=${encodeURIComponent(appPath)}&job=${encodeURIComponent(posting.id)}">Back to Job Inbox posting</a></p>`,
    `<h2>Package</h2>`,
    `<ul>`,
    `<li><p><a href="/?page=${encodeURIComponent(fit.path)}">Fit analysis</a></p></li>`,
    `<li><p><a href="/?page=${encodeURIComponent(outline.path)}">Resume outline</a></p></li>`,
    `<li><p><a href="/?page=${encodeURIComponent(resume.path)}">Resume</a> (design page; PDF attached)</p></li>`,
    `<li><p><a href="/?page=${encodeURIComponent(portfolio.path)}">Portfolio</a> (design page; PDF attached)</p></li>`,
    `</ul>`,
    `<h2>Job description</h2>`,
    mdToHtml(jdMd),
  ].join("\n");
  await savePage(applicationPath, "Tesla – Staff Camera Development Engineer", linkedHub);

  console.log("\nDone.");
  console.log(JSON.stringify({
    jobInbox: appPath,
    postingId: posting.id,
    application: applicationPath,
    children: { fit: fit.path, outline: outline.path, resume: resume.path, portfolio: portfolio.path },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
