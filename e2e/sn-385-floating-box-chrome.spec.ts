import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

test.use({ serviceWorkers: "block" });

test("SN-385 floating box chrome appears only while editing its content", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "desktop", "desktop screenshot evidence");
  const title = `sn385-chrome-${Date.now()}`;
  const created = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title },
  });
  expect(created.ok()).toBeTruthy();
  const { page: saved } = await created.json() as { page: { path: string } };
  const seeded = await request.put("/api/page", {
    data: {
      path: saved.path,
      title,
      content: '<p>Main column</p><div data-type="floating-text-box" data-x="40" data-y="140" data-width="360" data-height="80"><div data-floating-box-content><p>Floating note</p></div></div>',
    },
  });
  expect(seeded.ok()).toBeTruthy();

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("tree-sidebar-rail").getByText(title, { exact: true }).click();
    const box = page.getByTestId("floating-text-box");
    const controls = box.locator(".floating-text-box__controls");
    const resize = box.getByTestId("floating-text-box-resize");
    const width = box.getByTestId("floating-text-box-resize-width");
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute("data-editing", "false");
    await expect(controls).toBeHidden();
    await expect(resize).toBeHidden();
    await expect(width).toBeHidden();
    await expect(box).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await box.hover();
    await expect(controls).toBeHidden();

    const evidenceDir = path.resolve(__dirname, "../evidence/SN-385");
    await fs.mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "idle.png") });
    await box.getByText("Floating note").click();
    await expect(box).toHaveAttribute("data-editing", "true");
    await expect(controls).toBeVisible();
    await expect(resize).toBeVisible();
    await expect(width).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, "editing.png") });
    await page.getByText("Main column").click();
    await expect(box).toHaveAttribute("data-editing", "false");
    await expect(controls).toBeHidden();
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(saved.path)}`).catch(() => undefined);
  }
});
