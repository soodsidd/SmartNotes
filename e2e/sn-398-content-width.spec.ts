import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-398");
test.use({ viewport: { width: 2400, height: 1000 }, serviceWorkers: "block" });

const table = (cellWidth: number) => `<table><tbody><tr>${["One", "Two", "Three"].map((label) => `<th colwidth="${cellWidth}"><p>${label}</p></th>`).join("")}</tr><tr>${["A", "B", "C"].map((label) => `<td colwidth="${cellWidth}"><p>${label}</p></td>`).join("")}</tr></tbody></table>`;
const box = (body: string) => `<div data-type="floating-text-box" data-x="40" data-y="260" data-width="360"><div data-floating-box-content>${body}</div></div>`;

async function save(request: APIRequestContext, pagePath: string, title: string, content: string) {
  expect((await request.put("/api/page", { data: { path: pagePath, title, content } })).ok()).toBeTruthy();
}

async function swapContent(page: Page, html: string) {
  await page.locator(".ProseMirror.editor-content").evaluate((element, next) => {
    const editor = (element as HTMLElement & { editor: { commands: { setContent: (value: string) => void } } }).editor;
    editor.commands.setContent(next);
  }, html);
}

async function open(page: Page, pagePath: string, title: string) {
  await page.goto(`/?page=${encodeURIComponent(pagePath)}`);
  await expect(page.getByRole("textbox", { name: "Page title" }).first()).toHaveValue(title, { timeout: 20_000 });
  await expect(page.getByTestId("rich-text-editor")).toBeVisible();
}

async function widths(tableLocator: Locator) {
  return tableLocator.evaluate((element) => {
    const wrapper = element.closest(".tableWrapper") as HTMLElement;
    const frame = document.querySelector("[data-testid=editor-main-flow-outline]") as HTMLElement;
    return { table: element.getBoundingClientRect().width, frame: frame.getBoundingClientRect().width,
      overflow: wrapper.scrollWidth - wrapper.clientWidth, overflowStyle: getComputedStyle(wrapper).overflowX };
  });
}

async function dragCorner(page: Page, target: Locator, dx: number) {
  const rect = (await target.boundingBox())!;
  const x = rect.x + rect.width - 2;
  const y = rect.y + rect.height - 2;
  await page.mouse.move(x - 30, y - 20);
  await page.mouse.move(x, y, { steps: 8 });
  await expect(page.getByTestId("table-resize-se")).toBeVisible();
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 20 });
  await page.mouse.up();
}

test("SN-398: desktop table growth is uncapped and shrinks to reading width; images grow the flow and boxes", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn398-width-${Date.now()}`;
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  try {
    await save(request, savedPage.path, title, `<p>Reading width</p>${table(240)}${box(`<p>Floating</p>${table(240)}`)}`);
    await open(page, savedPage.path, title);
    const mainTable = page.getByTestId("rich-text-editor").locator(":scope > .tableWrapper table").first();
    await expect(mainTable).toBeVisible();
    const before = await widths(mainTable);
    expect(before.frame).toBeGreaterThanOrEqual(before.table - 2);
    await dragCorner(page, mainTable, 740);
    await expect.poll(async () => (await widths(mainTable)).table).toBeGreaterThan(1200);
    const grown = await widths(mainTable);
    expect(grown.frame).toBeGreaterThanOrEqual(grown.table - 2);
    expect(grown.overflow).toBeLessThanOrEqual(2);
    expect(grown.overflowStyle).toBe("visible");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-table-grown.png") });

    await dragCorner(page, mainTable, -1000);
    await expect.poll(async () => (await widths(mainTable)).table).toBeLessThan(672);
    await expect.poll(async () => (await widths(mainTable)).frame).toBeLessThan(730);
    const shrunk = await widths(mainTable);
    expect(shrunk.frame).toBeGreaterThanOrEqual(720);
    expect(shrunk.frame).toBeLessThan(730);
    expect(shrunk.overflow).toBeLessThanOrEqual(2);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-table-shrunk.png") });

    const floating = page.getByTestId("floating-text-box");
    await expect.poll(async () => floating.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(720);
    expect(await floating.locator(".tableWrapper").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-floating-table.png") });

    const fluidTable = `<table><tbody><tr>${Array.from({ length: 16 }, (_, index) => `<td><p>${index + 1}</p></td>`).join("")}</tr></tbody></table>`;
    await swapContent(page, `<p>Many unsized columns</p>${fluidTable}`);
    const unsized = page.getByTestId("rich-text-editor").locator(":scope > .tableWrapper table").first();
    await expect(unsized).toBeVisible();
    await expect.poll(async () => (await widths(unsized)).frame).toBeGreaterThan(900);
    const fluid = await widths(unsized);
    expect(fluid.overflow).toBeLessThanOrEqual(2);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-unsized-table.png") });

    await swapContent(page, `<p>Image beyond the old frame</p><p><img src="/icon-192.png" width="1600"></p>${box('<p>Floating image</p><p><img src="/icon-192.png" width="900"></p>')}`);
    const image = page.getByTestId("rich-text-editor").locator(":scope > p img").first();
    await expect(image).toBeVisible();
    await expect.poll(async () => page.getByTestId("editor-main-flow-outline").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(1600);
    await expect.poll(async () => page.getByTestId("floating-text-box").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(900);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-images-grown.png") });

    await swapContent(page, `<p>Image shrunk</p><p><img src="/icon-192.png" width="200"></p>${box('<p>Floating image</p><p><img src="/icon-192.png" width="120"></p>')}`);
    await expect(page.getByTestId("rich-text-editor").locator(":scope > p img").first()).toBeVisible();
    await expect(page.getByTestId("floating-text-box").locator("img:not(.ProseMirror-separator)").first()).toBeVisible();
    await expect.poll(async () => page.getByTestId("editor-main-flow-outline").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(730);
    await expect.poll(async () => page.getByTestId("floating-text-box").evaluate((element) => element.getBoundingClientRect().width)).toBe(360);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-images-shrunk.png") });
    await fs.writeFile(path.join(EVIDENCE_DIR, "measurements.json"), JSON.stringify({ before, grown, shrunk, fluid }, null, 2));
    expect(pageErrors).toEqual([]);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});

test("SN-398: mobile table keeps local scroll and floating focus chrome", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 430, height: 900 });
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn398-mobile-${Date.now()}`;
  const created = await request.post("/api/page", { data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  try {
    await save(request, savedPage.path, title, `<p>Mobile table</p>${table(240)}${box("<p>Floating focus</p>")}`);
    await open(page, savedPage.path, title);
    const wrapper = page.getByTestId("rich-text-editor").locator(":scope > .tableWrapper").first();
    await expect(wrapper).toBeVisible();
    expect(await wrapper.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "mobile-table-scroll.png") });
    const floating = page.getByTestId("floating-text-box");
    await floating.locator("p").click();
    await expect(floating).toHaveAttribute("data-editing", "true");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "mobile-floating-focused.png") });
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
