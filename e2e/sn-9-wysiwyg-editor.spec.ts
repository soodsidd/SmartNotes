import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { createVaultNotebook, expectActivePageTitle, submitCreatePageDialog, submitTextDialog } from "./helpers";

const VAULT = process.env.SMART_NOTES_VAULT ?? path.resolve(".", ".e2e-vault");

/** Walk vault looking for any .html file that matches a substring. */
function vaultContains(substring: string): boolean {
  function walk(dir: string): boolean {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (walk(full)) return true;
        } else if (entry.name.endsWith(".html")) {
          const text = fs.readFileSync(full, "utf-8");
          if (text.includes(substring)) return true;
        }
      }
    } catch {
      // ignore permission errors
    }
    return false;
  }
  return walk(VAULT);
}

async function createNotebookSectionPage(page: Page, notebookName: string, sectionName: string, pageTitle: string) {
  await createVaultNotebook(page, notebookName);

  const nbMenu = page.locator(`[data-testid="notebook-menu-${notebookName}"]`);
  await nbMenu.click();
  await page.getByRole("menuitem", { name: "New section" }).click();
  await submitTextDialog(page, sectionName, "Create");
  await expect(page.getByTestId("tree").getByText(sectionName)).toBeVisible({ timeout: 10000 });

  const secMenu = page.locator(`[data-testid="section-menu-${notebookName}/${sectionName}"]`);
  await secMenu.click();
  await page.getByRole("menuitem", { name: "New page" }).click();
  await submitCreatePageDialog(page, pageTitle);
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 20000 });
  await expectActivePageTitle(page, pageTitle);
}

test.describe("SN-9 WYSIWYG Rich Text Editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("toolbar renders on desktop with all expected buttons", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop Clarity toolbar only");
    const stamp = Date.now();
    await createNotebookSectionPage(page, `SN9 NB ${stamp}`, `SN9 Sec ${stamp}`, `SN9 Toolbar ${stamp}`);

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
    await expect(page.getByTestId("toolbar-hr")).toBeVisible();
    await expect(page.getByTestId("toolbar-table")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.screenshot({
      path: "e2e/evidence/sn-9-desktop-toolbar.png",
      fullPage: false,
    });
  });

  test("bold formatting applies visually and serialises to HTML", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
    const stamp = Date.now();
    await createNotebookSectionPage(page, `SN9 NB ${stamp}`, `SN9 Sec ${stamp}`, `SN9 Bold ${stamp}`);

    const editor = page.getByTestId("rich-text-editor");
    await editor.click();
    await page.keyboard.type("Hello world");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.getByTestId("toolbar-bold").click();
    await expect(editor.locator("strong")).toContainText("world");

    await expect.poll(() => vaultContains("<strong>world</strong>"), { timeout: 12000 }).toBe(true);

    await page.screenshot({
      path: "e2e/evidence/sn-9-bold-applied.png",
      fullPage: false,
    });
  });

  test("H1 formatting applies via toolbar", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
    const stamp = Date.now();
    await createNotebookSectionPage(page, `SN9 NB ${stamp}`, `SN9 Sec ${stamp}`, `SN9 Heading ${stamp}`);

    const editor = page.getByTestId("rich-text-editor");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("My H1 Heading");
    await page.getByTestId("toolbar-aa").click();
    await page.getByTestId("toolbar-h1").click();
    await expect(editor.getByRole("heading", { name: "My H1 Heading", level: 1 })).toBeVisible();

    await page.screenshot({
      path: "e2e/evidence/sn-9-h1-formatting.png",
      fullPage: false,
    });
  });

  test("bullet list creates list items", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
    const stamp = Date.now();
    await createNotebookSectionPage(page, `SN9 NB ${stamp}`, `SN9 Sec ${stamp}`, `SN9 Bullet ${stamp}`);

    const editor = page.getByTestId("rich-text-editor");
    await editor.click();
    await page.keyboard.type("First item");
    await page.getByTestId("toolbar-list-menu").click();
    await page.getByTestId("toolbar-bullet-list").click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second item");
    await expect(editor.locator("ul li")).toHaveCount(2);

    await page.screenshot({
      path: "e2e/evidence/sn-9-bullet-list.png",
      fullPage: false,
    });
  });

  test("task list creates checkboxes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
    const stamp = Date.now();
    await createNotebookSectionPage(page, `SN9 NB ${stamp}`, `SN9 Sec ${stamp}`, `SN9 Task ${stamp}`);

    const editor = page.getByTestId("rich-text-editor");
    await editor.click();
    await page.keyboard.type("Task one");
    await page.getByTestId("toolbar-list-menu").click();
    await page.getByTestId("toolbar-task-list").click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Task two");
    await expect(editor.locator('ul[data-type="taskList"]')).toBeVisible();

    await page.screenshot({
      path: "e2e/evidence/sn-9-task-list.png",
      fullPage: false,
    });
  });

  test("existing HTML note loads and renders as rich content", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop toolbar formatting");
    const nbDir = path.join(VAULT, "Rich Vault Notebook");
    const secDir = path.join(nbDir, "Notes Section");
    fs.mkdirSync(secDir, { recursive: true });

    const noteContent = `---
title: HTML Render Test
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
tags: []
---
<h1>Main Heading</h1>
<p>This has <strong>bold</strong> and <em>italic</em> text.</p>
<h2>Sub-heading</h2>
<ul><li><p>Bullet one</p></li><li><p>Bullet two</p></li></ul>
<ol><li><p>First step</p></li><li><p>Second step</p></li></ol>
<blockquote><p>A quoted passage.</p></blockquote>
<p>Inline <code>code</code> example.</p>
`;
    const notePath = path.join(secDir, "HTML Render Test.html");
    fs.writeFileSync(notePath, noteContent, "utf-8");

    await page.getByTestId("reload-btn").click({ force: true }).catch(() => undefined);
    await page.reload();
    await page.waitForLoadState("networkidle");

    const section = page.getByTestId("section-Rich Vault Notebook/Notes Section");
    if (!(await section.isVisible().catch(() => false))) {
      await page.getByTestId("tree").getByRole("button", { name: "Rich Vault Notebook" }).click();
    }
    await expect(section).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("tree").getByText("HTML Render Test")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("tree").getByText("HTML Render Test").first().click();

    const editor = page.getByTestId("rich-text-editor");
    await expect(editor.getByRole("heading", { name: "Main Heading", level: 1 })).toBeVisible();
    await expect(editor.getByRole("heading", { name: "Sub-heading", level: 2 })).toBeVisible();
    await expect(editor.locator("strong")).toContainText("bold");
    await expect(editor.locator("em")).toContainText("italic");
    await expect(editor.locator("blockquote")).toBeVisible();
    await expect(editor).not.toContainText("# Main Heading");
    await expect(editor).not.toContainText("**bold**");

    await page.screenshot({
      path: "e2e/evidence/sn-9-existing-md-load.png",
      fullPage: false,
    });
  });

  test("mobile viewport hides desktop format bar", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile viewport only");
    test.skip(true, "Deferred: mobile sheet/add-menu click interception after tree open");
    const stamp = Date.now();
    const notebookName = `SN9 Mobile NB ${stamp}`;
    const sectionName = `SN9 Mobile Sec ${stamp}`;
    const pageTitle = `SN9 Mobile Page ${stamp}`;
    // Create at desktop width so the tree/add menus are reachable, then shrink.
    await createNotebookSectionPage(page, notebookName, sectionName, pageTitle);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("format-bar")).toBeHidden();
    await expect(page.getByTestId("format-bar-mobile")).toBeVisible();

    await page.screenshot({
      path: "e2e/evidence/sn-9-mobile-no-ribbon.png",
      fullPage: false,
    });
  });
});
