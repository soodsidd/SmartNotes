import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureNotebookTreeVisible } from "./helpers";

/**
 * SN-355 rework 2: the owner saw Sort/Filter flash and fail with a real mouse. Locator.click()
 * teleports and clicks inside the hide delay, which masked a show/hide loop, so this spec glides
 * the pointer in steps, dwells longer than the hide delay, clicks raw coordinates, and counts how
 * many times the tools mount (a flash = more than one mount).
 */
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-355");
test.use({ serviceWorkers: "block" });

const TABLE = [
  "<table><tbody>",
  "<tr><th><p>Item</p></th><th><p>Qty</p></th></tr>",
  "<tr><td><p>pear</p></td><td><p>10</p></td></tr>",
  "<tr><td><p>apple</p></td><td><p>2</p></td></tr>",
  "<tr><td><p>fig</p></td><td><p>10</p></td></tr>",
  "</tbody></table>",
].join("");

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function glideTo(page: Page, locator: Locator) {
  const { x, y } = await center(locator);
  await page.mouse.move(x, y, { steps: 12 });
  return { x, y };
}

test("SN-355: header Sort toggles and Filter applies/clears with a real pointer, no flashing", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "hover tools are a desktop pointer flow");
  test.setTimeout(150_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn355-${Date.now()}`;
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  expect((await request.put("/api/page", { data: { path: savedPage.path, title, content: `<p>Anchor</p>${TABLE}<p>After</p>` } })).ok()).toBeTruthy();
  const savedContent = async () => {
    const response = await request.get(`/api/page?path=${encodeURIComponent(savedPage.path)}`);
    return response.ok() ? ((await response.json()) as { page: { content: string } }).page.content : "";
  };

  try {
    await page.goto("/");
    await ensureNotebookTreeVisible(page);
    await page.getByRole("button", { name: title, exact: true }).filter({ visible: true }).first().click();
    const table = page.getByTestId("rich-text-editor").locator("table").first();
    await expect(table.locator("tr")).toHaveCount(4);
    const header = table.locator("th").first();
    const tools = page.getByTestId("table-header-tools");
    const sort = page.getByTestId("table-header-sort");
    const filter = page.getByTestId("table-header-filter");
    const firstColumn = () => table.locator("tr td:first-child").allTextContents();

    // Count tool mounts: every show after a hide is a flash.
    await page.evaluate(() => {
      const w = window as unknown as { __toolMounts: number };
      w.__toolMounts = 0;
      new MutationObserver((records) => {
        for (const record of records) for (const node of Array.from(record.addedNodes)) {
          if (node instanceof Element && node.matches('[data-testid="table-header-tools"]')) w.__toolMounts++;
        }
      }).observe(document.body, { childList: true });
    });
    const mounts = () => page.evaluate(() => (window as unknown as { __toolMounts: number }).__toolMounts);

    // Caret in the table first (owner flow), then hover a body cell: no tools.
    const bodyCell = table.locator("td").first();
    const body = await glideTo(page, bodyCell);
    await page.mouse.click(body.x, body.y);
    await page.waitForTimeout(300);
    await expect(tools).toHaveCount(0);
    // The glide in from the notebook tree may legitimately cross the header; count from here.
    await page.evaluate(() => { (window as unknown as { __toolMounts: number }).__toolMounts = 0; });

    // Hover the header: tools appear inside the cell, header does not reflow.
    const restingHeight = await header.evaluate((cell) => cell.getBoundingClientRect().height);
    await glideTo(page, header.locator("p"));
    await expect(sort).toBeVisible();
    expect(await header.evaluate((cell) => cell.getBoundingClientRect().height)).toBe(restingHeight);
    const inside = await sort.evaluate((button, cell) => {
      const icon = button.getBoundingClientRect();
      const box = (cell as HTMLElement).getBoundingClientRect();
      return icon.left >= box.left && icon.right <= box.right && icon.top >= box.top && icon.bottom <= box.bottom;
    }, await header.elementHandle());
    expect(inside).toBe(true);

    // Rest on Sort longer than the hide delay: still mounted once, still under the pointer.
    const sortPoint = await glideTo(page, sort);
    await page.waitForTimeout(800);
    await expect(sort).toBeVisible();
    expect(await mounts()).toBe(1);
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="table-header-sort"]'), sortPoint)).toBe(true);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "sort-hover-stable.png") });

    // Sort ×2 with raw clicks at the same spot: ascending, then descending.
    await page.mouse.click(sortPoint.x, sortPoint.y);
    await expect.poll(firstColumn).toEqual(["apple", "fig", "pear"]);
    await expect(sort).toHaveAttribute("data-direction", "asc");
    await page.waitForTimeout(400);
    await page.mouse.click(sortPoint.x, sortPoint.y);
    await expect.poll(firstColumn).toEqual(["pear", "fig", "apple"]);
    await expect(sort).toHaveAttribute("data-direction", "desc");
    await expect(table.locator("tr").first().locator("th")).toHaveText(["Item", "Qty"]);
    expect(await mounts()).toBe(1);
    await expect.poll(async () => (await savedContent()).includes('data-sort-direction="desc"'), { timeout: 30_000 }).toBe(true);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "sorted-desc.png") });

    // Filter Qty = 10: open the menu with a real pointer, dwell, apply.
    await glideTo(page, table.locator("th").nth(1).locator("p"));
    await expect(filter).toBeVisible();
    const filterPoint = await glideTo(page, filter);
    await page.waitForTimeout(400);
    await page.mouse.click(filterPoint.x, filterPoint.y);
    const menu = page.getByTestId("table-header-filter-menu");
    await expect(menu).toBeVisible();
    const option = menu.getByRole("menuitemradio", { name: "10", exact: true });
    await glideTo(page, option);
    await page.waitForTimeout(400);
    await expect(menu).toBeVisible();
    await option.click();
    await expect(table.locator("tr:visible")).toHaveCount(3);
    await expect.poll(async () => (await table.locator("tr:visible td:nth-child(2)").allTextContents())).toEqual(["10", "10"]);
    await expect(filter).toHaveAttribute("data-active", "true");
    await expect.poll(async () => (await savedContent()).includes("data-column-filters"), { timeout: 30_000 }).toBe(true);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "filtered.png") });

    // Clear: All rows restores every body row and drops the saved filter.
    await page.mouse.click(filterPoint.x, filterPoint.y);
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitemradio", { name: "All rows" }).click();
    await expect(table.locator("tr:visible")).toHaveCount(4);
    await expect(filter).not.toHaveAttribute("data-active", "true");
    await expect.poll(async () => (await savedContent()).includes("data-column-filters"), { timeout: 30_000 }).toBe(false);

    // Leaving the header hides the tools.
    await glideTo(page, page.getByTestId("rich-text-editor").getByText("After"));
    await expect(tools).toHaveCount(0);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
