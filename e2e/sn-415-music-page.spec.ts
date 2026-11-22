import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const evidence = path.resolve(__dirname, "evidence", "SN-415");

test("music page keeps ink aligned through reload, full screen, and print", async ({ page }) => {
  test.setTimeout(120_000);
  await fs.mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  const title = `sn415-melody-${Date.now()}`;
  const response = await page.request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title, noteType: "music" },
  });
  expect(response.status()).toBe(201);
  const { page: created } = await response.json() as { page: { path: string; noteType: string } };
  expect(created.noteType).toBe("music");

  await page.goto(`/?page=${encodeURIComponent(created.path)}`);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  const music = page.getByTestId("music-page");
  await expect(music).toBeVisible({ timeout: 20000 });
  await expect(music.locator(".music-staff__line")).toHaveCount(50);
  await music.getByRole("button", { name: "Full screen" }).click();
  await expect(music).toHaveClass(/music-page--fullscreen/);
  await expect(music.locator(".tl-canvas")).toBeVisible({ timeout: 15000 });

  const paper = music.locator(".music-page__paper");
  const box = await paper.boundingBox();
  expect(box).not.toBeNull();
  await page.keyboard.press("d");
  await page.mouse.move(box!.x + box!.width * 0.32, box!.y + box!.height * 0.24);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.48, box!.y + box!.height * 0.22, { steps: 16 });
  await page.mouse.up();
  await expect.poll(async () => {
    const ink = await page.request.get(`/api/ink?path=${encodeURIComponent(created.path)}`);
    const data = await ink.json() as { scene?: { document?: { store?: Record<string, unknown> } } };
    return Object.keys(data.scene?.document?.store ?? {}).filter((key) => key.startsWith("shape:")).length;
  }, { timeout: 10000 }).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(evidence, "tablet-fullscreen-ink.png") });

  await page.reload();
  await expect(page.getByTestId("music-page")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".music-page__ink .tl-shape").first()).toBeVisible({ timeout: 15000 });
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: path.join(evidence, "print-staff-ink.png"), fullPage: true });
  await page.pdf({ path: path.join(evidence, "music-page.pdf"), format: "A4", printBackground: true });
});
