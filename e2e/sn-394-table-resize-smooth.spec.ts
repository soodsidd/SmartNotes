import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureNotebookTreeVisible } from "./helpers";

/**
 * SN-394: column and corner resize must track the pointer without rebuilding table DOM mid-drag
 * (flash) and without the table wrapper clipping/scrolling before the editor frame catches up.
 */
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-394");
test.use({ viewport: { width: 1600, height: 900 }, serviceWorkers: "block" });
const TABLE = [
  "<table><tbody>",
  '<tr data-row-height="60"><th colwidth="160"><p>Item</p></th><th colwidth="160"><p>Qty</p></th><th colwidth="160"><p>Note</p></th></tr>',
  '<tr data-row-height="60"><td colwidth="160"><p>Tea</p></td><td colwidth="160"><p>2</p></td><td colwidth="160"><p>Hot</p></td></tr>',
  "</tbody></table>",
].join("");
const STEPS = 24;

interface Sample { step: number; pointerX: number; pointerY: number; table: number; height: number; columnRight: number; wrapper: number; scroll: number; frame: number }

/** Count table cells/rows ProseMirror throws away while the gesture is live. */
async function watchChurn(page: Page, table: Locator) {
  await table.evaluate((element) => {
    const w = window as unknown as { __sn394Churn: number; __sn394Observer?: MutationObserver };
    w.__sn394Churn = 0;
    w.__sn394Observer?.disconnect();
    w.__sn394Observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.removedNodes)) {
          if (node instanceof HTMLElement && /^(TD|TH|TR|TABLE)$/.test(node.tagName)) w.__sn394Churn++;
        }
      }
    });
    w.__sn394Observer.observe(element.closest(".ProseMirror")!, { childList: true, subtree: true });
  });
}
const churn = (page: Page) => page.evaluate(() => (window as unknown as { __sn394Churn: number }).__sn394Churn);

async function sample(page: Page, table: Locator, step: number, pointerX: number, pointerY: number): Promise<Sample> {
  return table.evaluate((element, args) => new Promise<Sample>((resolve) => requestAnimationFrame(() => {
    const wrapper = element.closest(".tableWrapper") as HTMLElement;
    const frame = document.querySelector("[data-testid=editor-main-flow-outline]") as HTMLElement;
    const rect = element.getBoundingClientRect();
    resolve({
      ...args,
      table: rect.width,
      height: rect.height,
      columnRight: element.rows[0].cells[0].getBoundingClientRect().right,
      wrapper: wrapper.getBoundingClientRect().width,
      scroll: wrapper.scrollWidth - wrapper.clientWidth,
      frame: frame.getBoundingClientRect().width,
    });
  })), { step, pointerX, pointerY });
}

async function openTablePage(page: Page, request: import("@playwright/test").APIRequestContext, title: string) {
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  expect((await request.put("/api/page", { data: { path: savedPage.path, title, content: `<p>Resize</p>${TABLE}<p>After</p>` } })).ok()).toBeTruthy();
  await page.goto("/");
  await ensureNotebookTreeVisible(page);
  await page.getByRole("button", { name: title, exact: true }).filter({ visible: true }).first().click();
  const table = page.getByTestId("rich-text-editor").locator(".tableWrapper table").first();
  await expect(table.locator("tr")).toHaveCount(2);
  const saved = async () => {
    const response = await request.get(`/api/page?path=${encodeURIComponent(savedPage.path)}`);
    return response.ok() ? ((await response.json()) as { page: { content: string } }).page.content : "";
  };
  return { table, saved, remove: () => request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined) };
}

test("SN-394: column-width drag tracks the pointer with no mid-drag DOM rebuild or wrapper clipping", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "resize handles use a desktop pointer");
  test.setTimeout(120_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const { table, saved, remove } = await openTablePage(page, request, `sn394-column-${Date.now()}`);
  try {
    const header = (await table.locator("th").first().boundingBox())!;
    const x = header.x + header.width - 2;
    const y = header.y + header.height / 2;
    await page.mouse.move(x - 30, y);
    await page.mouse.move(x, y, { steps: 6 });
    await expect(page.locator(".ProseMirror.resize-cursor")).toHaveCount(1);
    await watchChurn(page, table);
    await page.mouse.down();
    const samples: Sample[] = [];
    const dx = 360;
    for (let step = 1; step <= STEPS; step++) {
      const px = x + (dx * step) / STEPS;
      await page.mouse.move(px, y);
      samples.push(await sample(page, table, step, px, y));
    }
    const midDragChurn = await churn(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "column-mid-drag.png") });
    await page.mouse.up();
    const released = await sample(page, table, STEPS + 1, x + dx, y);
    await fs.writeFile(path.join(EVIDENCE_DIR, "column-drag-samples.json"), JSON.stringify({ midDragChurn, samples, released }, null, 2));

    expect(midDragChurn, "cells must not be rebuilt while the column is dragged").toBe(0);
    for (const s of samples) {
      expect(Math.abs(s.columnRight - s.pointerX - 2), `step ${s.step} divider tracks pointer`).toBeLessThanOrEqual(3);
      expect(s.scroll, `step ${s.step} wrapper never clips the growing table`).toBeLessThanOrEqual(2);
      expect(s.frame, `step ${s.step} editor frame grows with the table`).toBeGreaterThanOrEqual(s.table - 2);
    }
    const last = samples[samples.length - 1];
    expect(Math.abs(released.table - last.table), "release does not jump").toBeLessThanOrEqual(2);
    await expect.poll(saved).toMatch(/colwidth="520"/);
  } finally {
    await remove();
  }
});

test("SN-394: corner drag resizes smoothly without per-move transactions, then persists once", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "resize handles use a desktop pointer");
  test.setTimeout(120_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const { table, saved, remove } = await openTablePage(page, request, `sn394-corner-${Date.now()}`);
  try {
    const box = (await table.boundingBox())!;
    const x = box.x + box.width - 2;
    const y = box.y + box.height - 2;
    await page.mouse.move(x - 40, y - 20);
    await page.mouse.move(x, y, { steps: 6 });
    await expect(page.getByTestId("table-resize-se")).toBeVisible();
    await watchChurn(page, table);
    await page.mouse.down();
    const samples: Sample[] = [];
    const dx = 240;
    for (let step = 1; step <= STEPS; step++) {
      const px = x + (dx * step) / STEPS;
      const py = y + (40 * step) / STEPS;
      await page.mouse.move(px, py);
      samples.push(await sample(page, table, step, px, py));
    }
    const midDragChurn = await churn(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "corner-mid-drag.png") });
    await page.mouse.up();
    const released = await sample(page, table, STEPS + 1, x + dx, y + 40);
    await fs.writeFile(path.join(EVIDENCE_DIR, "corner-drag-samples.json"), JSON.stringify({ midDragChurn, samples, released }, null, 2));

    expect(midDragChurn, "cells must not be rebuilt while the table is dragged").toBe(0);
    for (let index = 0; index < samples.length; index++) {
      const s = samples[index];
      // Uniform scale: the table's right edge follows the pointer.
      expect(Math.abs(box.x + s.table - s.pointerX), `step ${s.step} right edge tracks pointer`).toBeLessThanOrEqual(4);
      expect(s.scroll, `step ${s.step} wrapper never clips the growing table`).toBeLessThanOrEqual(2);
      expect(s.frame, `step ${s.step} editor frame grows with the table`).toBeGreaterThanOrEqual(s.table - 2);
      if (index) expect(s.table, `step ${s.step} width grows monotonically`).toBeGreaterThanOrEqual(samples[index - 1].table - 0.5);
    }
    const last = samples[samples.length - 1];
    expect(Math.abs(released.table - last.table), "release does not jump").toBeLessThanOrEqual(2);
    expect(Math.abs(released.height - last.height), "release does not jump vertically").toBeLessThanOrEqual(2);
    await expect.poll(saved).toMatch(/colwidth="2\d\d"/);
  } finally {
    await remove();
  }
});
