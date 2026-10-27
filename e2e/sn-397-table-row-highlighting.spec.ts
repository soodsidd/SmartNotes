import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureNotebookTreeVisible } from "./helpers";

const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-397");
const TABLE = [
  "<table><tbody>",
  "<tr><th><p>Item</p></th><th><p>Qty</p></th></tr>",
  "<tr><td><p>pear</p></td><td><p>10</p></td></tr>",
  "<tr><td><p>apple</p></td><td><p>2</p></td></tr>",
  "<tr><td><p>fig</p></td><td><p>3</p></td></tr>",
  "</tbody></table>",
].join("");

test.use({ serviceWorkers: "block" });

test("SN-397: row shade and color schemes apply, clear, and persist through reload", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const mobile = testInfo.project.name === "mobile";
  const ribbonId = mobile ? "table-ribbon-mobile" : "table-ribbon";
  const title = `sn397-${testInfo.project.name}-${Date.now()}`;
  const created = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title },
  });
  expect(created.ok()).toBeTruthy();
  const { page: savedPage } = await created.json() as { page: { path: string } };
  expect((await request.put("/api/page", { data: { path: savedPage.path, title, content: `<p>Before</p>${TABLE}<p>After</p>` } })).ok()).toBeTruthy();

  const savedContent = async () => {
    const response = await request.get(`/api/page?path=${encodeURIComponent(savedPage.path)}`);
    expect(response.ok()).toBeTruthy();
    return ((await response.json()) as { page: { content: string } }).page.content;
  };
  const table = () => page.getByTestId("rich-text-editor").locator("table").first();
  const row = (name: string) => table().locator("tr").filter({ hasText: name });
  const choose = async (name: string, command: string) => {
    await row(name).locator("td").first().click();
    await page.getByTestId(`${ribbonId}-tab-rows`).click();
    await page.getByTestId(`${ribbonId}-cmd-row-highlight-${command}`).click();
  };
  const reopen = async () => {
    await page.reload();
    await openSavedPage();
    await expect(table().locator("tr")).toHaveCount(4);
  };
  const openSavedPage = async () => {
    const tree = await ensureNotebookTreeVisible(page);
    const savedButton = page.getByRole("button", { name: title, exact: true }).filter({ visible: true }).first();
    if (!(await savedButton.isVisible().catch(() => false))) {
      await tree.getByRole("button", { name: "Quick Notes", exact: true }).click();
    }
    await savedButton.click();
    await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(title);
  };

  try {
    await page.goto("/");
    await openSavedPage();
    await expect(table().locator("tr")).toHaveCount(4);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-default.png`) });

    await choose("pear", "shade");
    await expect(row("pear")).toHaveAttribute("data-row-highlight", "shade");
    await expect.poll(async () => (await savedContent()).includes('data-row-highlight="shade"'), { timeout: 30_000 }).toBe(true);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-shade.png`) });
    await reopen();
    await expect(row("pear")).toHaveAttribute("data-row-highlight", "shade");

    await choose("pear", "clear");
    await expect(row("pear")).not.toHaveAttribute("data-row-highlight");
    await expect.poll(async () => (await savedContent()).includes("data-row-highlight"), { timeout: 30_000 }).toBe(false);

    await choose("apple", "accent");
    await choose("fig", "inverse");
    await expect(row("apple")).toHaveAttribute("data-row-highlight", "accent");
    await expect(row("fig")).toHaveAttribute("data-row-highlight", "inverse");
    await expect.poll(async () => {
      const html = await savedContent();
      return html.includes('data-row-highlight="accent"') && html.includes('data-row-highlight="inverse"');
    }, { timeout: 30_000 }).toBe(true);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-schemes.png`) });
    await reopen();
    await expect(row("apple")).toHaveAttribute("data-row-highlight", "accent");
    await expect(row("fig")).toHaveAttribute("data-row-highlight", "inverse");

    await choose("apple", "clear");
    await choose("fig", "clear");
    await expect.poll(async () => (await savedContent()).includes("data-row-highlight"), { timeout: 30_000 }).toBe(false);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-cleared.png`) });
    await reopen();
    await expect(table().locator("tr[data-row-highlight]")).toHaveCount(0);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(savedPage.path)}`).catch(() => undefined);
  }
});
