import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPage, readPage, renamePage, savePage, updatePageMetadata, invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";
import { listRecipes, notebookInstructions, recipeTemplate, runRecipe, setPageRole } from "@/server/vault/recipes";
import { executeVaultTool } from "@/server/vault/agent-tools";
import { buildCompanionPageContext } from "@/server/vault/companion-context";
import { PATCH } from "@/app/api/page/route";

let root: string;
let oldVault: string | undefined;
let oldState: string | undefined;
beforeEach(async () => {
  oldVault = process.env.SMART_NOTES_VAULT;
  oldState = process.env.SMART_NOTES_STATE_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sn305-"));
  process.env.SMART_NOTES_VAULT = root;
  process.env.SMART_NOTES_STATE_DIR = path.join(root, ".state");
  for (const name of ["Career/Jobs", "Other/Notes"]) await fs.mkdir(path.join(root, name), { recursive: true });
  invalidateVaultTreeCacheForTesting();
});
afterEach(async () => {
  if (oldVault === undefined) delete process.env.SMART_NOTES_VAULT; else process.env.SMART_NOTES_VAULT = oldVault;
  if (oldState === undefined) delete process.env.SMART_NOTES_STATE_DIR; else process.env.SMART_NOTES_STATE_DIR = oldState;
  invalidateVaultTreeCacheForTesting();
  await fs.rm(root, { recursive: true, force: true });
});
const make = (title: string, notebookPath = "Career") => createPage({ notebookPath, title });

test("recipe discovery prefers the active notebook, unmarking persists, duplicates require disambiguation", async () => {
  const target = await make("Job");
  const remote = await make("Fit analysis", "Other");
  const local = await make("Fit analysis");
  for (const p of [remote, local]) await setPageRole(p.path, "recipe", true);
  expect((await listRecipes(target.path)).map((p) => p.path)).toEqual([local.path, remote.path]);
  expect((await runRecipe(target.path, "fit analysis")).recipePath).toBe(local.path);
  const duplicate = await make("Fit analysis");
  await setPageRole(duplicate.path, "recipe", true);
  await expect(runRecipe(target.path, "Fit analysis")).rejects.toMatchObject({ code: "AMBIGUOUS_RECIPE" });
  await setPageRole(local.path, "recipe", false);
  await setPageRole(duplicate.path, "recipe", false);
  expect((await runRecipe(target.path, "Fit analysis")).recipePath).toBe(remote.path);
});

test("run copies a design template, its child, and assets into target's section without changing the source", async () => {
  const target = await createPage({ sectionPath: "Career/Jobs", title: "Role" });
  const recipe = await make("Tailored portfolio");
  const template = await createPage({ notebookPath: "Other", title: "Base", noteType: "design" });
  await savePage({ path: template.path, title: template.title, body: '<style>h1{color:red}</style><h1>Base</h1><img src="/vault/Other/base.assets/hero.png">' });
  await fs.mkdir(path.join(root, "Other/base.assets"));
  await fs.writeFile(path.join(root, "Other/base.assets/hero.png"), "image");
  const child = await createPage({ notebookPath: "Other", parentId: template.path, title: "Details" });
  await savePage({ path: child.path, title: child.title, body: "<p>Child content</p>" });
  await savePage({ path: recipe.path, title: recipe.title, body: `<p>Use verified facts.</p><a href="/vault/${template.path}">Template</a>` });
  await setPageRole(recipe.path, "recipe", true);
  const result = await runRecipe(target.path, recipe.title);
  expect(result.page.path).toMatch(/^Career\/Jobs\//);
  expect(result.page.metadata).toMatchObject({ parent_id: target.path, note_type: "design" });
  expect(result.page.body).toContain("<style>");
  expect(result.page.body).toContain("/vault/Career/Jobs/tailored-portfolio.assets/hero.png");
  expect(await fs.readFile(path.join(root, "Career/Jobs/tailored-portfolio.assets/hero.png"), "utf8")).toBe("image");
  expect(result.children).toHaveLength(1);
  expect((await readPage(result.children[0])).metadata.parent_id).toBe(result.page.path);
  expect((await readPage(result.children[0])).body).toContain("Child content");
  expect((await readPage(template.path)).body).toContain("/vault/Other/base.assets/hero.png");
  expect(result.instructions).toContain("Use verified facts");
});

test("missing template and excessive nesting fail before allocating a child", async () => {
  const target = await make("Target");
  const recipe = await make("Recipe");
  await setPageRole(recipe.path, "recipe", true);
  await updatePageMetadata(recipe.path, { recipe_template: "Career/missing.html" });
  await expect(runRecipe(target.path, recipe.title)).rejects.toBeDefined();
  const template = await make("Template");
  await createPage({ notebookPath: "Career", parentId: template.path, title: "Child" });
  const nested = await createPage({ notebookPath: "Career", parentId: target.path, title: "Nested" });
  await updatePageMetadata(recipe.path, { recipe_template: template.path });
  await expect(runRecipe(nested.path, recipe.title)).rejects.toMatchObject({ code: "DEPTH_CAP" });
  expect((await fs.readdir(path.join(root, "Career"))).filter((n) => n.startsWith("recipe-"))).toEqual([]);
});

test("instructions are singular, notebook-scoped, fresh on each turn, and survive rename", async () => {
  const policy = await make("Policy");
  const next = await make("New policy");
  const target = await createPage({ sectionPath: "Career/Jobs", title: "Job" });
  const other = await make("Other target", "Other");
  await savePage({ path: policy.path, title: policy.title, body: "<p>Never fabricate. Max 2 pages.</p>" });
  await setPageRole(policy.path, "notebook_instructions", true);
  expect(await notebookInstructions(target.path)).toContain("Never fabricate");
  expect(await notebookInstructions(other.path)).toBe("");
  const renamed = await renamePage(policy.path, "Renamed policy");
  expect(await notebookInstructions(target.path)).toContain(renamed.path);
  const enriched = await buildCompanionPageContext({ path: target.path, basePageContext: "target" });
  expect(enriched.notebookInstructions).toContain("Max 2 pages");
  expect((await buildCompanionPageContext({ path: other.path, basePageContext: "other" })).notebookInstructions).toBe("");
  await setPageRole(next.path, "notebook_instructions", true);
  expect((await readPage(renamed.path)).metadata.notebook_instructions).toBeUndefined();
  // A hand-edited duplicate degrades to a warning instead of breaking companion context.
  await updatePageMetadata(renamed.path, { notebook_instructions: true });
  const ambiguous = await buildCompanionPageContext({ path: target.path, basePageContext: "target" });
  expect(ambiguous.notebookInstructions).toContain("none were applied");
  expect(ambiguous.notebookInstructions).not.toContain("Never fabricate");
  await updatePageMetadata(renamed.path, { notebook_instructions: undefined });
  await setPageRole(next.path, "notebook_instructions", false);
  expect(await notebookInstructions(target.path)).toBe("");
});

test("page role API validates type and companion tools dispatch recipe requests", async () => {
  const page = await make("Fit");
  const patch = (enabled: unknown) => PATCH(new Request("http://localhost/api/page", { method: "PATCH", body: JSON.stringify({ path: page.path, action: "recipe", enabled }) }));
  expect((await patch("yes")).status).toBe(400);
  expect((await patch(true)).status).toBe(200);
  const target = await make("Target");
  const result = await executeVaultTool("recipe_run", { path: target.path, name: "Fit" });
  expect(result).toMatchObject({ ok: true, result: { treeChanged: true } });
  const design = await createPage({ notebookPath: "Career", title: "Design", noteType: "design" });
  await expect(setPageRole(design.path, "recipe", true)).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

test("template links accept normal vault/query/relative links and reject external links", () => {
  expect(recipeTemplate("Career/recipe.html", '<a href="base.html">Template</a>', null)).toBe("Career/base.html");
  expect(recipeTemplate("Career/recipe.html", '<a href="/?page=Other%2Fbase.html">Template</a>', null)).toBe("Other/base.html");
  expect(() => recipeTemplate("Career/recipe.html", '<a href="https://example.org/base.html">Template</a>', null)).toThrow();
});
