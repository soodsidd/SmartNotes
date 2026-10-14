import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureNotebookTreeVisible } from "./helpers";

const SECTION_PATH = "Personal Notebook/Quick Notes";
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-308");

test.use({ serviceWorkers: "block" });

const DATA_TABLE = [
  "<table><tbody>",
  "<tr><th><p>Item</p></th><th><p>Qty</p></th></tr>",
  "<tr><td><p>pear</p></td><td><p>10</p></td></tr>",
  "<tr><td><p>apple</p></td><td><p>2.5</p></td></tr>",
  "</tbody></table>",
].join("");

test("SN-308: right-click in a table opens the table menu; Delete table removes it and persists", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const project = testInfo.project.name;
  const title = `sn308-${project}-${Date.now()}`;
  const created = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title },
  });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  const seeded = await request.put("/api/page", {
    data: { path: savedPage.path, title, content: `<p>Main flow anchor</p>${DATA_TABLE}<p>After table</p>` },
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
    await expect(editor.getByText("Main flow anchor")).toBeVisible();

    // Right-click outside a table keeps the text-editing menu.
    await editor.getByText("After table").click({ button: "right" });
    const menu = page.getByTestId("editor-context-menu");
    await expect(menu).toHaveAttribute("data-menu-kind", "text");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // Right-click in a cell (caret elsewhere) moves into the cell and shows the table menu.
    await editor.locator("td").filter({ hasText: "pear" }).click({ button: "right" });
    await expect(menu).toHaveAttribute("data-menu-kind", "table");
    await expect(menu.getByTestId("ctx-table-rowBelow")).toBeVisible();
    await expect(menu.getByTestId("ctx-table-deleteTable")).toHaveClass(/comment-context-item--destructive/);
    await expect(menu.getByTestId("ctx-table-merge")).toHaveCount(0);
    const box = await menu.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${project}-table-menu.png`) });

    await menu.getByTestId("ctx-table-deleteTable").click();
    await expect(editor.locator("table")).toHaveCount(0);
    await expect(editor.getByText("After table")).toBeVisible();
    await expect.poll(savedContent, { timeout: 15_000 }).not.toContain("<table");
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});

test("SN-308: mobile ribbon keeps icons and the stats chip on one compact row", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile layout only");
  test.setTimeout(120_000);
  const title = `sn308-ribbon-${Date.now()}`;
  const created = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title },
  });
  const { page: savedPage } = await created.json() as { page: { path: string } };
  await request.put("/api/page", { data: { path: savedPage.path, title, content: `<p>Anchor</p>${DATA_TABLE}` } });
  try {
    await page.goto("/");
    const tree = await ensureNotebookTreeVisible(page);
    await tree.getByText(title, { exact: true }).first().click();
    const editor = page.getByTestId("rich-text-editor");
    await editor.locator("td").filter({ hasText: "pear" }).click();
    const ribbon = page.getByTestId("table-ribbon-mobile");
    await expect(ribbon).toBeVisible();
    const tabs = await ribbon.locator(".table-ribbon__tabs").boundingBox();
    const chip = await ribbon.getByTestId("table-ribbon-mobile-stats-toggle").boundingBox();
    expect(Math.abs(tabs!.y - chip!.y)).toBeLessThan(12);
    const ribbonBox = await ribbon.boundingBox();
    expect(ribbonBox!.height).toBeLessThanOrEqual(64);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "mobile-ribbon.png") });
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
