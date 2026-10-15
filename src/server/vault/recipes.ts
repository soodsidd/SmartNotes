import path from "node:path";
import * as cheerio from "cheerio";
import { createPage, readPage, readVaultTree, updatePageMetadata } from "./pages";
import { resolveVaultPath } from "./paths";
import { VaultError } from "./errors";
import { copyPageTree } from "./page-copy";

async function allPages() {
  const { tree } = await readVaultTree();
  return tree.flatMap((n) => [...n.pages, ...n.sections.flatMap((s) => s.pages)]);
}

export async function listRecipes(activePath: string) {
  const active = resolveVaultPath(activePath, "page").relativePath;
  const notebook = active.split("/")[0];
  return (await allPages()).filter((p) => p.noteType === "text" && p.metadata?.recipe === true)
    .map((p) => ({ path: p.path, title: p.title, notebookPath: p.path.split("/")[0], currentNotebook: p.path.split("/")[0] === notebook }))
    .sort((a, b) => Number(b.currentNotebook) - Number(a.currentNotebook) || a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
}

const roleLocks = new Map<string, Promise<void>>();
export async function setPageRole(pagePath: string, role: "recipe" | "notebook_instructions", enabled: boolean) {
  const page = await readPage(pagePath);
  if (page.metadata.note_type && page.metadata.note_type !== "text") {
    throw new VaultError("INVALID_INPUT", "Only text pages can be recipes or notebook instructions.", 400);
  }
  const notebook = page.path.split("/")[0];
  const previous = roleLocks.get(notebook) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => turn);
  roleLocks.set(notebook, tail);
  await previous;
  try {
    if (role === "notebook_instructions" && enabled) {
      for (const other of await allPages()) {
        if (other.path !== page.path && other.path.split("/")[0] === notebook && other.metadata?.notebook_instructions === true) {
          await updatePageMetadata(other.path, { notebook_instructions: undefined });
        }
      }
    }
    return await updatePageMetadata(page.path, { [role]: enabled ? true : undefined });
  } finally {
    release();
    if (roleLocks.get(notebook) === tail) roleLocks.delete(notebook);
  }
}

export async function notebookInstructions(activePath: string) {
  const active = resolveVaultPath(activePath, "page").relativePath;
  const notebook = active.split("/")[0];
  const pages = (await allPages()).filter((p) => p.path.split("/")[0] === notebook && p.noteType === "text" && p.metadata?.notebook_instructions === true);
  // Never fail the whole companion context over a hand-edited duplicate; surface it instead.
  if (pages.length > 1) {
    return `## Notebook instructions (${notebook})\nMultiple pages are marked as notebook instructions (${pages.map((p) => p.path).join(", ")}); none were applied. Ask the owner to designate one page.`;
  }
  if (!pages.length) return "";
  const page = await readPage(pages[0].path);
  return `## Notebook instructions (${notebook})\nApplies only while the active page is in this notebook; supersedes instructions from previous notebooks.\nSource: ${page.path}\n${page.body}`;
}

/** Optional template is a normal link labelled Template (or rel=template). */
export function recipeTemplate(pagePath: string, body: string, metadataPath: unknown) {
  if (typeof metadataPath === "string" && metadataPath.trim()) return resolveVaultPath(metadataPath, "page").relativePath;
  const $ = cheerio.load(body);
  const link = $("a[href]").toArray().find((a) => $(a).attr("rel")?.split(/\s+/).includes("template") || /^template(?:\s*:.*)?$/i.test($(a).text().trim()));
  if (!link) return null;
  const href = $(link).attr("href")!;
  if (/^[a-z]+:/i.test(href)) throw new VaultError("INVALID_INPUT", "Recipe templates must link to a vault page.", 400);
  const url = new URL(href, "http://vault.local");
  const queryPath = url.searchParams.get("page") || url.searchParams.get("path");
  const raw = queryPath || decodeURIComponent(href.split(/[?#]/)[0]);
  const candidate = queryPath ? raw : raw.startsWith("/vault/") ? raw.slice(7) : path.posix.normalize(path.posix.join(path.posix.dirname(pagePath), raw));
  return resolveVaultPath(candidate, "page").relativePath;
}

export async function runRecipe(targetPath: string, name: string, recipePath?: string) {
  const target = await readPage(targetPath);
  let matches = (await listRecipes(target.path)).filter((r) => recipePath ? r.path === resolveVaultPath(recipePath, "page").relativePath : r.title.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  if (!recipePath && matches.some((r) => r.currentNotebook)) matches = matches.filter((r) => r.currentNotebook);
  if (matches.length !== 1) throw new VaultError(matches.length ? "AMBIGUOUS_RECIPE" : "RECIPE_NOT_FOUND", matches.length ? "Multiple recipes match; choose a recipePath from recipe_list." : "Recipe not found.", 400);
  const recipe = await readPage(matches[0].path);
  const template = recipeTemplate(recipe.path, recipe.body, recipe.metadata.recipe_template);
  const result = template ? await copyPageTree(template, target.path, recipe.title) : {
    page: await createPage({ notebookPath: target.path.split("/")[0], parentId: target.path, title: recipe.title }), children: [],
  };
  return { ...result, recipePath: recipe.path, instructions: recipe.body, targetPath: target.path,
    nextStep: "Read the target and required inputs, then fill the created page using the recipe instructions and notebook instructions. Ask for missing inputs; do not fabricate. Creation alone is not completion." };
}
