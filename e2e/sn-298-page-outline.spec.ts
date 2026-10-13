import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const vault = path.resolve(__dirname, "..", ".e2e-vault");
const section = path.join(vault, "Personal Notebook", "Quick Notes");
const pagePath = (slug: string) => `Personal Notebook/Quick Notes/${slug}.html`;
const evidence = path.resolve(__dirname, "..", "evidence", "SN-298");

function seed(slug: string, body: string) {
  fs.mkdirSync(section, { recursive: true });
  fs.writeFileSync(path.join(section, `${slug}.html`), [
    "---",
    `title: ${slug}`,
    "created: 2026-10-12T00:00:00.000Z",
    "updated: 2026-10-12T00:00:00.000Z",
    "---",
    body,
  ].join("\n"), "utf8");
}

async function openPage(page: Page, slug: string) {
  await page.addInitScript((activePath) => {
    localStorage.setItem("smart-notes-active-page", activePath);
  }, pagePath(slug));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 60_000 });
}

function outlineToggle(page: Page) {
  return page.locator('[data-testid^="toolbar-page-outline"]').locator("visible=true").first();
}

test("empty outline matches the navigation pane and never inserts a TOC", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const slug = "sn298-empty";
  seed(slug, "<p>Plain page without headings.</p>");
  await openPage(page, slug);
  await expect(page.locator(".editor-content p").first()).toContainText("Plain page");
  await outlineToggle(page).click();
  const pane = page.getByTestId("page-outline-pane");
  await expect(pane).toBeVisible();
  await expect(pane.getByText("Page outline")).toBeVisible();
  await expect(pane.getByText("No headings yet. Use Heading 1, 2, or 3 to build this outline.")).toBeVisible();
  await expect(pane.getByRole("button", { name: "Collapse all" })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Expand all" })).toBeVisible();
  await expect(outlineToggle(page)).toHaveClass(/toolbar-btn--active/);
  await expect(page.locator(".editor-content nav[data-page-toc]")).toHaveCount(0);
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, `outline-empty-${testInfo.project.name}.png`), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(pane).toHaveCount(0);
});

test("outline opens collapsed, expands, and navigates without changing saved TOC", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const slug = "sn298-headings";
  const filler = Array.from({ length: 20 }, (_, i) => `<p>Paragraph ${i}: ${"long page content ".repeat(12)}</p>`).join("\n");
  seed(slug, `<nav data-page-toc="true"><p>Contents</p><ul><li><button data-toc-target="first">First</button></li></ul></nav><h1 id="first">First</h1><h2>Second</h2>${filler}<h3>Third</h3><h1>Last</h1>`);
  await openPage(page, slug);
  await expect(page.locator(".editor-content h3")).toContainText("Third");
  const before = await page.locator(".editor-content nav[data-page-toc]").evaluate((element) => element.innerHTML);
  await outlineToggle(page).click();
  const pane = page.getByTestId("page-outline-pane");
  await expect(pane.getByRole("button", { name: "First", exact: true })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Second", exact: true })).toHaveCount(0);
  await pane.getByRole("button", { name: "Expand First" }).click();
  await expect(pane.getByRole("button", { name: "Second", exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "Collapse all" }).click();
  await expect(pane.getByRole("button", { name: "Second", exact: true })).toHaveCount(0);
  await pane.getByRole("button", { name: "Expand all" }).click();
  await expect(pane.getByRole("button", { name: "Third", exact: true })).toBeVisible();
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, `outline-populated-${testInfo.project.name}.png`), fullPage: true });
  await pane.getByRole("button", { name: "Third", exact: true }).click();
  await expect(pane).toHaveCount(0);
  await expect.poll(async () => page.locator(".editor-scroll-area").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator(".editor-content nav[data-page-toc]").evaluate((element) => element.innerHTML)).toBe(before);
});
