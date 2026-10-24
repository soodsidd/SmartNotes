import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureNotebookTreeVisible } from "./helpers";

const SECTION_PATH = "Personal Notebook/Quick Notes";
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-353-355");
test.use({ serviceWorkers: "block" });

const DATA_TABLE = [
  "<table><tbody>",
  "<tr><th><p>Item</p></th><th><p>Qty</p></th><th><p>Tag</p></th></tr>",
  "<tr><td><p>pear</p></td><td><p>10</p></td><td><p>a</p></td></tr>",
  "<tr><td><p>apple</p></td><td><p>2</p></td><td><p>b</p></td></tr>",
  "<tr><td><p>fig</p></td><td><p>10</p></td><td><p>c</p></td></tr>",
  "</tbody></table>",
].join("");

async function dragCells(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("SN-353/354/355: keyboard table growth, axis delete, header sort and filter", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "keyboard + hover authoring is a desktop flow");
  test.setTimeout(150_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn353-${Date.now()}`;
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title } });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  expect((await request.put("/api/page", {
    data: { path: savedPage.path, title, content: `<p>Anchor line</p>${DATA_TABLE}<p>After</p>` },
  })).ok()).toBeTruthy();
  const savedContent = async () => {
    const response = await request.get(`/api/page?path=${encodeURIComponent(savedPage.path)}`);
    return response.ok() ? ((await response.json()) as { page: { content: string } }).page.content : "";
  };

  try {
    await page.goto("/");
    await ensureNotebookTreeVisible(page);
    await page.getByRole("button", { name: title, exact: true }).filter({ visible: true }).first().click();
    const editor = page.getByTestId("rich-text-editor");
    await editor.getByText("Anchor line").click();
    await page.keyboard.press("End");

    // SN-353: Ctrl+Alt+T inserts a 2-column, 1-row header table.
    await page.keyboard.press("Control+Alt+t");
    const grown = editor.locator("table").first();
    await expect(grown.locator("tr")).toHaveCount(1);
    await expect(grown.locator("tr").first().locator("th")).toHaveCount(2);
    await page.keyboard.type("H1");
    await grown.locator("th").nth(1).click();
    await page.keyboard.type("H2");
    await page.keyboard.press("Tab");
    await expect(grown.locator("tr").first().locator("th")).toHaveCount(3);
    await page.keyboard.type("H3");
    await page.keyboard.press("Enter");
    await expect(grown.locator("tr")).toHaveCount(2);
    await page.keyboard.type("B3");
    await expect(grown.locator("tr").nth(1).locator("td").nth(2)).toHaveText("B3");
    const thBg = await grown.locator("th").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const tdBg = await grown.locator("td").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(thBg).not.toBe(tdBg);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "sn353-grown-table.png") });
    await expect.poll(async () => (await savedContent()).includes("B3"), { timeout: 30_000 }).toBe(true);

    // SN-355: hover header reveals sort/filter; icons hidden otherwise.
    const data = editor.locator("table").nth(1);
    const sort = page.getByTestId("table-header-sort");
    await data.locator("td").first().hover();
    await expect(sort).toHaveCount(0);
    await data.locator("th").first().hover();
    await expect(sort).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "sn355-header-hover.png") });
    await sort.click();
    const firstColumn = () => data.locator("tr td:first-child").allTextContents();
    await expect.poll(firstColumn).toEqual(["apple", "fig", "pear"]);
    await data.locator("th").first().hover();
    await page.getByTestId("table-header-sort").click();
    await expect.poll(firstColumn).toEqual(["pear", "fig", "apple"]);
    await expect(data.locator("tr").first().locator("th").first()).toHaveText("Item");

    await data.locator("th").nth(1).hover();
    await page.getByTestId("table-header-filter").click();
    const menu = page.getByTestId("table-header-filter-menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitemradio", { name: "10", exact: true }).click();
    await expect(data.locator("tr:visible")).toHaveCount(3);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "sn355-filtered.png") });
    await data.locator("th").nth(1).hover();
    await page.getByTestId("table-header-filter").click();
    await menu.getByRole("menuitemradio", { name: "All rows" }).click();
    await expect(data.locator("tr:visible")).toHaveCount(4);

    // SN-354: select body rows pear+fig across all columns and Delete.
    await dragCells(page, data.locator("tr").nth(1).locator("td").first(), data.locator("tr").nth(2).locator("td").nth(2));
    await expect(data.locator(".selectedCell")).toHaveCount(6);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "sn354-rows-selected.png") });
    await page.keyboard.press("Delete");
    await expect(data.locator("tr")).toHaveCount(2);
    await expect.poll(firstColumn).toEqual(["apple"]);

    // Select columns Qty..Tag and Delete.
    await dragCells(page, data.locator("th").nth(1), data.locator("tr").nth(1).locator("td").nth(2));
    await expect(data.locator(".selectedCell")).toHaveCount(4);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "sn354-columns-selected.png") });
    await page.keyboard.press("Delete");
    await expect(data.locator("tr").first().locator("th")).toHaveCount(1);
    await expect(data.locator("tr").first()).toHaveText("Item");
    await expect.poll(firstColumn).toEqual(["apple"]);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "sn354-after-delete.png") });

    // Selection chrome still works after delete.
    await dragCells(page, data.locator("th").first(), data.locator("td").first());
    await expect(data.locator(".selectedCell")).toHaveCount(2);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
