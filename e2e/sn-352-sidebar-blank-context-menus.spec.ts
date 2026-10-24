import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * SN-352: right-clicking blank space in each desktop sidebar pane opens a
 * pane-specific app menu, and the browser context menu never wins.
 *   - Notebook rail blank  -> notebook/section level (New section, New notebook, ...)
 *   - Page pane blank      -> page level (New page, New Jupyter notebook, ...)
 */

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "evidence", "SN-352");

const RAIL_ITEMS = ["New section", "New notebook", "Open notebook…"];
const PAGE_PANE_ITEMS = ["New page", "New Jupyter notebook", "New log", "New spreadsheet"];

async function waitForAppReady(page: Page) {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/vault") &&
        response.request().method() === "GET" &&
        response.status() === 200,
      { timeout: 30_000 }
    ),
    page.goto("/"),
  ]);
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 10_000 });
}

/** Record whether the most recent contextmenu event reached the window un-prevented (= browser menu). */
async function trackNativeContextMenu(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __sn352NativeMenu: boolean[] };
    w.__sn352NativeMenu = [];
    window.addEventListener("contextmenu", (event) => {
      w.__sn352NativeMenu.push(!event.defaultPrevented);
    });
  });
}

async function lastContextMenuWasNative(page: Page) {
  return page.evaluate(() => {
    const log = (window as unknown as { __sn352NativeMenu: boolean[] }).__sn352NativeMenu;
    return log[log.length - 1];
  });
}

/** Right-click a point near the bottom of the pane that is blank tree space (not a row or control). */
async function rightClickBlank(page: Page, pane: Locator) {
  const tree = pane.getByTestId("tree");
  await expect(tree).toBeVisible();
  const box = await pane.boundingBox();
  if (!box) throw new Error("pane has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height - 24;
  const hit = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py) as HTMLElement | null;
    return {
      inTree: Boolean(el?.closest('[data-testid="tree"]')),
      interactive: Boolean(el?.closest("button, a, input, [role='treeitem'], [data-testid^='page-'], [data-testid^='notebook-rail-row-']")),
    };
  }, [x, y] as const);
  expect(hit, "probe point must be blank tree space").toEqual({ inTree: true, interactive: false });
  await page.mouse.click(x, y, { button: "right" });
}

async function expectInViewport(page: Page, menu: Locator) {
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("menu or viewport not measurable");
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
}

async function menuItemNames(menu: Locator) {
  return (await menu.getByRole("menuitem").allInnerTexts()).map((text) => text.trim());
}

test.describe.configure({ mode: "serial" });

test("SN-352 blank sidebar space opens distinct pane-specific menus, never the browser menu", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop two-pane sidebar only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  await waitForAppReady(page);
  await trackNativeContextMenu(page);

  const rail = page.getByTestId("notebook-rail-sidebar");
  const pagePane = page.getByTestId("tree-sidebar-rail");
  await expect(rail).toBeVisible();
  await expect(pagePane).toBeVisible();

  // --- Notebook rail blank space ---
  await rightClickBlank(page, rail);
  expect(await lastContextMenuWasNative(page)).toBe(false);
  const railMenu = page.getByTestId("sidebar-blank-context-menu");
  await expect(railMenu).toBeVisible();
  await expect(railMenu).toHaveAttribute("data-pane", "rail");
  const railNames = await menuItemNames(railMenu);
  expect(railNames.some((name) => name.startsWith("New section"))).toBe(true);
  for (const name of RAIL_ITEMS.slice(1)) expect(railNames).toContain(name);
  for (const name of PAGE_PANE_ITEMS) expect(railNames).not.toContain(name);
  await expect(railMenu.getByTestId("blank-menu-new-section")).toBeEnabled();
  await expectInViewport(page, railMenu);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "rail-blank-context-menu.png") });
  await page.keyboard.press("Escape");
  await expect(railMenu).toBeHidden();

  // --- Page pane blank space ---
  await rightClickBlank(page, pagePane);
  expect(await lastContextMenuWasNative(page)).toBe(false);
  const pageMenu = page.getByTestId("sidebar-blank-context-menu");
  await expect(pageMenu).toBeVisible();
  await expect(pageMenu).toHaveAttribute("data-pane", "page-tree");
  const pageNames = await menuItemNames(pageMenu);
  for (const name of PAGE_PANE_ITEMS) expect(pageNames).toContain(name);
  expect(pageNames.some((name) => name.startsWith("New section"))).toBe(false);
  expect(pageNames).not.toContain("New notebook");
  expect(pageNames).not.toContain("Open notebook…");
  await expect(pageMenu.getByTestId("blank-menu-new-page")).toBeEnabled();
  await expectInViewport(page, pageMenu);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "page-pane-blank-context-menu.png") });
  await page.keyboard.press("Escape");
  await expect(pageMenu).toBeHidden();

  // The two blank menus must be different item sets.
  expect(railNames).not.toEqual(pageNames);
  expect(railNames.filter((name) => pageNames.includes(name))).toEqual([]);

  // Native menu is also suppressed on sidebar chrome outside the tree (resize handle).
  const handle = page.getByTestId("notebook-rail-resize-handle");
  await handle.click({ button: "right", force: true });
  expect(await lastContextMenuWasNative(page)).toBe(false);
});

test("SN-352 blank-space New section and New page create the expected entities", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop two-pane sidebar only");
  await page.setViewportSize({ width: 1440, height: 900 });
  const createdSectionDirs: string[] = [];
  const createdPageFiles: string[] = [];

  await waitForAppReady(page);
  const rail = page.getByTestId("notebook-rail-sidebar");
  const pagePane = page.getByTestId("tree-sidebar-rail");

  try {
    // Rail blank -> New section creates a section in the active notebook.
    await rightClickBlank(page, rail);
    const railMenu = page.getByTestId("sidebar-blank-context-menu");
    const sectionItem = railMenu.getByTestId("blank-menu-new-section");
    const label = (await sectionItem.innerText()).trim();
    const notebookName = label.replace(/^New section in /, "");
    expect(notebookName).not.toBe(label);
    const before = new Set(await fs.readdir(path.join(VAULT, notebookName)).catch(() => [] as string[]));
    const createSection = page.waitForResponse((r) => r.request().method() === "POST" && /section/i.test(r.url()) && r.ok());
    await sectionItem.click();
    await createSection;
    await expect.poll(async () => {
      const after = await fs.readdir(path.join(VAULT, notebookName)).catch(() => [] as string[]);
      return after.filter((name) => !before.has(name) && /^New Section/.test(name));
    }, { timeout: 10_000 }).toHaveLength(1);
    const after = await fs.readdir(path.join(VAULT, notebookName));
    const created = after.find((name) => !before.has(name) && /^New Section/.test(name))!;
    createdSectionDirs.push(path.join(VAULT, notebookName, created));
    // Leave inline rename without renaming.
    await page.keyboard.press("Escape");

    await expect(rail.getByRole("button", { name: created, exact: true })).toBeVisible();

    // Page pane blank -> New page creates a page in the pane's scoped target.
    const addLabel = (await pagePane.getByTestId("page-pane-add-page").getAttribute("aria-label")) ?? "";
    const scopeLabel = addLabel.replace(/^Add page to /, "");
    expect(scopeLabel).not.toBe("");
    const scopeDir = scopeLabel === notebookName ? path.join(VAULT, notebookName) : path.join(VAULT, notebookName, scopeLabel);
    const pagesBefore = new Set(await fs.readdir(scopeDir).catch(() => [] as string[]));
    await rightClickBlank(page, pagePane);
    const createPage = page.waitForResponse(
      (r) => r.url().includes("/api/page") && r.request().method() === "POST" && r.status() === 201
    );
    await page.getByTestId("sidebar-blank-context-menu").getByTestId("blank-menu-new-page").click();
    const response = await createPage;
    const payload = response.request().postDataJSON() as { notebookPath?: string; sectionPath?: string | null };
    expect(payload.notebookPath).toBe(notebookName);
    if (scopeLabel !== notebookName) expect(payload.sectionPath).toBe(`${notebookName}/${scopeLabel}`);
    await expect.poll(async () => {
      const files = await fs.readdir(scopeDir).catch(() => [] as string[]);
      const fresh = files.filter((name) => !pagesBefore.has(name) && name.endsWith(".html"));
      createdPageFiles.splice(0, createdPageFiles.length, ...fresh.map((name) => path.join(scopeDir, name)));
      return fresh.length;
    }, { timeout: 10_000 }).toBe(1);
    await expect(page.getByRole("textbox", { name: "Page title" }).first()).toBeVisible();
  } finally {
    for (const file of createdPageFiles) await fs.rm(file, { force: true });
    for (const dir of createdSectionDirs) await fs.rm(dir, { recursive: true, force: true });
  }
});

