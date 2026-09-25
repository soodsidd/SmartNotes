/**
 * SN-5 / SN-9 WYSIWYG Rich Text Editor — E2E evidence spec
 *
 * Covers: Clarity toolbar, formatting, HTML vault persistence, reopen.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createVaultNotebook, submitCreatePageDialog, submitTextDialog } from "./helpers";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "evidence", "SN-9");

function slugifyTitle(title: string) {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .toLowerCase() || "untitled-page"
  );
}

async function waitForSaved(page: Page) {
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 12000 });
}

async function createNotebookSectionPage(page: Page, notebookName: string, sectionName: string, pageTitle: string) {
  await createVaultNotebook(page, notebookName);

  const nbMenu = page.locator(`[data-testid="notebook-menu-${notebookName}"]`);
  await nbMenu.click();
  await page.getByRole("menuitem", { name: "New section" }).click();
  await submitTextDialog(page, sectionName, "Create");

  const secMenu = page.locator(`[data-testid="section-menu-${notebookName}/${sectionName}"]`);
  await secMenu.click();
  await page.getByRole("menuitem", { name: "New page" }).click();
  await submitCreatePageDialog(page, pageTitle);
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 20000 });
}

async function removeSn9Artifacts() {
  const entries = await fs.readdir(VAULT, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && (e.name.startsWith("SN9 ") || e.name.startsWith("SN9")))
      .map((e) => fs.rm(path.join(VAULT, e.name), { recursive: true, force: true }))
  );
}

test.describe.configure({ mode: "serial" });

test("SN-9: toolbar renders with expected buttons", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await removeSn9Artifacts();

  const stamp = Date.now();
  const notebookName = `SN9 Notebook ${stamp}`;
  const sectionName = `SN9 Section ${stamp}`;
  const pageTitle = `SN9 Toolbar Page ${stamp}`;

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await createNotebookSectionPage(page, notebookName, sectionName, pageTitle);

  const formatBar = page.getByTestId("format-bar");
  await expect(formatBar).toBeVisible();
  await expect(formatBar.getByTestId("toolbar-aa")).toBeVisible();
  await expect(formatBar.getByTestId("toolbar-bold")).toBeVisible();
  await expect(formatBar.getByTestId("toolbar-italic")).toBeVisible();
  await expect(formatBar.getByTestId("toolbar-strike")).toBeVisible();
  await expect(formatBar.getByTestId("toolbar-code")).toBeVisible();
  await expect(formatBar.getByTestId("toolbar-list-menu")).toBeVisible();
  await expect(formatBar.getByTestId("toolbar-link")).toBeVisible();
  await expect(formatBar.getByTestId("toolbar-insert-menu")).toBeVisible();

  await formatBar.getByTestId("toolbar-aa").click();
  await expect(page.getByTestId("toolbar-h1")).toBeVisible();
  await expect(page.getByTestId("toolbar-h2")).toBeVisible();
  await expect(page.getByTestId("toolbar-h3")).toBeVisible();
  await page.keyboard.press("Escape");

  await formatBar.getByTestId("toolbar-list-menu").click();
  await expect(page.getByTestId("toolbar-bullet-list")).toBeVisible();
  await expect(page.getByTestId("toolbar-ordered-list")).toBeVisible();
  await expect(page.getByTestId("toolbar-task-list")).toBeVisible();
  await page.keyboard.press("Escape");

  await formatBar.getByTestId("toolbar-insert-menu").click();
  await expect(page.getByTestId("toolbar-table")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-toolbar-desktop.png"), fullPage: false });
});

test("SN-9: bold formatting applies and persists to vault as HTML", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const stamp = Date.now();
  const notebookName = `SN9 Notebook ${stamp}`;
  const sectionName = `SN9 Section ${stamp}`;
  const pageTitle = `SN9 Bold Page ${stamp}`;
  const pageSlug = `${slugifyTitle(pageTitle)}.html`;

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await createNotebookSectionPage(page, notebookName, sectionName, pageTitle);

  const editor = page.getByTestId("rich-text-editor");
  await editor.click();
  await page.keyboard.type("Hello world");
  await page.keyboard.press("Control+A");
  await page.getByTestId("toolbar-bold").click();
  await waitForSaved(page);

  const filePath = path.join(VAULT, notebookName, sectionName, pageSlug);
  const raw = await fs.readFile(filePath, "utf-8");
  expect(raw).toMatch(/<strong>Hello world<\/strong>/i);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-bold-applied.png"), fullPage: false });
});

test("SN-9: H1 formatting applies and vault file has HTML heading", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const stamp = Date.now();
  const notebookName = `SN9 Notebook ${stamp}`;
  const sectionName = `SN9 Section ${stamp}`;
  const pageTitle = `SN9 Heading Page ${stamp}`;
  const pageSlug = `${slugifyTitle(pageTitle)}.html`;

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await createNotebookSectionPage(page, notebookName, sectionName, pageTitle);

  const editor = page.getByTestId("rich-text-editor");
  await editor.click();
  await page.getByTestId("toolbar-aa").click();
  await page.getByTestId("toolbar-h1").click();
  await page.keyboard.type("Main Heading");
  await waitForSaved(page);

  const filePath = path.join(VAULT, notebookName, sectionName, pageSlug);
  const raw = await fs.readFile(filePath, "utf-8");
  expect(raw).toMatch(/<h1[^>]*>Main Heading<\/h1>/i);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-h1-applied.png"), fullPage: false });
});

test("SN-9: existing note reloads formatted content (no raw markdown shown)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const stamp = Date.now();
  const notebookName = `SN9 Notebook ${stamp}`;
  const sectionName = `SN9 Section ${stamp}`;
  const pageTitle = `SN9 Existing Note ${stamp}`;

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await createNotebookSectionPage(page, notebookName, sectionName, pageTitle);

  const editor = page.getByTestId("rich-text-editor");
  await editor.click();
  await page.getByTestId("toolbar-aa").click();
  await page.getByTestId("toolbar-h1").click();
  await page.keyboard.type("Test Heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Some ");
  await page.getByTestId("toolbar-bold").click();
  await page.keyboard.type("bold");
  await page.getByTestId("toolbar-bold").click();
  await page.keyboard.type(" and normal text");
  await waitForSaved(page);

  const secMenu2 = page.locator(`[data-testid="section-menu-${notebookName}/${sectionName}"]`);
  await secMenu2.click();
  await page.getByRole("menuitem", { name: "New page" }).click();
  await submitTextDialog(page, `SN9 Second Page ${stamp}`, "Create");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 8000 });

  const pageItem = page.locator(
    `[data-testid="page-${notebookName}/${sectionName}/${slugifyTitle(pageTitle)}.html"]`
  );
  await pageItem.locator("button").first().click();
  await expect(page.locator('[data-testid^="page-"][data-selected="true"]')).toContainText(pageTitle);
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 8000 });

  const editorText = await editor.textContent();
  expect(editorText).not.toContain("**bold**");
  expect(editorText).not.toContain("# Test Heading");
  expect(editorText).toContain("bold");
  expect(editorText).toContain("Test Heading");

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-existing-note-loads.png"), fullPage: false });
});

test("SN-9: mobile viewport — BubbleMenu appears on text selection", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile bubble menu only");
  test.skip(true, "Deferred: mobile bubble menu after Clarity shell create-page flow");
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const stamp = Date.now();
  const notebookName = `SN9 Notebook ${stamp}`;
  const sectionName = `SN9 Section ${stamp}`;
  const pageTitle = `SN9 Mobile Page ${stamp}`;

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await createNotebookSectionPage(page, notebookName, sectionName, pageTitle);

  await page.setViewportSize({ width: 390, height: 844 });

  const editor = page.getByTestId("rich-text-editor");
  await editor.click();
  await page.keyboard.type("Select this text to see bubble menu");
  await page.keyboard.press("Control+A");
  await expect(page.getByTestId("bubble-menu")).toBeVisible({ timeout: 5000 });

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-mobile-bubble-menu.png"), fullPage: false });
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("SN-9: task list content saves as HTML to vault", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const stamp = Date.now();
  const notebookName = `SN9 Notebook ${stamp}`;
  const sectionName = `SN9 Section ${stamp}`;
  const pageTitle = `SN9 Tasks Page ${stamp}`;
  const pageSlug = `${slugifyTitle(pageTitle)}.html`;

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await createNotebookSectionPage(page, notebookName, sectionName, pageTitle);

  const editor = page.getByTestId("rich-text-editor");
  await editor.click();
  await page.getByTestId("toolbar-list-menu").click();
  await page.getByTestId("toolbar-task-list").click();
  await page.keyboard.type("Do the thing");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Another task");
  await waitForSaved(page);

  const filePath = path.join(VAULT, notebookName, sectionName, pageSlug);
  const raw = await fs.readFile(filePath, "utf-8");
  expect(raw).toContain("Do the thing");
  expect(raw).toContain("Another task");
  expect(raw).toMatch(/data-type=["']taskList["']/i);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "06-task-list.png"), fullPage: false });
});
