import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Page create uses optimistic tree updates (no GET /api/vault). Wait on POST instead. */
export async function waitForPageCreate(page: Page) {
  await page.waitForResponse(
    (r) => r.url().includes("/api/page") && r.request().method() === "POST" && r.status() === 201
  );
}

export async function waitForVaultRefresh(page: Page) {
  await page.waitForResponse(
    (r) => r.url().includes("/api/vault") && r.request().method() === "GET" && r.status() === 200
  );
}

export async function submitTextDialog(page: Page, value: string, actionName = "Create") {
  const input = page.getByTestId("dialog-input");
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(value);
  const dialog = page.locator('[role="dialog"]').filter({ has: page.getByTestId("dialog-input") });
  await dialog.getByRole("button", { name: actionName }).click();
  await expect(input).not.toBeVisible({ timeout: 15000 });
}

/** Open the notebook tree when the mobile sheet (or collapsed rail) hides it. */
export async function ensureNotebookTreeVisible(page: Page) {
  await dismissBlockingOverlays(page);
  const visibleTree = page.locator('[data-testid="tree"]').filter({ visible: true }).first();
  if (await visibleTree.isVisible().catch(() => false)) {
    return visibleTree;
  }
  const openBtn = page.getByTestId("open-sidebar-btn");
  await expect(openBtn).toBeVisible({ timeout: 8000 });
  await openBtn.evaluate((btn: HTMLElement) => btn.click());
  const sheetTree = page.locator('[data-slot="sheet-content"] [data-testid="tree"]');
  if (await sheetTree.count()) {
    await expect(sheetTree).toBeVisible({ timeout: 10000 });
    return sheetTree;
  }
  await expect(visibleTree).toBeVisible({ timeout: 10000 });
  return visibleTree;
}

/** Close mobile notes sheet if open so header controls are clickable. */
export async function closeNotebookTreeSheet(page: Page) {
  const sheet = page.locator('[data-slot="sheet-content"]');
  if (await sheet.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden({ timeout: 5000 }).catch(() => undefined);
  }
}

/** New notebook opens CreateNotebookDialog (vault vs remote), not the generic dialog-input. */
export async function createVaultNotebook(page: Page, name: string) {
  await ensureNotebookTreeVisible(page);
  await closeNotebookTreeSheet(page);
  await page.getByTestId("add-menu-trigger").evaluate((btn: HTMLElement) => btn.click());
  await page.getByRole("menuitem", { name: "New notebook" }).click();
  await expect(page.getByTestId("create-notebook-dialog")).toBeVisible({ timeout: 5000 });
  await page.getByTestId("create-vault-notebook-option").click();
  const input = page.getByTestId("create-vault-notebook-name-input");
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(name);
  await page.getByTestId("create-vault-notebook-submit").click();
  await expect(page.getByTestId("create-notebook-dialog")).not.toBeVisible({ timeout: 15000 });
}

export async function submitCreatePageDialog(page: Page, title: string) {
  const createResponse = waitForPageCreate(page);
  await submitTextDialog(page, title);
  await createResponse;
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 20000 });
  // Selection can lag optimistic tree append; click the new row if needed.
  const tree = await ensureNotebookTreeVisible(page);
  const treeRow = tree.getByText(title, { exact: true }).first();
  await expect(treeRow).toBeVisible({ timeout: 15000 });
  await treeRow.click();
  await expectActivePageTitle(page, title);
}

/** Active page row in the vault tree (title lives in the tree, not a dedicated title input). */
export async function expectActivePageTitle(page: Page, title: string | RegExp) {
  await expect(
    page.locator('[data-testid^="page-"][data-selected="true"]').filter({ visible: true }).first()
  ).toContainText(title, {
    timeout: 15000,
  });
}

export async function openPageMenu(page: Page, pagePath: string) {
  await ensureNotebookTreeVisible(page);
  await page.locator(`[data-testid="page-menu-${pagePath}"]`).filter({ visible: true }).click();
}

export async function renamePageViaMenu(page: Page, pagePath: string, newTitle: string) {
  await openPageMenu(page, pagePath);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await submitTextDialog(page, newTitle, "Rename");
}

export async function deletePageViaMenu(page: Page, pagePath: string) {
  await openPageMenu(page, pagePath);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.locator('[role="dialog"]').getByRole("button", { name: "Delete" }).click();
}

export async function movePageViaMenu(page: Page, pagePath: string, targetSectionPath: string) {
  await openPageMenu(page, pagePath);
  await page.getByRole("menuitem", { name: "Move" }).click();
  await page.getByTestId("move-page-select").selectOption(targetSectionPath);
  await page.locator('[role="dialog"]').getByRole("button", { name: "Move" }).click();
}

export async function openSectionContextMenu(page: Page, sectionPath: string) {
  await ensureNotebookTreeVisible(page);
  await page
    .locator(`[data-testid="section-menu-${sectionPath}"]`)
    .filter({ visible: true })
    .click();
}

/** Create a page via the current API (replaces obsolete POST /api/create). */
export async function apiCreatePage(
  request: APIRequestContext,
  input: { notebookPath: string; sectionPath: string; title: string }
) {
  const response = await request.post("/api/page", {
    data: {
      notebookPath: input.notebookPath,
      sectionPath: input.sectionPath,
      title: input.title,
    },
  });
  expect(response.ok()).toBe(true);
  const json = (await response.json()) as { page: { path: string; title: string } };
  return json.page;
}

export async function apiCreateNotebook(request: APIRequestContext, name: string) {
  const response = await request.post("/api/notebook", { data: { name } });
  expect(response.ok()).toBe(true);
  const json = (await response.json()) as { notebook: { path: string; name: string } };
  return json.notebook;
}

/** Dismiss SW update / other top overlays that intercept Playwright clicks in E2E. */
export async function dismissBlockingOverlays(page: Page) {
  const swBanner = page.getByTestId("sw-update-banner");
  if (await swBanner.isVisible().catch(() => false)) {
    await page.getByTestId("sw-update-dismiss").click({ force: true }).catch(() => undefined);
    await expect(swBanner).toBeHidden({ timeout: 3000 }).catch(() => undefined);
  }
}

export async function visibleTree(page: Page) {
  return ensureNotebookTreeVisible(page);
}
