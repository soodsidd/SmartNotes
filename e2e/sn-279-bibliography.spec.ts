import { expect, test, type Page } from "@playwright/test";
import { dismissBlockingOverlays, ensureNotebookTreeVisible } from "./helpers";
import fs from "node:fs/promises";
import path from "node:path";

// First requests compile routes in the dev E2E harness; allow for that.
const COMPILE_TIMEOUT = { timeout: 30_000 };

async function sidebar(page: Page) {
  return ensureNotebookTreeVisible(page);
}

test("Bibliography creates a standard paper, references it and edits its canonical notes inline", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  const title = `SN-279 Shared paper ${testInfo.project.name}`;
  const parentResponse = await request.post("/api/page", { data: { sectionPath: "Personal Notebook/Quick Notes", title: `SN-279 Article ${testInfo.project.name}` } });
  expect(parentResponse.ok()).toBe(true);
  const parent = (await parentResponse.json()).page;
  await page.goto(`/?page=${encodeURIComponent(parent.path)}`);
  await dismissBlockingOverlays(page);
  let tree = await sidebar(page);
  await tree.getByTestId("bibliography-toggle").click();
  await tree.getByLabel("New paper title").fill(title);
  await tree.getByRole("button", { name: "New paper", exact: true }).click();
  await expect(page.getByTestId("paper-ownership")).toContainText(title, COMPILE_TIMEOUT);
  const papers = (await (await request.get("/api/papers")).json()).papers;
  const paper = papers.find((entry: { page: { title: string } }) => entry.page.title === title);
  expect(paper.id).toBeTruthy();
  const canonical = page.locator('.tiptap[contenteditable="true"]').first();
  await canonical.fill("Initial canonical notes");
  await expect.poll(async () => (await (await request.get(`/api/page?path=${encodeURIComponent(paper.page.path)}`)).json()).page.content, COMPILE_TIMEOUT).toContain("Initial canonical notes");

  await page.goto(`/?page=${encodeURIComponent(parent.path)}`);
  await dismissBlockingOverlays(page);
  await page.getByLabel("Paper reference", { exact: true }).selectOption(paper.id);
  await page.getByRole("button", { name: "Insert reference", exact: true }).click();
  const chip = page.locator(`[data-paper-reference="${paper.id}"]`);
  await expect(chip).toContainText(title, COMPILE_TIMEOUT);
  await expect.poll(async () => (await (await request.get(`/api/page?path=${encodeURIComponent(parent.path)}`)).json()).page.content, COMPILE_TIMEOUT).toContain(paper.id);
  // An untouched page receives the reference after its title, not above it.
  const parentContent: string = (await (await request.get(`/api/page?path=${encodeURIComponent(parent.path)}`)).json()).page.content;
  expect(parentContent.indexOf("<h1")).toBeLessThan(parentContent.indexOf(paper.id));
  tree = await sidebar(page);
  // The child row lives under the parent; expand it if persisted tree state collapsed it.
  const expand = tree.getByRole("button", { name: parent.title, exact: true }).locator("..").getByRole("button", { name: "Expand", exact: true });
  if (await expand.isVisible()) await expand.evaluate((button: HTMLElement) => button.click());
  await expect(tree.getByTestId(`paper-child-${paper.id}`)).toBeVisible(COMPILE_TIMEOUT);
  await tree.getByTestId(`paper-child-${paper.id}`).click();
  await expect(page.getByTestId("paper-ownership")).toContainText(title);
  await page.getByRole("button", { name: "Back to referring page", exact: true }).click();
  await expect(chip).toBeVisible();
  await chip.getByRole("button", { name: new RegExp(title) }).first().click();
  const frame = page.frameLocator(`iframe[data-paper-editor="${paper.id}"]`);
  const inlineEditor = frame.locator('.tiptap[contenteditable="true"]').first();
  await expect(inlineEditor).toContainText("Initial canonical notes", COMPILE_TIMEOUT);
  await inlineEditor.fill(`Live shared edit ${testInfo.project.name}`);
  await chip.getByRole("button", { name: "Back to referring page", exact: true }).click();
  await expect(chip.locator("iframe")).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(`/api/page?path=${encodeURIComponent(paper.page.path)}`)).json()).page.content, COMPILE_TIMEOUT).toContain("Live shared edit");
  await chip.getByRole("button", { name: new RegExp(title) }).first().click();
  await expect(frame.locator('.tiptap[contenteditable="true"]').first()).toContainText("Live shared edit");
  await fs.mkdir(path.resolve("evidence/SN-279"), { recursive: true });
  await page.screenshot({ path: `evidence/SN-279/${testInfo.project.name}-inline.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await chip.getByRole("button", { name: "Back to referring page", exact: true }).click();
  await chip.getByRole("button", { name: `Remove reference to ${title}`, exact: true }).click();
  await expect(chip).toHaveCount(0);
  await expect.poll(async () => (await (await request.get("/api/papers")).json()).papers.find((entry: { id: string }) => entry.id === paper.id).referrers.length, COMPILE_TIMEOUT).toBe(0);
  expect((await request.get(`/api/page?path=${encodeURIComponent(paper.page.path)}`)).ok()).toBe(true);
  tree = await sidebar(page);
  await expect(tree.getByTestId(`paper-child-${paper.id}`)).toHaveCount(0);
  if (await tree.getByTestId("bibliography-toggle").getAttribute("aria-expanded") !== "true") await tree.getByTestId("bibliography-toggle").click();
  await tree.getByLabel("Search papers").fill(title);
  await expect(tree.getByTestId(`bibliography-paper-${paper.id}`)).toBeVisible();
  await page.screenshot({ path: `evidence/SN-279/${testInfo.project.name}-bibliography.png`, fullPage: true });
  await tree.getByLabel("Search papers").fill("no matching paper");
  await expect(tree.getByText("No papers match these filters.")).toBeVisible();
  await page.screenshot({ path: `evidence/SN-279/${testInfo.project.name}-empty-filter.png`, fullPage: true });
  expect(crashes).toEqual([]);
});
