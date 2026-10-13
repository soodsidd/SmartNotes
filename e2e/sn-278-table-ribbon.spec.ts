import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureNotebookTreeVisible } from "./helpers";

const SECTION_PATH = "Personal Notebook/Quick Notes";
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-278");
const FORK_PHOTO = process.env.SN278_FORK_PHOTO
  ?? path.resolve(__dirname, "../../../smart-notes/Docs/Upgrades/Photos-1-001-small/PXL_20261012_212540536.jpg");
test.use({ serviceWorkers: "block" });

const BOX_TABLE = '<table><tbody><tr><th><p></p></th><th><p></p></th><th><p></p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>';
const DATA_TABLE = [
  "<table><tbody>",
  "<tr><th><p>Item</p></th><th><p>Qty</p></th></tr>",
  "<tr><td><p>pear</p></td><td><p>10</p></td></tr>",
  "<tr><td><p>apple</p></td><td><p>2.5</p></td></tr>",
  "<tr><td><p>fig</p></td><td><p>note</p></td></tr>",
  "</tbody></table>",
].join("");

async function sideBySide(page: Page, screenshot: string, out: string) {
  let photo: Buffer;
  try {
    photo = await fs.readFile(FORK_PHOTO);
  } catch {
    return;
  }
  const shot = await fs.readFile(screenshot);
  const compare = await page.context().newPage();
  await compare.setViewportSize({ width: 1800, height: 900 });
  await compare.setContent(`<body style="margin:0;display:flex;gap:16px;background:#fff;font:14px sans-serif">
    <figure style="margin:8px;flex:0 0 640px"><figcaption>Fork photo #16</figcaption><img style="width:640px" src="data:image/jpeg;base64,${photo.toString("base64")}"></figure>
    <figure style="margin:8px;flex:1"><figcaption>SN-278 build</figcaption><img style="width:100%" src="data:image/png;base64,${shot.toString("base64")}"></figure>
  </body>`);
  await compare.screenshot({ path: out, fullPage: true });
  await compare.close();
}

test("SN-278: table ribbon and selection stats appear for active cells and ribbon edits persist", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const mobile = testInfo.project.name === "mobile";
  const ribbonId = mobile ? "table-ribbon-mobile" : "table-ribbon";
  const title = `sn278-${testInfo.project.name}-${Date.now()}`;
  const created = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title },
  });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  const seeded = await request.put("/api/page", {
    data: {
      path: savedPage.path,
      title,
      content: `<p>Main flow anchor</p>${DATA_TABLE}<p>After table</p><div data-type="floating-text-box" data-x="20" data-y="420" data-width="340" data-height="140"><div data-floating-box-content>${BOX_TABLE}</div></div>`,
    },
  });
  expect(seeded.ok()).toBeTruthy();

  async function savedContent(): Promise<string> {
    const response = await request.get(`/api/page?path=${encodeURIComponent(savedPage.path)}`);
    if (!response.ok()) return "";
    const body = await response.json() as { page: { content: string } };
    return body.page.content;
  }

  try {
    await page.goto("/");
    const tree = await ensureNotebookTreeVisible(page);
    await tree.getByText(title, { exact: true }).first().click();
    const editor = page.getByTestId("rich-text-editor");
    const ribbon = page.getByTestId(ribbonId);
    const stats = page.getByTestId(`${ribbonId}-stats`);
    await expect(editor.getByText("Main flow anchor")).toBeVisible();
    await editor.getByText("Main flow anchor").click();
    await expect(ribbon).toHaveCount(0);

    // Active cell in the floating text box: ribbon in fork order + empty-cell stats (#16).
    await editor.locator(".floating-text-box td").first().click();
    await expect(ribbon).toBeVisible();
    await expect(ribbon.locator(".table-ribbon__tabs > *")).toHaveText([
      "Rows", "Columns", "Cells", "Select", "Grid mode", "Data mode", "Format", "Layout", "Data", "Expand table",
    ]);
    await expect(ribbon.locator(".table-ribbon__pill")).toHaveText(["Grid mode", "Data mode", "Expand table"]);
    await expect(stats).toHaveText("Count: 1 | Numbers: 0 | Sum: - | Average: - | Min: - | Max: -");
    if (!mobile) {
      const shot = path.join(EVIDENCE_DIR, "desktop-ribbon-in-box.png");
      await page.screenshot({ path: shot });
      await sideBySide(page, shot, path.join(EVIDENCE_DIR, "16-ribbon-comparison.png"));
    }

    // Select → Select column on the numeric column: stats over the selection.
    const mainTable = editor.locator(":scope > .tableWrapper table");
    await mainTable.getByText("10", { exact: true }).click();
    await page.getByTestId(`${ribbonId}-tab-select`).click();
    await page.getByTestId(`${ribbonId}-cmd-select-column`).click();
    await expect(stats).toHaveText("Count: 4 | Numbers: 2 | Sum: 12.5 | Average: 6.25 | Min: 2.5 | Max: 10");
    if (!mobile) await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-column-stats.png") });

    // Data → Sort A→Z on Qty keeps the header and sorts numbers first.
    await mainTable.getByText("10", { exact: true }).click();
    await page.getByTestId(`${ribbonId}-tab-data`).click();
    await page.getByTestId(`${ribbonId}-cmd-data-sort-asc`).click();
    await expect(mainTable.locator("tr td:first-child")).toHaveText(["apple", "pear", "fig"]);

    // Rows → Insert row below adds a row; Columns → Move column left reorders.
    await mainTable.getByText("pear", { exact: true }).click();
    await page.getByTestId(`${ribbonId}-tab-rows`).click();
    await page.getByTestId(`${ribbonId}-cmd-row-insert-below`).click();
    await expect(mainTable.locator("tr")).toHaveCount(5);
    await mainTable.getByText("Qty", { exact: true }).click();
    await page.getByTestId(`${ribbonId}-tab-columns`).click();
    await page.getByTestId(`${ribbonId}-cmd-column-move-left`).click();
    await expect(mainTable.locator("tr").first().locator("th")).toHaveText(["Qty", "Item"]);

    // Toggle pills: Grid mode moves by cell on ArrowDown, Data mode and Expand table persist.
    await mainTable.getByText("apple", { exact: true }).click();
    const gridPill = page.getByTestId(`${ribbonId}-mode-gridMode`);
    await gridPill.click();
    await expect(gridPill).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId(`${ribbonId}-mode-dataMode`).click();
    await page.getByTestId(`${ribbonId}-mode-expanded`).click();
    const wrapper = editor.locator(":scope > .tableWrapper");
    await expect(wrapper).toHaveAttribute("data-expanded", "true");
    await expect(wrapper).toHaveAttribute("data-grid-mode", "true");
    await expect(wrapper.locator(".numericCell")).toHaveCount(2);
    await mainTable.getByText("2.5", { exact: true }).click();
    await page.keyboard.press("ArrowDown");
    await expect(stats).toHaveText("Count: 1 | Numbers: 1 | Sum: 10 | Average: 10 | Min: 10 | Max: 10");
    if (!mobile) await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-modes-on.png") });

    // Leaving the table hides the ribbon.
    await editor.getByText("After table").click();
    await expect(ribbon).toHaveCount(0);

    await expect.poll(async () => {
      const content = await savedContent();
      return ['data-grid-mode="true"', 'data-data-mode="true"', 'data-expanded="true"'].every((attr) => content.includes(attr))
        && (content.match(/<tr/g) ?? []).length === 8;
    }, { timeout: 15_000 }).toBe(true);
    await page.reload();
    await page.waitForLoadState("networkidle");
    const reloadedTree = await ensureNotebookTreeVisible(page);
    await reloadedTree.getByText(title, { exact: true }).first().click();
    await expect(editor.getByText("Main flow anchor")).toBeVisible();
    await expect(editor.locator(":scope > .tableWrapper")).toHaveAttribute("data-expanded", "true");
    await expect(editor.locator(":scope > .tableWrapper table tr").first().locator("th")).toHaveText(["Qty", "Item"]);
    await expect(editor.locator(".floating-text-box table")).toHaveCount(1);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
