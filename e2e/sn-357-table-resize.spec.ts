import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureNotebookTreeVisible } from "./helpers";

const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-357");
test.use({ serviceWorkers: "block" });

test("SN-357: drag divider, double-click fit, and corner resize persist", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "table resize is a desktop pointer flow");
  test.setTimeout(150_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn357-${Date.now()}`;
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  const content = '<p>Resize table</p><table><tbody><tr><th colwidth="90"><p>Item</p></th><th colwidth="90"><p>Count</p></th></tr><tr data-row-height="120" style="height: 120px"><td colwidth="90"><p>Long description</p></td><td colwidth="90"><p>2</p></td></tr><tr><td colwidth="90"><p>Short</p></td><td colwidth="90"><p>10</p></td></tr></tbody></table>';
  expect((await request.put("/api/page", { data: { path: savedPage.path, title, content } })).ok()).toBeTruthy();
  try {
    await page.goto("/");
    await ensureNotebookTreeVisible(page);
    await page.getByRole("button", { name: title, exact: true }).filter({ visible: true }).first().click();
    const table = page.getByTestId("rich-text-editor").locator("table").first();
    const firstWidth = () => table.locator("col").first().evaluate((col) => col.getBoundingClientRect().width);
    const startWidth = await firstWidth();
    const header = (await table.locator("th").first().boundingBox())!;
    await page.mouse.move(header.x + header.width - 2, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(header.x + header.width + 70, header.y + header.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(firstWidth).toBeGreaterThan(startWidth + 20);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "column-drag.png") });

    const draggedWidth = await firstWidth();
    const headerAfter = (await table.locator("th").first().boundingBox())!;
    await page.mouse.dblclick(headerAfter.x + headerAfter.width - 2, headerAfter.y + headerAfter.height / 2);
    await expect.poll(firstWidth).not.toBe(draggedWidth);
    await expect.poll(firstWidth).toBeGreaterThan(120);

    const row = table.locator("tr").nth(1);
    const startHeight = await row.evaluate((element) => element.getBoundingClientRect().height);
    expect(startHeight).toBeGreaterThan(100);
    await page.getByTestId("table-row-divider-1").first().dblclick();
    await expect.poll(() => row.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(startHeight);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "divider-fit.png") });

    const beforeWidths = await table.locator("col").evaluateAll((cols) => cols.map((col) => col.getBoundingClientRect().width));
    const beforeHeights = await table.locator("tr").evaluateAll((rows) => rows.map((item) => item.getBoundingClientRect().height));
    await expect(page.locator('[data-testid^="table-resize-"]')).toHaveCount(4);
    const corner = page.getByTestId("table-resize-se").first();
    const handle = (await corner.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 130, handle.y + handle.height / 2 + 90, { steps: 8 });
    await page.mouse.up();
    await expect.poll(firstWidth).toBeGreaterThan(beforeWidths[0] + 20);
    const afterWidths = await table.locator("col").evaluateAll((cols) => cols.map((col) => col.getBoundingClientRect().width));
    const afterHeights = await table.locator("tr").evaluateAll((rows) => rows.map((item) => item.getBoundingClientRect().height));
    expect(afterWidths[1] / beforeWidths[1]).toBeCloseTo(afterWidths[0] / beforeWidths[0], 1);
    expect(afterHeights[1]).toBeGreaterThan(beforeHeights[1]);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "corner-resize.png") });

    const smallerHandle = (await corner.boundingBox())!;
    await page.mouse.move(smallerHandle.x + smallerHandle.width / 2, smallerHandle.y + smallerHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(smallerHandle.x - 400, smallerHandle.y - 400, { steps: 8 });
    await page.mouse.up();
    const fits = await table.locator("th,td").evaluateAll((cells) => cells.every((cell) =>
      cell.scrollWidth <= cell.clientWidth + 2 && cell.scrollHeight <= cell.clientHeight + 2));
    expect(fits).toBe(true);

    const saved = async () => {
      const response = await request.get(`/api/page?path=${encodeURIComponent(savedPage.path)}`);
      return response.ok() ? ((await response.json()) as { page: { content: string } }).page.content : "";
    };
    await expect.poll(async () => (await saved()).includes("data-row-height"), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await saved()).includes("colwidth="), { timeout: 30_000 }).toBe(true);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
