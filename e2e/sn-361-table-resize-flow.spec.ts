import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureNotebookTreeVisible } from "./helpers";

const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-361");
test.use({ viewport: { width: 1600, height: 900 }, serviceWorkers: "block" });
const TABLE = [
  "<table><tbody>",
  '<tr data-row-height="100"><th colwidth="240"><p>Item</p></th><th colwidth="240"><p>Qty</p></th><th colwidth="240"><p>Note</p></th></tr>',
  '<tr data-row-height="100"><td colwidth="240"><p>Tea</p></td><td colwidth="240"><p>2</p></td><td colwidth="240"><p>Hot</p></td></tr>',
  "</tbody></table>",
].join("");

async function dimensions(table: Locator, page: Page) {
  return page.evaluate((element) => {
    const wrapper = element.closest(".tableWrapper") as HTMLElement;
    const frame = document.querySelector("[data-testid=editor-main-flow-outline]") as HTMLElement;
    return {
      table: element.getBoundingClientRect().width,
      wrapper: wrapper.getBoundingClientRect().width,
      scroll: wrapper.scrollWidth - wrapper.clientWidth,
      frame: frame.getBoundingClientRect().width,
    };
  }, await table.elementHandle());
}

async function dragCorner(page: Page, table: Locator, dx: number, dy: number) {
  const box = (await table.boundingBox())!;
  const wrapper = (await table.locator("xpath=..").boundingBox())!;
  const x = Math.min(box.x + box.width, wrapper.x + wrapper.width) - 2;
  const y = box.y + box.height - 2;
  await page.mouse.move(x, y, { steps: 12 });
  await expect(page.getByTestId("table-resize-se")).toBeVisible();
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 16 });
  await page.mouse.up();
}

test("SN-361: real-pointer corner shrink crops table wrapper around cell content", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "resize handles use a desktop pointer");
  test.setTimeout(120_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn361-shrink-${Date.now()}`;
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  try {
    expect((await request.put("/api/page", { data: { path: savedPage.path, title, content: `<p>Resize</p>${TABLE}<p>After</p>` } })).ok()).toBeTruthy();
    await page.goto("/");
    await ensureNotebookTreeVisible(page);
    await page.getByRole("button", { name: title, exact: true }).filter({ visible: true }).first().click();
    const table = page.getByTestId("rich-text-editor").locator(".tableWrapper table").first();
    await expect(table.locator("tr")).toHaveCount(2);
    const before = await dimensions(table, page);
    await table.locator("td").first().click();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "before-shrink.png") });
    const row = table.locator("tr").last();
    const rowBefore = (await row.boundingBox())!;
    const x = rowBefore.x + rowBefore.width / 2;
    const y = rowBefore.y + rowBefore.height - 1;
    await page.mouse.move(x, y, { steps: 10 });
    await expect(page.getByTestId("table-row-divider-1")).toBeVisible();
    await page.mouse.down();
    await page.mouse.move(x, y - 50, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await row.boundingBox())!.height).toBeLessThan(rowBefore.height - 20);
    const rowAfter = (await row.boundingBox())!.height;
    await dragCorner(page, table, -180, -30);
    await expect.poll(async () => (await dimensions(table, page)).table).toBeLessThan(before.table - 150);
    const firstShrink = await dimensions(table, page);
    await dragCorner(page, table, -400, -60);
    await expect.poll(async () => (await dimensions(table, page)).table).toBeLessThan(firstShrink.table - 100);
    const after = await dimensions(table, page);
    await table.locator("td").first().click();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "after-shrink.png") });
    await fs.writeFile(path.join(EVIDENCE_DIR, "shrink-measurements.json"), JSON.stringify({ before, firstShrink, after, rowBefore: rowBefore.height, rowAfter }, null, 2));
    expect(after.table).toBeLessThan(260);
    expect(after.wrapper).toBeLessThan(before.wrapper - 150);
    expect(after.wrapper).toBeLessThan(after.table + 4);
    expect(after.scroll).toBeLessThanOrEqual(2);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});

test("SN-361: real-pointer stretch grows main flow without table wrapper clipping", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "resize handles use a desktop pointer");
  test.setTimeout(120_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn361-stretch-${Date.now()}`;
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  try {
    expect((await request.put("/api/page", { data: { path: savedPage.path, title, content: `<p>Resize</p>${TABLE}<p>After</p>` } })).ok()).toBeTruthy();
    await page.goto("/");
    await ensureNotebookTreeVisible(page);
    await page.getByRole("button", { name: title, exact: true }).filter({ visible: true }).first().click();
    const table = page.getByTestId("rich-text-editor").locator(".tableWrapper table").first();
    await expect(table.locator("tr")).toHaveCount(2);
    const before = await dimensions(table, page);
    await table.locator("td").first().click();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "before-stretch.png") });
    await dragCorner(page, table, 160, 40);
    await expect.poll(async () => (await dimensions(table, page)).table).toBeGreaterThan(before.table + 100);
    const after = await dimensions(table, page);
    await table.locator("td").first().click();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "after-stretch.png") });
    await fs.writeFile(path.join(EVIDENCE_DIR, "stretch-measurements.json"), JSON.stringify({ before, after }, null, 2));
    expect(after.frame).toBeGreaterThan(before.frame + 100);
    expect(after.frame).toBeGreaterThanOrEqual(after.table);
    expect(after.wrapper).toBeGreaterThanOrEqual(after.table - 2);
    expect(after.scroll).toBeLessThanOrEqual(2);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
