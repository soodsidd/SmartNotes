#!/usr/bin/env node
/**
 * Operator migration: durable Resume Repo assets → Career notebook.
 * Skips stale applications (Tesla demo already present).
 */
import fs from "node:fs/promises";
import path from "node:path";

const ORIGIN = process.env.SMART_NOTES_ORIGIN || "http://localhost:3002";
const RR = process.env.RESUME_REPO || "C:\\Projects\\Resume Repo";
const PORTFOLIO_ASSETS = path.join(RR, "portfolio", "assets");
const APPEARANCE = path.join(RR, "appearances", "midnight-gradient");
const MASTER = path.join(RR, "master");
const RESUMES = path.join(RR, "outputs", "resumes");
const PROMPTS = path.join(RR, "prompts");

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
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
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
    if (!line.trim()) { flushPara(); closeLists(); continue; }
    if (line.startsWith("<!--") && line.endsWith("-->")) {
      flushPara(); closeLists();
      out.push(`<blockquote><p><em>${inline(line.slice(4, -3).trim())}</em></p></blockquote>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara(); closeLists();
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
    const table = /^\|/.test(line);
    if (table) {
      flushPara(); closeLists();
      out.push(`<p>${inline(line)}</p>`);
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
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}\n</head>`);
  return `${style}\n${html}`;
}

async function ensureSection(notebookPath, name) {
  const tree = await api("GET", "/api/vault");
  const nb = (tree.tree || []).find((n) => n.path === notebookPath || n.name === notebookPath);
  const existing = nb?.sections?.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.path;
  const created = await api("POST", "/api/section", { notebookPath, name });
  return created.section.path;
}

async function createPage({ sectionPath, title, noteType, parentId }) {
  return (await api("POST", "/api/page", {
    sectionPath: sectionPath ?? null,
    title,
    noteType: noteType ?? "text",
    parentId: parentId ?? null,
  })).page;
}

async function savePage(pagePath, title, body) {
  return (await api("PUT", "/api/page", { path: pagePath, title, body })).page;
}

async function setRole(pagePath, action, enabled = true) {
  return api("PATCH", "/api/page", { path: pagePath, action, enabled });
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
  return data.asset || data;
}

async function pageExists(pagePath) {
  const res = await fetch(`${ORIGIN}/api/page?path=${encodeURIComponent(pagePath)}`, {
    headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" },
  });
  return res.ok;
}

async function main() {
  console.log(`Career durables migration → ${ORIGIN}`);

  const masterSection = await ensureSection("Career", "Master");
  const templatesSection = await ensureSection("Career", "Templates");
  const recipesSection = await ensureSection("Career", "Recipes");
  console.log({ masterSection, templatesSection, recipesSection });

  // --- Notebook instructions (Career root page or Recipes) ---
  let instructionsPath = "Career/Recipes/career-notebook-instructions.html";
  if (!(await pageExists(instructionsPath))) {
    const page = await createPage({
      sectionPath: recipesSection,
      title: "Career notebook instructions",
    });
    instructionsPath = page.path;
  }
  await savePage(
    instructionsPath,
    "Career notebook instructions",
    [
      `<h1>Career notebook instructions</h1>`,
      `<p>This notebook replaces Resume Repo for job applications. Stale RR application folders were not migrated; keep using Smart Notes from here.</p>`,
      `<h2>Workflow</h2>`,
      `<ol>`,
      `<li><p>New leads land in <strong>Career → Inbox → Job Inbox</strong> (ingest / share / email with a Job subject).</p></li>`,
      `<li><p><strong>Promote</strong> creates an application page under <strong>Career → Applications</strong>.</p></li>`,
      `<li><p>Run recipes from companion by name: <strong>Fit analysis</strong>, <strong>Tailored resume</strong>, <strong>Tailored portfolio</strong>.</p></li>`,
      `<li><p>Edit resume/portfolio as design pages (WYSIWYG Preview, page-break guides, A4 PDF export). Leave companion comments on design pages when reviewing.</p></li>`,
      `</ol>`,
      `<h2>Source of truth</h2>`,
      `<p>Candidate content lives in <strong>Career → Master</strong>. Baseline design templates live in <strong>Career → Templates</strong>.</p>`,
      `<h2>Non-goals</h2>`,
      `<p>Do not recreate Resume Repo's tracker spreadsheet or analysis UI inside Job Inbox. Do not invent company application folders that were stale in RR.</p>`,
    ].join("\n")
  );
  await setRole(instructionsPath, "notebook_instructions", true);
  console.log("Notebook instructions:", instructionsPath);

  // --- Master bank ---
  const masterFiles = [
    "profile.md", "experience.md", "skills.md", "projects.md", "leadership.md",
    "patents.md", "education.md", "training.md", "awards.md", "story_bank.md",
    "hobbies.md", "job_search_active.md", "story.md",
  ];
  const masterPaths = {};
  for (const file of masterFiles) {
    const disk = path.join(MASTER, file);
    try { await fs.access(disk); } catch { console.warn("skip missing", file); continue; }
    const title = file.replace(/\.md$/i, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const slugGuess = `Career/Master/${file.replace(/\.md$/i, "").replace(/_/g, "-")}.html`;
    let pagePath = slugGuess;
    if (!(await pageExists(pagePath))) {
      // title-based slug may differ; create fresh
      const page = await createPage({ sectionPath: masterSection, title });
      pagePath = page.path;
    }
    const md = await fs.readFile(disk, "utf8");
    await savePage(pagePath, title, `<h1>${escapeHtml(title)}</h1>\n${mdToHtml(md)}`);
    masterPaths[file] = pagePath;
    console.log("Master:", pagePath);
  }

  // --- Templates: baseline resume + portfolio ---
  const resumeCss = await fs.readFile(path.join(APPEARANCE, "resume.css"), "utf8");
  const portfolioCss = await fs.readFile(path.join(APPEARANCE, "portfolio.css"), "utf8");

  let resumeTemplatePath = "Career/Templates/resume-baseline.html";
  if (!(await pageExists(resumeTemplatePath))) {
    resumeTemplatePath = (await createPage({
      sectionPath: templatesSection,
      title: "Resume baseline",
      noteType: "design",
    })).path;
  }
  let resumeHtml = inlineStylesheet(
    await fs.readFile(path.join(RESUMES, "resume_baseline_v3.html"), "utf8"),
    resumeCss
  );
  await savePage(resumeTemplatePath, "Resume baseline", resumeHtml);
  try {
    await uploadAsset(resumeTemplatePath, path.join(RESUMES, "resume_baseline_v3.pdf"), "resume_baseline_v3.pdf");
  } catch (err) {
    console.warn("resume pdf:", err.message);
  }
  console.log("Resume template:", resumeTemplatePath);

  let portfolioTemplatePath = "Career/Templates/portfolio-baseline.html";
  if (!(await pageExists(portfolioTemplatePath))) {
    portfolioTemplatePath = (await createPage({
      sectionPath: templatesSection,
      title: "Portfolio baseline",
      noteType: "design",
    })).path;
  }
  let portfolioHtml = inlineStylesheet(
    await fs.readFile(path.join(RESUMES, "portfolio_baseline_v2.html"), "utf8"),
    portfolioCss
  );
  const refs = [...portfolioHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const urlMap = new Map();
  for (const ref of [...new Set(refs)]) {
    const rel = ref.replace(/^\/assets\//, "");
    const disk = path.join(PORTFOLIO_ASSETS, rel.replace(/\//g, path.sep));
    try { await fs.access(disk); } catch { console.warn("missing asset", disk); continue; }
    const fileName = rel.includes("/") ? rel.replace(/\//g, "__") : path.basename(rel);
    const uploaded = await uploadAsset(portfolioTemplatePath, disk, fileName);
    if (uploaded.url) urlMap.set(ref, uploaded.url);
  }
  for (const [from, to] of urlMap) portfolioHtml = portfolioHtml.split(from).join(to);
  await savePage(portfolioTemplatePath, "Portfolio baseline", portfolioHtml);
  try {
    await uploadAsset(portfolioTemplatePath, path.join(RESUMES, "portfolio_baseline_v2.pdf"), "portfolio_baseline_v2.pdf");
  } catch (err) {
    console.warn("portfolio pdf:", err.message);
  }
  console.log("Portfolio template:", portfolioTemplatePath);

  // --- Recipes ---
  const evalPrompt = await fs.readFile(path.join(PROMPTS, "evaluation_prompt.md"), "utf8").catch(() => "");
  const resumePrompt = await fs.readFile(path.join(PROMPTS, "resume_prompt.md"), "utf8").catch(() => "");
  const portfolioPrompt = await fs.readFile(path.join(PROMPTS, "portfolio_prompt.md"), "utf8").catch(() => "");

  async function upsertRecipe(title, bodyHtml) {
    // Find by listing vault for matching title in Recipes section is hard; try common slugs then create.
    const slug = `Career/Recipes/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.html`;
    let pagePath = slug;
    if (!(await pageExists(pagePath))) {
      pagePath = (await createPage({ sectionPath: recipesSection, title })).path;
    }
    await savePage(pagePath, title, bodyHtml);
    await setRole(pagePath, "recipe", true);
    console.log("Recipe:", pagePath);
    return pagePath;
  }

  await upsertRecipe(
    "Fit analysis",
    [
      `<h1>Fit analysis</h1>`,
      `<p>Create a Fit analysis child under the active application. Read Career → Master (profile, experience, skills, projects, leadership, patents, story bank) plus the application's job description. Do not invent facts.</p>`,
      `<h2>Write</h2>`,
      `<ul>`,
      `<li><p>Score and pursue / skip decision</p></li>`,
      `<li><p>Archetype(s) and positioning</p></li>`,
      `<li><p>Strengths, gaps, and proof points to emphasize</p></li>`,
      `<li><p>Next steps for resume/portfolio tailoring</p></li>`,
      `</ul>`,
      evalPrompt ? `<h2>Evaluation prompt (from Resume Repo)</h2>\n${mdToHtml(evalPrompt)}` : "",
    ].join("\n")
  );

  await upsertRecipe(
    "Tailored resume",
    [
      `<h1>Tailored resume</h1>`,
      `<p>Create a resume design-page child from the baseline template, then tailor it for the active application using Fit analysis + Master. Stay within the 2-page A4 guide. Prefer page_write / page_edit on the design page.</p>`,
      `<p><a href="/?page=${encodeURIComponent(resumeTemplatePath)}" rel="template">Template: Resume baseline</a></p>`,
      resumePrompt ? `<h2>Resume prompt (from Resume Repo)</h2>\n${mdToHtml(resumePrompt)}` : "",
    ].join("\n")
  );

  await upsertRecipe(
    "Tailored portfolio",
    [
      `<h1>Tailored portfolio</h1>`,
      `<p>Create a portfolio design-page child from the baseline template, then tailor project emphasis for the active application. Keep images; do not invent project claims.</p>`,
      `<p><a href="/?page=${encodeURIComponent(portfolioTemplatePath)}" rel="template">Template: Portfolio baseline</a></p>`,
      portfolioPrompt ? `<h2>Portfolio prompt (from Resume Repo)</h2>\n${mdToHtml(portfolioPrompt)}` : "",
    ].join("\n")
  );

  console.log("\nDone.");
  console.log(JSON.stringify({
    instructionsPath,
    masterPaths,
    resumeTemplatePath,
    portfolioTemplatePath,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
