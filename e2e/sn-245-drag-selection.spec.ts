import { expect, test, type Page } from "@playwright/test";
import { ensureNotebookTreeVisible } from "./helpers";

const SECTION_PATH = "Personal Notebook/Quick Notes";

async function seedPage(page: Page, title: string) {
  const created = await page.request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title },
  });
  expect(created.ok()).toBeTruthy();
  const { page: entry } = (await created.json()) as { page: { path: string } };
  const updated = await page.request.put("/api/page", {
    data: {
      path: entry.path,
      title,
      content: [
        "<p>Paragraph before selection and after.</p>",
        "<table><tbody><tr><td><p>Cell selection target</p></td><td><p>Neighbor cell</p></td></tr></tbody></table>",
        "<p>Trailing page content must stay unselected.</p>",
      ].join(""),
    },
  });
  expect(updated.ok(), await updated.text()).toBeTruthy();
  return entry.path;
}

async function dragText(page: Page, selector: string, start: number, end: number) {
  const positions = await page.locator(selector).evaluate((element, offsets) => {
    const text = element.firstChild!;
    return offsets.map((offset) => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + (offset === offsets[0] ? 1 : rect.width - 1), y: rect.top + rect.height / 2 };
    });
  }, [start, end - 1]);
  await page.mouse.move(positions[0].x, positions[0].y);
  await page.mouse.down();
  await page.mouse.move(positions[1].x, positions[1].y, { steps: 12 });
  await page.mouse.up();
}

test("SN-245: drag selects and copies paragraph and table-cell text", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== "desktop", "Mouse drag selection");
  const title = "sn245-" + Date.now() + "-drag-selection";
  await seedPage(page, title);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText(title, { exact: true }).first().click();
  const editor = page.getByTestId("rich-text-editor");
  await expect(editor.locator("table td")).toHaveCount(2);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await dragText(page, '[data-testid="rich-text-editor"] > p:first-child', 10, 26);
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("before selection");
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("before selection");
  await expect(page.getByTestId("bubble-menu")).toBeHidden();

  await dragText(page, '[data-testid="rich-text-editor"] table td:first-child p', 5, 14);
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("selection");
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("selection");

  await page.getByTestId("toolbar-annotate").click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect.poll(() => editor.evaluate((element) => getComputedStyle(element).userSelect)).toBe("none");
  await page.getByTestId("ink-exit-draw").click();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  expect(await editor.evaluate((element) => getComputedStyle(element).userSelect)).not.toBe("none");

  const scrollArea = page.locator(".editor-scroll-area");
  const area = await scrollArea.boundingBox();
  expect(area).not.toBeNull();
  await page.mouse.move(area!.x + area!.width / 2, area!.y + area!.height / 2);
  await page.mouse.down({ button: "middle" });
  await expect(scrollArea).toHaveClass(/editor-scroll-area--panning/);
  await page.mouse.up({ button: "middle" });
  await expect(scrollArea).not.toHaveClass(/editor-scroll-area--panning/);
  await dragText(page, '[data-testid="rich-text-editor"] table td:first-child p', 5, 14);
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("selection");
});
