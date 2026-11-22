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

test("music page stores ink in paper coordinates when the paper is scaled down", async ({ page }) => {
  test.setTimeout(120_000);
  await fs.mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 600, height: 900 });
  const title = `sn415-narrow-${Date.now()}`;
  const response = await page.request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title, noteType: "music" },
  });
  expect(response.status()).toBe(201);
  const { page: created } = await response.json() as { page: { path: string } };

  await page.goto(`/?page=${encodeURIComponent(created.path)}`);
  const music = page.getByTestId("music-page");
  await expect(music).toBeVisible({ timeout: 20000 });
  await expect(music.locator(".tl-canvas")).toBeVisible({ timeout: 15000 });
  const paper = music.locator(".music-page__paper");
  const box = (await paper.boundingBox())!;
  expect(box.width).toBeLessThan(794 - 50);

  // Start the stroke at a known fraction of the visible paper.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.3, { steps: 12 });
  await page.mouse.up();

  let origin: { x: number; y: number } | null = null;
  await expect.poll(async () => {
    const ink = await page.request.get(`/api/ink?path=${encodeURIComponent(created.path)}`);
    const data = await ink.json() as { scene?: { document?: { store?: Record<string, { typeName?: string; x: number; y: number }> } } };
    const shape = Object.values(data.scene?.document?.store ?? {}).find((record) => record.typeName === "shape");
    origin = shape ? { x: shape.x, y: shape.y } : null;
    return Boolean(origin);
  }, { timeout: 10000 }).toBe(true);
  expect(Math.abs(origin!.x - 794 * 0.5)).toBeLessThan(12);
  expect(Math.abs(origin!.y - 1123 * 0.3)).toBeLessThan(12);
  await page.screenshot({ path: path.join(evidence, "narrow-scaled-ink.png") });
});

test("sidebar page-pane blank menu and page right-click menu create music pages", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop two-pane sidebar menus");
  test.setTimeout(120_000);
  await fs.mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const title = `sn415-parent-${Date.now()}`;
  const response = await page.request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title },
  });
  expect(response.status()).toBe(201);
  const { page: parent } = await response.json() as { page: { path: string } };

  await page.goto(`/?page=${encodeURIComponent(parent.path)}`);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  const row = page.getByTestId(`page-${parent.path}`);
  await expect(row).toBeVisible({ timeout: 20000 });

  // Page right-click -> New child music page.
  await row.click({ button: "right" });
  const pageMenu = page.getByTestId(`page-context-menu-${parent.path}`);
  await expect(pageMenu).toBeVisible();
  await page.screenshot({ path: path.join(evidence, "page-context-menu-music.png") });
  const createChild = page.waitForResponse((r) => r.url().includes("/api/page") && r.request().method() === "POST" && r.status() === 201);
  await pageMenu.getByTestId(`page-context-create-music-${parent.path}`).click();
  const child = await createChild;
  expect(child.request().postDataJSON()).toMatchObject({ noteType: "music", parentId: parent.path, sectionPath: "Personal Notebook/Quick Notes" });
  await expect(page.getByTestId("music-page")).toBeVisible({ timeout: 20000 });

  // Page pane blank space -> New music page in the scoped section.
  const pagePane = page.getByTestId("tree-sidebar-rail");
  const paneBox = (await pagePane.boundingBox())!;
  await page.mouse.click(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height - 24, { button: "right" });
  const blankMenu = page.getByTestId("sidebar-blank-context-menu");
  await expect(blankMenu).toHaveAttribute("data-pane", "page-tree");
  await expect(blankMenu.getByTestId("blank-menu-new-music")).toBeEnabled();
  await page.screenshot({ path: path.join(evidence, "blank-context-menu-music.png") });
  const createBlank = page.waitForResponse((r) => r.url().includes("/api/page") && r.request().method() === "POST" && r.status() === 201);
  await blankMenu.getByTestId("blank-menu-new-music").click();
  const blank = await createBlank;
  expect(blank.request().postDataJSON()).toMatchObject({ noteType: "music", notebookPath: "Personal Notebook" });
  await expect(page.getByTestId("music-page")).toBeVisible({ timeout: 20000 });
});
