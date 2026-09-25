#!/usr/bin/env node
/**
 * Reading App installer.
 *
 * Creates (or updates) the vault App page from the maintained blank-app template,
 * declares its two app-owned tables, and imports the Goodreads spreadsheet into the
 * App source as a static catalog snapshot. Row data for shelf state and companion
 * picks stays in app-owned tables and is never touched by a re-run.
 *
 * Usage:
 *   node packages/books-app/setup/cli.mjs
 *   node packages/books-app/setup/cli.mjs --page "Personal Notebook/Books/reading.html"
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_FILE = path.resolve(HERE, "../app/source.html");

const DEFAULTS = {
  sheet: "Personal Notebook/Books/books.html",
  section: "Personal Notebook/Books",
  title: "Reading",
  port: process.env.SMART_NOTES_PORT || process.env.PORT || "3002",
};

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[index]);
    if (!match) throw new Error(`Unexpected argument: ${argv[index]}`);
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = match[2] ?? (argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true);
  }
  return parsed;
}

const options = { ...DEFAULTS, ...parseArgs(process.argv.slice(2)) };
const BASE = `http://127.0.0.1:${options.port}`;

async function tool(name, args) {
  const response = await fetch(`${BASE}/api/agent/vault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool: name, args }),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${name}: non-JSON response (${response.status}) ${text.slice(0, 300)}`);
  }
  // Unwrap however many {result:{…}} envelopes this transport adds.
  let node = json;
  while (node && typeof node === "object" && node.result && typeof node.result === "object") node = node.result;
  if (json.ok === false || node?.ok === false) {
    throw new Error(`${name}: ${node?.error || json.error || `failed with status ${response.status}`}`);
  }
  return node?.data ?? node;
}

const COLUMN = { A: "id", B: "title", C: "author", H: "myRating", K: "pages", M: "published", N: "dateRead", R: "shelf", S: "review" };

function parseRef(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(String(ref));
  if (!match) return null;
  return { column: match[1], row: Number(match[2]) };
}

/** Goodreads dates arrive as Excel serials once Syncfusion has parsed the sheet. */
function normalizeDate(value) {
  if (value === undefined || value === null || value === "") return "";
  const raw = String(value).trim();
  if (/^\d{4,6}$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) {
      const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(raw.replace(/\//g, "-"));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

const number = (value) => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

async function readBooks() {
  const sheets = await tool("spreadsheet_list_sheets", { path: options.sheet });
  const sheet = (sheets.sheets || [])[0];
  if (!sheet) throw new Error("No worksheet found in the books spreadsheet.");
  const lastRow = Math.max(2, Number(sheet.rowCount) || 2);
  // Bounded rectangular reads, each far below the 2000-cell cap.
  const ranges = [`A2:C${lastRow}`, `H2:H${lastRow}`, `K2:N${lastRow}`, `R2:S${lastRow}`];
  const rows = new Map();
  for (const range of ranges) {
    const result = await tool("spreadsheet_read_range", { path: options.sheet, range });
    for (const cell of result.cells || []) {
      const ref = parseRef(cell.ref);
      const field = ref && COLUMN[ref.column];
      if (!field) continue;
      if (!rows.has(ref.row)) rows.set(ref.row, {});
      rows.get(ref.row)[field] = cell.value;
    }
  }
  const books = [];
  for (const [row, values] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const title = clean(values.title);
    if (!title) continue;
    const id = clean(values.id) || `row${row}`;
    const shelf = clean(values.shelf).toLowerCase() || "read";
    const book = { i: id, t: title, a: clean(values.author), s: shelf };
    const myRating = number(values.myRating);
    const pages = number(values.pages);
    const published = number(values.published);
    const dateRead = normalizeDate(values.dateRead);
    const review = clean(values.review).slice(0, 240);
    if (myRating) book.r = myRating;
    if (pages) book.p = pages;
    if (published) book.y = published;
    if (dateRead) book.d = dateRead;
    if (review) book.v = review;
    books.push(book);
  }
  if (!books.length) throw new Error("No book rows were imported from the spreadsheet.");
  return books;
}

const MANIFEST = {
  version: 1,
  enabled: true,
  template: { id: "blank-app", version: 1 },
  tables: [
    {
      id: "shelf",
      name: "Shelf state",
      kind: "app",
      schema: {
        fields: [
          { id: "key", name: "Book key", type: "text", required: true },
          { id: "title", name: "Title", type: "text", required: true },
          { id: "author", name: "Author", type: "text" },
          { id: "status", name: "Status", type: "select", required: true, options: ["reading", "want", "read", "paused", "dropped"] },
          { id: "rating", name: "My rating", type: "number" },
          { id: "note", name: "Note", type: "text" },
          { id: "changed", name: "Changed", type: "date" },
        ],
      },
    },
    {
      id: "picks",
      name: "Companion picks",
      kind: "app",
      schema: {
        fields: [
          { id: "key", name: "Book key", type: "text", required: true },
          { id: "title", name: "Title", type: "text", required: true },
          { id: "author", name: "Author", type: "text" },
          { id: "published", name: "Year", type: "number" },
          { id: "pages", name: "Pages", type: "number" },
          { id: "rating", name: "Average rating", type: "number" },
          { id: "hook", name: "Hook", type: "text" },
          { id: "data", name: "Card detail JSON", type: "text" },
          { id: "detail", name: "Full description", type: "text" },
          { id: "verdict", name: "Verdict", type: "select", required: true, options: ["new", "want", "dismissed"] },
          { id: "asked", name: "Request id", type: "text" },
          { id: "added", name: "Added", type: "date" },
        ],
      },
    },
  ],
};

async function main() {
  const template = await fs.readFile(SOURCE_FILE, "utf8");
  for (const marker of ["/*__APP_PATH__*/", "/*__BOOKS_CATALOG__*/"]) {
    if (!template.includes(marker)) throw new Error(`App source is missing its ${marker} insertion point.`);
  }

  const books = await readBooks();

  let pagePath = typeof options.page === "string" ? options.page : "";
  let created = false;
  if (!pagePath) {
    const result = await tool("app_create_from_template", {
      sectionPath: options.section,
      templateId: "blank-app",
      title: options.title,
    });
    pagePath = result.path || result.vaultRelativePath || result.page?.path || "";
    if (!pagePath) throw new Error(`App page created but no path was returned: ${JSON.stringify(result).slice(0, 300)}`);
    created = true;
  }

  const source = template
    .replace("/*__APP_PATH__*/", pagePath.replace(/\\/g, "/").replace(/'/g, ""))
    .replace("/*__BOOKS_CATALOG__*/", JSON.stringify(books));

  await tool("app_update", { path: pagePath, source, manifest: MANIFEST, title: options.title });

  const shelved = books.reduce((totals, book) => ({ ...totals, [book.s]: (totals[book.s] || 0) + 1 }), {});
  process.stdout.write(`${JSON.stringify({ ok: true, created, pagePath, imported: books.length, byShelf: shelved, sourceBytes: source.length }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Reading App setup failed: ${error.message}\n`);
  process.exitCode = 1;
});
