import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureNotebookTreeVisible } from "./helpers";

/**
 * SN-396: an active column filter stays visible without hovering the header, and the table
 * ribbon Data tab exposes Filter (caret column) and Clear all filters.
 */
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-396");
test.use({ serviceWorkers: "block" });

const TABLE = [
  "<table><tbody>",
  "<tr><th><p>Item</p></th><th><p>Qty</p></th></tr>",
  "<tr><td><p>pear</p></td><td><p>10</p></td></tr>",
  "<tr><td><p>apple</p></td><td><p>2</p></td></tr>",
  "<tr><td><p>fig</p></td><td><p>10</p></td></tr>",
  "</tbody></table>",
].join("");

async function glideTo(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y, { steps: 12 });
  return point;
}

test("SN-396: filter-active affordance persists without hover; ribbon Filter and Clear all filters", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop ribbon + header pointer flow");
  test.setTimeout(150_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn396-${Date.now()}`;
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
    const editor = page.getByTestId("rich-text-editor");
    const table = editor.locator("table").first();
    await expect(table.locator("tr")).toHaveCount(4);
    const qtyHeader = table.locator("th").nth(1);
    const ribbon = page.getByTestId("table-ribbon");
    const dataTab = page.getByTestId("table-ribbon-tab-data");
    const status = page.getByTestId("table-ribbon-filter-status");

    // 1) SN-355 header hover filter still applies Qty = 10.
    await glideTo(page, qtyHeader.locator("p"));
    const filter = page.getByTestId("table-header-filter");
    await expect(filter).toBeVisible();
    const filterPoint = await glideTo(page, filter);
    await page.waitForTimeout(300);
    await page.mouse.click(filterPoint.x, filterPoint.y);
    await page.getByTestId("table-header-filter-menu").getByRole("menuitemradio", { name: "10", exact: true }).click();
    await expect(table.locator("tr:visible")).toHaveCount(3);
    await expect.poll(async () => (await savedContent()).includes("data-column-filters"), { timeout: 30_000 }).toBe(true);

    // 2) Pointer away and caret outside the table: the header still shows the filter-active mark.
    await glideTo(page, editor.getByText("After"));
    await page.mouse.click((await editor.getByText("After").boundingBox())!.x + 5, (await editor.getByText("After").boundingBox())!.y + 5);
    await expect(page.getByTestId("table-header-tools")).toHaveCount(0);
    await expect(ribbon).toHaveCount(0);
    await expect(qtyHeader).toHaveAttribute("data-filter-active", "true");
    await expect(table.locator("th").first()).not.toHaveAttribute("data-filter-active", "true");
    const glyph = await qtyHeader.evaluate((cell) => {
      const before = getComputedStyle(cell, "::before");
      return { content: before.content, width: before.width, shadow: getComputedStyle(cell).boxShadow };
    });
    expect(glyph.content).not.toBe("none");
    expect(glyph.width).toBe("12px");
    expect(glyph.shadow).not.toBe("none");
    await qtyHeader.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-header-filter-active.png") });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-filter-active-no-hover.png") });

    // 3) Caret in the table: the ribbon names the filter state beside Data.
    await table.locator("tr:visible td").first().click();
    await expect(ribbon).toBeVisible();
    await expect(dataTab).toHaveAttribute("aria-label", "Data (1 filter active)");
    await expect(status).toBeVisible();
    await expect(status).toContainText("1");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-ribbon-filter-status.png") });

    // 4) Ribbon Data → Filter (caret column Item) → pear: a second filter.
    await dataTab.click();
    const filterItem = page.getByTestId("table-ribbon-cmd-data-filter");
    await expect(filterItem).toContainText("Filter Item");
    await filterItem.hover();
    const submenu = page.getByTestId("table-ribbon-submenu-data-filter");
    await expect(submenu).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-ribbon-filter-submenu.png") });
    await submenu.getByRole("menuitemradio", { name: "pear", exact: true }).click();
    await expect(table.locator("tr:visible")).toHaveCount(2);
    await expect(table.locator("th").first()).toHaveAttribute("data-filter-active", "true");
    await expect(dataTab).toHaveAttribute("aria-label", "Data (2 filters active)");

    // 5) Data → Clear all filters: every row back, marks gone, stored filters gone.
    await dataTab.click();
    await page.getByTestId("table-ribbon-cmd-data-clear-filters").click();
    await expect(table.locator("tr:visible")).toHaveCount(4);
    await expect(table.locator('th[data-filter-active="true"]')).toHaveCount(0);
    await expect(status).toHaveCount(0);
    await expect(dataTab).toHaveAttribute("aria-label", "Data");
    await expect.poll(async () => (await savedContent()).includes("data-column-filters"), { timeout: 30_000 }).toBe(false);
    await dataTab.click();
    await expect(page.getByTestId("table-ribbon-cmd-data-clear-filters")).toHaveAttribute("data-disabled", "");
    await page.keyboard.press("Escape");

    // 6) The one-click status pill clears too.
    await glideTo(page, qtyHeader.locator("p"));
    const point = await glideTo(page, page.getByTestId("table-header-filter"));
    await page.waitForTimeout(300);
    await page.mouse.click(point.x, point.y);
    await page.getByTestId("table-header-filter-menu").getByRole("menuitemradio", { name: "2", exact: true }).click();
    await expect(table.locator("tr:visible")).toHaveCount(2);
    await table.locator("tr:visible td").first().click();
    await expect(status).toBeVisible();
    await status.click();
    await expect(table.locator("tr:visible")).toHaveCount(4);
    await expect(table.locator('th[data-filter-active="true"]')).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-cleared.png") });
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
