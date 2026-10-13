import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureNotebookTreeVisible } from "./helpers";

const SECTION_PATH = "Personal Notebook/Quick Notes";
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-299");
test.use({ serviceWorkers: "block" });

test("SN-299: Insert table options and grid persist in the main flow and a text box", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn299-${testInfo.project.name}-${Date.now()}`;
  const created = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title },
  });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  const seeded = await request.put("/api/page", {
    data: {
      path: savedPage.path,
      title,
      content: '<p>Main flow anchor</p><div data-type="floating-text-box" data-x="20" data-y="160" data-width="420" data-height="180"><div data-floating-box-content><p>Box anchor</p></div></div>',
    },
  });
  expect(seeded.ok()).toBeTruthy();

  try {
    await page.goto("/");
    const tree = await ensureNotebookTreeVisible(page);
    await tree.getByText(title, { exact: true }).first().click();
    const editor = page.getByTestId("rich-text-editor");
    await expect(editor.getByText("Main flow anchor")).toBeVisible();
    const suffix = testInfo.project.name === "mobile" ? "-mobile" : "";
    const menuId = `toolbar-insert-menu${suffix}`;
    const tableId = `toolbar-table${suffix}`;

    async function openOptions() {
      await page.getByTestId(menuId).click();
      await page.getByTestId(tableId).click();
      await expect(page.getByTestId(`${tableId}-options`)).toBeVisible();
    }

    await editor.getByText("Main flow anchor").click();
    await openOptions();
    await expect(page.getByTestId(`${tableId}-count`)).toHaveText("9 cells");
    if (testInfo.project.name === "desktop") {
      await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-insert-menu.png") });
    }
    await page.getByTestId(`${tableId}-rows`).fill("2");
    await page.getByTestId(`${tableId}-columns`).fill("4");
    await page.getByTestId(`${tableId}-header`).uncheck();
    await expect(page.getByTestId(`${tableId}-count`)).toHaveText("8 cells");
    await page.getByTestId(`${tableId}-insert`).click();
    const mainTable = editor.locator(":scope > .tableWrapper table");
    await expect(mainTable.locator("tr")).toHaveCount(2);
    await expect(mainTable.locator("tr").first().locator("td")).toHaveCount(4);
    await expect(mainTable.locator("th")).toHaveCount(0);

    await editor.getByText("Box anchor").click();
    await openOptions();
    await page.getByTestId(`${tableId}-rows`).fill("3");
    await page.getByTestId(`${tableId}-columns`).fill("3");
    await page.getByTestId(`${tableId}-header`).check();
    await page.getByTestId(`${tableId}-insert`).click();
    const boxTable = editor.locator('.floating-text-box table');
    await expect(boxTable.locator("tr")).toHaveCount(3);
    await expect(boxTable.locator("tr").first().locator("th")).toHaveCount(3);
    await expect(editor.locator('.floating-text-box .activeCell')).toHaveCount(1);
    if (testInfo.project.name === "desktop") {
      await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-grid-in-box.png") });
    }

    await expect.poll(async () => {
      const response = await request.get(`/api/page?path=${encodeURIComponent(savedPage.path)}`);
      if (!response.ok()) return 0;
      const body = await response.json() as { page: { content: string } };
      return (body.page.content.match(/<table/g) ?? []).length;
    }, { timeout: 30_000 }).toBe(2);
    await page.reload();
    await page.waitForLoadState("networkidle");
    const reloadedTree = await ensureNotebookTreeVisible(page);
    await reloadedTree.getByText(title, { exact: true }).first().click();
    await expect(editor.getByText("Main flow anchor")).toBeVisible();
    await expect(editor.locator(":scope > .tableWrapper table")).toHaveCount(1);
    await expect(editor.locator('.floating-text-box table')).toHaveCount(1);
    await expect(editor.locator('.floating-text-box th')).toHaveCount(3);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
