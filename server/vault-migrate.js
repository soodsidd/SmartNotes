const fs = require("fs/promises");
const path = require("path");
const { marked } = require("marked");
const YAML = require("yaml");

marked.setOptions({ gfm: true, breaks: false });

const LEGACY_EXT = ".md";
const PAGE_EXT = ".html";

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: source };
  }
  return {
    metadata: YAML.parse(match[1]) ?? {},
    body: match[2] ?? "",
  };
}

function serializeFrontmatter(metadata, body) {
  const yamlBlock = YAML.stringify(metadata).trimEnd();
  return `---\n${yamlBlock}\n---\n${body}`;
}

async function listMarkdownPages(vaultRoot) {
  const results = [];

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(LEGACY_EXT)) {
        results.push(path.relative(vaultRoot, absolutePath).replace(/\\/g, "/"));
      }
    }
  }

  await walk(vaultRoot);
  return results;
}

async function migrateVaultToHtml(vaultRoot) {
  const converted = [];
  const markdownPages = await listMarkdownPages(vaultRoot);

  for (const relativeMdPath of markdownPages) {
    const htmlPath = relativeMdPath.replace(/\.md$/i, PAGE_EXT);
    const absoluteMdPath = path.join(vaultRoot, relativeMdPath);
    const absoluteHtmlPath = path.join(vaultRoot, htmlPath);

    const htmlExists = await fs.stat(absoluteHtmlPath).then(() => true).catch(() => false);
    if (htmlExists) {
      await fs.rm(absoluteMdPath, { force: true });
      continue;
    }

    const source = await fs.readFile(absoluteMdPath, "utf8");
    const { metadata, body } = parseFrontmatter(source);
    const htmlBody = body.trim() ? marked.parse(body.trim()) : "";
    await fs.writeFile(absoluteHtmlPath, serializeFrontmatter(metadata, htmlBody), "utf8");
    await fs.rm(absoluteMdPath, { force: true });
    converted.push(htmlPath);
  }

  if (converted.length > 0) {
    console.log(`[smart-notes] migrated ${converted.length} page(s) from .md to .html`);
  }
}

module.exports = { migrateVaultToHtml };
