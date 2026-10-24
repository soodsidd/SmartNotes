import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureNotebookTreeVisible } from "./helpers";

/**
 * SN-357 rework 2: quiet chrome + working column drag, double-click fit, and corner resize,
 * exercised with stepped (human-like) pointer moves on a fresh table that has no stored widths.
 */
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-357");
test.use({ serviceWorkers: "block" });

const TABLE = [
  "<table><tbody>",
  "<tr><th><p>Item</p></th><th><p>Qty</p></th><th><p>Note</p></th></tr>",
  '<tr data-row-height="120" style="height: 120px"><td><p>longer description</p></td><td><p>10</p></td><td><p>x</p></td></tr>',
  "<tr><td><p>apple</p></td><td><p>2</p></td><td><p>y</p></td></tr>",
  "</tbody></table>",
].join("");

const CHROME = "[data-table-resize-chrome], .column-resize-handle";

async function colWidths(table: Locator) {
  return table.locator("col").evaluateAll((cols) => cols.map((col) => col.getBoundingClientRect().width));
}
async function rowHeights(table: Locator) {
  return table.locator("tr").evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
}
async function dragFrom(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

test("SN-357: quiet chrome; column drag, double-click fit, and corner resize persist", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "table resize is a desktop pointer flow");
  test.setTimeout(150_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn357-${Date.now()}`;
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  expect((await request.put("/api/page", { data: { path: savedPage.path, title, content: `<p>Resize table</p>${TABLE}<p>After</p>` } })).ok()).toBeTruthy();
  const saved = async () => {
    const response = await request.get(`/api/page?path=${encodeURIComponent(savedPage.path)}`);
    return response.ok() ? ((await response.json()) as { page: { content: string } }).page.content : "";
  };

  try {
    await page.goto("/");
    await ensureNotebookTreeVisible(page);
    await page.getByRole("button", { name: title, exact: true }).filter({ visible: true }).first().click();
    const table = page.getByTestId("rich-text-editor").locator("table").first();
    await expect(table.locator("tr")).toHaveCount(3);
    const cell = (row: number, column: number) => table.locator("tr").nth(row).locator("th,td").nth(column);

    // Quiet by default: pointer resting inside a cell shows no resize chrome at all.
    const mid = (await cell(2, 1).boundingBox())!;
    await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2, { steps: 10 });
    await page.waitForTimeout(300);
    await expect(page.locator(CHROME)).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "rest-quiet.png") });

    // Column divider (body row): approach the border; one thin line appears; drag narrows only col 0.
    const start = await colWidths(table);
    const body = (await cell(2, 0).boundingBox())!;
    await page.mouse.move(body.x + body.width - 2, body.y + body.height / 2, { steps: 10 });
    // prosemirror-tables draws the handle in each cell of the column: one thin full-height line.
    await expect(page.locator(".column-resize-handle")).toHaveCount(3);
    const line = await page.locator(".column-resize-handle").evaluateAll((els) => els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, left: Math.round(rect.left) };
    }));
    expect(line.every((piece) => piece.width <= 2)).toBe(true);
    expect(new Set(line.map((piece) => piece.left)).size).toBe(1);
    await expect(page.locator("[data-table-resize-chrome]")).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "column-divider-hover.png") });
    await dragFrom(page, body.x + body.width - 2, body.y + body.height / 2, -90, 0);
    await expect.poll(async () => (await colWidths(table))[0]).toBeLessThan(start[0] - 70);
    const narrowed = await colWidths(table);
    expect(Math.abs(narrowed[1] - start[1])).toBeLessThanOrEqual(2);
    expect(Math.abs(narrowed[2] - start[2])).toBeLessThanOrEqual(2);

    // Column divider (header row, where the Sort/Filter tools also live): drag widens col 0.
    const head = (await cell(0, 0).boundingBox())!;
    await page.mouse.move(head.x + 20, head.y + head.height / 2, { steps: 6 });
    await dragFrom(page, head.x + head.width - 2, head.y + head.height / 2, 40, 0);
    await expect.poll(async () => (await colWidths(table))[0]).toBeGreaterThan(narrowed[0] + 30);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "column-drag.png") });

    // Double-click the column divider: col 0 fits its longest content on one line.
    const before = (await cell(1, 0).boundingBox())!;
    await page.mouse.move(before.x + before.width - 2, before.y + 20, { steps: 6 });
    await page.mouse.dblclick(before.x + before.width - 2, before.y + 20);
    await expect.poll(async () => cell(1, 0).locator("p").evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const lines = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
      return lines.size;
    })).toBe(1);
    const fitted = await colWidths(table);
    expect(await cell(1, 0).evaluate((td) => td.scrollWidth <= td.clientWidth + 1)).toBe(true);
    const textWidth = await cell(1, 0).locator("p").evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      return range.getBoundingClientRect().width;
    });
    expect(fitted[0]).toBeLessThan(textWidth + 60);

    // Row divider: hover the border under the 120px row; a thin line appears; double-click fits it.
    const tall = await rowHeights(table);
    expect(tall[1]).toBeGreaterThan(110);
    const rowBox = (await cell(1, 1).boundingBox())!;
    await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height - 1, { steps: 8 });
    const divider = page.getByTestId("table-row-divider-1");
    await expect(divider).toBeVisible();
    await expect(page.locator("[data-table-resize-chrome]")).toHaveCount(1);
    expect(await divider.evaluate((el) => parseFloat(getComputedStyle(el, "::after").height))).toBeLessThanOrEqual(2);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "row-divider-hover.png") });
    await divider.dblclick();
    await expect.poll(async () => (await rowHeights(table))[1]).toBeLessThan(70);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "divider-fit.png") });

    // Corner: only the reached corner shows a small handle at the table's real corner.
    const widths0 = await colWidths(table);
    const heights0 = await rowHeights(table);
    const box = (await table.boundingBox())!;
    const corner = { x: box.x + box.width - 2, y: box.y + box.height - 2 };
    await page.mouse.move(corner.x, corner.y, { steps: 10 });
    const se = page.getByTestId("table-resize-se");
    await expect(se).toBeVisible();
    await expect(page.locator("[data-table-resize-chrome]")).toHaveCount(1);
    const handle = (await se.boundingBox())!;
    expect(Math.abs(handle.x + handle.width / 2 - (box.x + box.width))).toBeLessThanOrEqual(2);
    expect(Math.abs(handle.y + handle.height / 2 - (box.y + box.height))).toBeLessThanOrEqual(2);
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="table-resize-se"]'), corner)).toBe(true);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "corner-hover.png") });
    await page.mouse.down();
    await page.mouse.move(corner.x + 140, corner.y + 60, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await colWidths(table))[0]).toBeGreaterThan(widths0[0] + 20);
    const widths1 = await colWidths(table);
    const heights1 = await rowHeights(table);
    const scale = widths1[0] / widths0[0];
    for (let index = 0; index < widths0.length; index++) expect(widths1[index] / widths0[index]).toBeCloseTo(scale, 1);
    for (let index = 0; index < heights0.length; index++) expect(heights1[index] / heights0[index]).toBeCloseTo(scale, 1);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "corner-resize.png") });

    // Shrink far past content from the visible corner (a grown table may now be wider than its
    // scrolling wrapper; the handle must sit on the visible edge so it can always be shrunk back).
    const grown = (await table.boundingBox())!;
    const wrapper = (await page.getByTestId("rich-text-editor").locator(".tableWrapper").first().boundingBox())!;
    const visible = { x: Math.min(grown.x + grown.width, wrapper.x + wrapper.width) - 2, y: grown.y + grown.height - 2 };
    await page.mouse.move(visible.x, visible.y, { steps: 10 });
    await expect(se).toBeVisible();
    await dragFrom(page, visible.x, visible.y, -600, -400);
    await expect.poll(async () => (await colWidths(table))[0]).toBeLessThan(widths1[0]);
    expect(await table.locator("th,td").evaluateAll((cells) => cells.every((td) =>
      td.scrollWidth <= td.clientWidth + 2 && td.scrollHeight <= td.clientHeight + 2))).toBe(true);

    // Moving away clears all chrome; sizes persist with the page HTML.
    await page.mouse.move(mid.x, mid.y - 400, { steps: 6 });
    await expect(page.locator("[data-table-resize-chrome]")).toHaveCount(0);
    await expect.poll(async () => (await saved()).includes("data-row-height"), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await saved()).match(/colwidth="/g)?.length ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
