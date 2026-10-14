import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureNotebookTreeVisible, openPageMenu } from "./helpers";

test.use({ serviceWorkers: "block" });
async function choose(page: import("@playwright/test").Page, name: string) {
  const item = page.getByRole("menuitem", { name, exact: true });
  await expect(item).toBeVisible();
  await item.click();
}
test("recipe menu, companion tools, and notebook policy scoping", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const title = `Fit analysis ${testInfo.project.name}`;
  async function create(title: string, notebookPath = "Personal Notebook") {
    const response = await request.post("/api/page", { data: { notebookPath, title } });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).page;
  }
  const recipe = await create(title);
  const target = await create(`Target ${testInfo.project.name}`);
  const other = await create(`Other ${testInfo.project.name}`, "Rich Vault Notebook");
  const policy = "Never fabricate; keep resumes at most two pages.";
  await request.put("/api/page", { data: { path: recipe.path, title, content: `<p>${policy}</p>` } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const tree = await ensureNotebookTreeVisible(page);
  // Wait for the hydrated tree row; clicking the title first races the menu against navigation.
  await expect(tree.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await openPageMenu(page, recipe.path);
  await choose(page, "Mark as recipe");
  await expect.poll(async () => (await (await request.get(`/api/page?path=${encodeURIComponent(recipe.path)}`)).json()).page.metadata.recipe, { timeout: 15_000 }).toBe(true);
  await openPageMenu(page, recipe.path);
  await expect(page.getByRole("menuitem", { name: "Unmark recipe", exact: true })).toBeVisible();
  await choose(page, "Use as notebook instructions");
  await expect.poll(async () => (await (await request.get(`/api/page?path=${encodeURIComponent(recipe.path)}`)).json()).page.metadata.notebook_instructions, { timeout: 15_000 }).toBe(true);
  await openPageMenu(page, recipe.path);
  await expect(page.getByRole("menuitem", { name: "Unset notebook instructions" })).toBeVisible();
  const evidence = path.resolve(__dirname, "../evidence/SN-305");
  await fs.mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, `${testInfo.project.name}-recipe-menu.png`) });
  await page.keyboard.press("Escape");
  const listed = await request.post("/api/agent/vault", { data: { tool: "recipe_list", args: { path: target.path } } });
  expect((await listed.json()).result.data.some((r: { path: string }) => r.path === recipe.path), { timeout: 15_000 }).toBe(true);
  const run = await request.post("/api/agent/vault", { data: { tool: "recipe_run", args: { path: target.path, name: title } } });
  expect(run.ok()).toBeTruthy();
  expect((await run.json()).result.data.page.metadata.parent_id).toBe(target.path);
  const context = await request.post("/api/companion/context", { data: { path: target.path, basePageContext: "" } });
  expect((await context.json()).notebookInstructions).toContain(policy);
  const outside = await request.post("/api/companion/context", { data: { path: other.path, basePageContext: "" } });
  expect((await outside.json()).notebookInstructions).toBe("");
  await page.reload();
  await openPageMenu(page, recipe.path);
  await choose(page, "Unmark recipe");
  await expect.poll(async () => (await (await request.get(`/api/page?path=${encodeURIComponent(recipe.path)}`)).json()).page.metadata.recipe ?? false, { timeout: 15_000 }).toBe(false);
  expect(errors).toEqual([]);
});
