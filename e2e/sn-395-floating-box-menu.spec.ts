import { expect, test, type APIRequestContext } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

test.use({ serviceWorkers: "block" });

async function seedPage(request: APIRequestContext, title: string, content: string) {
  const created = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title },
  });
  expect(created.ok()).toBeTruthy();
  const { page: saved } = await created.json() as { page: { path: string } };
  const seeded = await request.put("/api/page", { data: { path: saved.path, title, content } });
  expect(seeded.ok()).toBeTruthy();
  return saved.path;
}
test("SN-395 floating box menu moves and deletes the targeted box", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const title = `sn395-menu-${Date.now()}`;
  const pagePath = await seedPage(request, title,
    '<p>Main column</p><div data-type="floating-text-box" data-x="40" data-y="140" data-width="360"><div data-floating-box-content><p>Keep box</p></div></div>' +
    '<div data-type="floating-text-box" data-x="40" data-y="260" data-width="360"><div data-floating-box-content><p>Delete box</p></div></div>');
  try {
    await page.setViewportSize(testInfo.project.name === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto(`/?page=${encodeURIComponent(pagePath)}`);
    await expect(page.getByRole("textbox", { name: "Page title" }).first()).toHaveValue(title, { timeout: 20_000 });
    const box = page.getByTestId("floating-text-box").filter({ hasText: "Delete box" });
    await expect(box).toBeVisible();
    async function openMenu() {
      if (testInfo.project.name === "mobile") {
        await page.locator(".ProseMirror.editor-content").evaluate((root) => {
          const target = Array.from(root.querySelectorAll(".floating-text-box p")).find((el) => el.textContent === "Delete box")!;
          const touch = new Touch({ identifier: 1, target, clientX: target.getBoundingClientRect().left + 15, clientY: target.getBoundingClientRect().top + 10 });
          target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
        });
      } else {
        await box.getByText("Delete box").click({ button: "right" });
      }
    }
    await openMenu();
    const menu = page.getByTestId("editor-context-menu");
    await expect(menu).toHaveAttribute("data-menu-kind", "floating-box");
    await expect(menu.getByTestId("ctx-floating-box-move")).toBeVisible();
    await expect(menu.getByTestId("ctx-floating-box-delete")).toBeVisible();
    const evidenceDir = path.resolve(__dirname, "../evidence/SN-395");
    await fs.mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, testInfo.project.name === "mobile" ? "context-menu-mobile.png" : "context-menu.png") });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await openMenu();
    await page.getByText("Main column").click();
    await expect(menu).toBeHidden();
    await openMenu();
    await menu.getByTestId("ctx-floating-box-move").click();
    await expect(menu).toBeHidden();
    await page.keyboard.press("ArrowRight");
    await expect(box).toHaveAttribute("data-x", "41");
    await openMenu();
    await menu.getByTestId("ctx-floating-box-delete").click();
    await expect(box).toHaveCount(0);
    await expect(page.getByTestId("floating-text-box").filter({ hasText: "Keep box" })).toBeVisible();
    await expect.poll(async () => {
      const saved = await request.get(`/api/page?path=${encodeURIComponent(pagePath)}`);
      return (await saved.json() as { page: { content: string } }).page.content;
    }, { timeout: 20_000 }).not.toContain("Delete box");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Page title" }).first()).toHaveValue(title, { timeout: 20_000 });
    await expect(page.getByTestId("floating-text-box").filter({ hasText: "Delete box" })).toHaveCount(0);
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(pagePath)}`).catch(() => undefined);
  }
});
