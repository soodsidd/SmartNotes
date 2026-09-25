import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createVaultNotebook,
  deletePageViaMenu,
  expectActivePageTitle,
  movePageViaMenu,
  renamePageViaMenu,
  submitCreatePageDialog,
  submitTextDialog,
} from "./helpers";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "evidence");

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

async function confirmDestructiveDialog(page: Page) {
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole("button", { name: "Delete" }).click();
}

async function fileExists(targetPath: string) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function treeText(page: Page, value: string) {
  return page.getByTestId("tree").getByText(value, { exact: true });
}

function byTestId(page: Page, value: string) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return page.locator(`[data-testid="${escaped}"]`);
}

async function openNotebookMenu(page: Page, notebookPath: string) {
  await byTestId(page, `notebook-menu-${notebookPath}`).click();
}

async function openSectionMenu(page: Page, sectionPath: string) {
  await byTestId(page, `section-menu-${sectionPath}`).click();
}

async function waitForVaultRefresh(page: Page) {
  await page.waitForResponse(
    (response) =>
      response.url().includes("/api/vault") &&
      response.request().method() === "GET" &&
      response.status() === 200
  );
}

async function removeSn4Artifacts() {
  const entries = await fs.readdir(VAULT, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("SN4 "))
      .map((entry) => fs.rm(path.join(VAULT, entry.name), { recursive: true, force: true }))
  );
}

test.describe.configure({ mode: "serial" });

test("SN-4 desktop notebook workflow stays synced through tree mutations", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await removeSn4Artifacts();

  const stamp = Date.now();
  const notebookName = `SN4 Notebook ${stamp}`;
  const renamedNotebookName = `SN4 Archive ${stamp}`;
  const sectionName = `Working Set ${stamp}`;
  const moveTargetSection = `Holding Pen ${stamp}`;
  const renamedSectionName = `Reference Shelf ${stamp}`;
  const pageTitle = `SN4 Draft ${stamp}`;
  const renamedPageTitle = `SN4 Moved Draft ${stamp}`;
  const captureTitle = `SN4 Capture ${stamp}`;

  const pageSlug = `${slugifyTitle(pageTitle)}.html`;
  const renamedPageSlug = `${slugifyTitle(renamedPageTitle)}.html`;
  const captureSlug = `${slugifyTitle(captureTitle)}.html`;

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();

  await test.step("create notebook and sections from the real vault tree", async () => {
    await createVaultNotebook(page, notebookName);
    await expect(treeText(page, notebookName)).toBeVisible();

    await openNotebookMenu(page, notebookName);
    await page.getByRole("menuitem", { name: "New section" }).click();
    await Promise.all([waitForVaultRefresh(page), submitTextDialog(page, sectionName, "Create")]);
    await expect(treeText(page, sectionName)).toBeVisible();

    await openNotebookMenu(page, notebookName);
    await page.getByRole("menuitem", { name: "New section" }).click();
    await Promise.all([waitForVaultRefresh(page), submitTextDialog(page, moveTargetSection, "Create")]);
    await expect(treeText(page, moveTargetSection)).toBeVisible();
    await expect.poll(() => fileExists(path.join(VAULT, notebookName, sectionName))).toBe(true);
    await expect.poll(() => fileExists(path.join(VAULT, notebookName, moveTargetSection))).toBe(true);
  });

  await test.step("create, rename, and move a page without losing the active editor state", async () => {
    await openSectionMenu(page, `${notebookName}/${sectionName}`);
    await page.getByRole("menuitem", { name: "New page" }).click();
    await submitCreatePageDialog(page, pageTitle);

    await expectActivePageTitle(page, pageTitle);
    await renamePageViaMenu(page, `${notebookName}/${sectionName}/${pageSlug}`, renamedPageTitle);
    await expect(page.getByTestId(`page-${notebookName}/${sectionName}/${renamedPageSlug}`)).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => fileExists(path.join(VAULT, notebookName, sectionName, renamedPageSlug))).toBe(true);

    await movePageViaMenu(
      page,
      `${notebookName}/${sectionName}/${renamedPageSlug}`,
      `${notebookName}/${moveTargetSection}`
    );

    await expect(
      page.getByTestId(`page-${notebookName}/${moveTargetSection}/${renamedPageSlug}`)
    ).toBeVisible({ timeout: 15000 });
    await expect.poll(() => fileExists(path.join(VAULT, notebookName, moveTargetSection, renamedPageSlug))).toBe(true);
    await expect.poll(() => fileExists(path.join(VAULT, notebookName, sectionName, renamedPageSlug))).toBe(false);
  });

  await test.step("rename section and notebook while preserving navigation to the active page", async () => {
    await openSectionMenu(page, `${notebookName}/${moveTargetSection}`);
    await page.getByRole("menuitem", { name: "Rename section" }).click();
    await Promise.all([waitForVaultRefresh(page), submitTextDialog(page, renamedSectionName, "Rename")]);

    // Path slug is authoritative after rename/move; displayed title can lag body H1.
    await expect(
      page.locator(`[data-testid="page-${notebookName}/${renamedSectionName}/${renamedPageSlug}"]`)
    ).toBeVisible({ timeout: 15000 });
    await expect(treeText(page, renamedSectionName)).toBeVisible();
    await expect(treeText(page, moveTargetSection)).toHaveCount(0);
    await expect.poll(() => fileExists(path.join(VAULT, notebookName, renamedSectionName, renamedPageSlug))).toBe(true);

    await openNotebookMenu(page, notebookName);
    await page.getByRole("menuitem", { name: "Rename notebook" }).click();
    await Promise.all([waitForVaultRefresh(page), submitTextDialog(page, renamedNotebookName, "Rename")]);

    await expect(
      page.locator(`[data-testid="page-${renamedNotebookName}/${renamedSectionName}/${renamedPageSlug}"]`)
    ).toBeVisible({ timeout: 15000 });
    await expect(treeText(page, renamedNotebookName)).toBeVisible();
    await expect(treeText(page, notebookName)).toHaveCount(0);
    await expect.poll(() => fileExists(path.join(VAULT, renamedNotebookName, renamedSectionName, renamedPageSlug))).toBe(true);
  });

  await test.step("capture to Inbox, then delete page, section, and notebook through the main UI", async () => {
    await page.getByTestId("capture-btn").click();
    await page.getByTestId("capture-title-input").fill(captureTitle);
    await page.getByTestId("capture-notebook-select").selectOption(renamedNotebookName);
    await page.getByTestId("capture-content-input").fill("Inbox capture evidence for SN-4.");
    await Promise.all([waitForVaultRefresh(page), page.getByTestId("capture-submit-btn").click()]);

    await expectActivePageTitle(page, captureTitle);
    await expect.poll(() => fileExists(path.join(VAULT, renamedNotebookName, "Inbox", captureSlug))).toBe(true);

    await byTestId(page, `page-${renamedNotebookName}/${renamedSectionName}/${renamedPageSlug}`).click();
    await expect(
      page.locator(`[data-testid="page-${renamedNotebookName}/${renamedSectionName}/${renamedPageSlug}"]`)
    ).toHaveAttribute("data-selected", "true");
    await deletePageViaMenu(page, `${renamedNotebookName}/${renamedSectionName}/${renamedPageSlug}`);

    await expect(treeText(page, renamedPageTitle)).toHaveCount(0);
    await expectActivePageTitle(page, captureTitle);
    await expect.poll(() => fileExists(path.join(VAULT, renamedNotebookName, renamedSectionName, renamedPageSlug))).toBe(false);

    await openSectionMenu(page, `${renamedNotebookName}/${renamedSectionName}`);
    await page.getByRole("menuitem", { name: "Delete section" }).click();
    await Promise.all([waitForVaultRefresh(page), confirmDestructiveDialog(page)]);

    await expect(treeText(page, renamedSectionName)).toHaveCount(0);
    await expect.poll(() => fileExists(path.join(VAULT, renamedNotebookName, renamedSectionName))).toBe(false);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "sn-4-desktop-workflow.png"),
      fullPage: true,
    });

    await openNotebookMenu(page, renamedNotebookName);
    await page.getByRole("menuitem", { name: "Delete notebook" }).click();
    await Promise.all([waitForVaultRefresh(page), confirmDestructiveDialog(page)]);

    await expect(treeText(page, renamedNotebookName)).toHaveCount(0);
    await expect(treeText(page, "Personal Notebook")).toBeVisible();
    await expect.poll(() => fileExists(path.join(VAULT, renamedNotebookName))).toBe(false);
  });
});

test("SN-4 mobile navigation keeps the notebook to section to page flow usable", async ({ page }) => {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("open-sidebar-btn")).toBeVisible();

  // Open the mobile sheet tree (desktop rail tree stays hidden at this width).
  await page.getByTestId("open-sidebar-btn").evaluate((btn: HTMLElement) => btn.click());
  const sheetTree = page.locator('[data-slot="sheet-content"] [data-testid="tree"]');
  await expect(sheetTree).toBeVisible({ timeout: 15000 });
  await sheetTree.getByText("Quick Notes", { exact: true }).click();
  await sheetTree.getByText("Welcome to Smart Notes", { exact: true }).click();

  await expect(
    sheetTree.getByTestId("page-Personal Notebook/Quick Notes/Welcome to Smart Notes.html")
  ).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible();

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "sn-4-mobile-navigation.png"),
    fullPage: true,
  });
});
