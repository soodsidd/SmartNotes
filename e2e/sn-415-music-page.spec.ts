import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const evidence = path.resolve(__dirname, "evidence", "SN-415");

test("SN-418: large touch targets flip pages in fullscreen Play mode and keep fresh ink", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const paths: string[] = [];
  try {
    const response = await context.request.post("/api/page", {
      data: { sectionPath: "Personal Notebook/Quick Notes", title: `sn418-song-${Date.now()}`, noteType: "music" },
    });
    expect(response.status()).toBe(201);
    const { page: created } = await response.json() as { page: { path: string } };
    paths.push(created.path);
    await page.goto(`/?page=${encodeURIComponent(created.path)}`);
    const music = page.getByTestId("music-page");
    const enterPlay = music.getByRole("button", { name: "Play mode", exact: true });
    const exitPlay = music.getByRole("button", { name: "Exit play mode" });
    const turns = music.getByRole("navigation", { name: "Turn music page" });
    const previous = turns.getByRole("button", { name: "Previous page" });
    const next = turns.getByRole("button", { name: "Next page" });
    await enterPlay.tap();
    await expect(turns).toHaveCount(0);
    await exitPlay.tap();

    for (const pageNumber of [2, 3]) {
      const pending = page.waitForResponse((r) => r.url().endsWith("/api/page") && r.request().method() === "POST" && r.status() === 201);
      await music.getByRole("button", { name: "Add next page" }).tap();
      const { page: added } = await (await pending).json() as { page: { path: string } };
      paths.push(added.path);
      await expect(music.getByLabel(`Page ${pageNumber} of ${pageNumber}`)).toBeVisible();
    }

    const canvas = music.locator(".tl-canvas");
    await expect(canvas).toBeVisible();
    const paper = (await canvas.boundingBox())!;
    await page.mouse.move(paper.x + paper.width / 3, paper.y + paper.height / 3);
    await page.mouse.down();
    await page.mouse.move(paper.x + paper.width / 2, paper.y + paper.height / 3, { steps: 6 });
    await page.mouse.up();
    const ink = music.locator('.tl-shape[data-shape-type="draw"]');
    await expect(ink).toHaveCount(1);

    await enterPlay.tap();
    await expect(music).toHaveClass(/music-page--fullscreen/);
    await expect(music.getByRole("toolbar", { name: "Music ink tools" })).toHaveCount(0);
    await expect(next).toBeDisabled();
    const target = (await previous.boundingBox())!;
    expect(target.width).toBeGreaterThan(250);
    expect(target.height).toBeGreaterThanOrEqual(56);
    await page.mouse.move(target.x + 15, target.y + 20);
    await page.mouse.down();
    await page.mouse.move(target.x + 100, target.y + 20, { steps: 6 });
    await page.mouse.up();
    await expect(music.getByLabel("Page 3 of 3")).toBeVisible();

    for (const [button, pageNumber] of [[previous, 2], [previous, 1], [next, 2], [next, 3]] as const) {
      await button.tap();
      await expect(music.getByLabel(`Page ${pageNumber} of 3`)).toBeVisible();
      await expect(music).toHaveClass(/music-page--fullscreen/);
      if (pageNumber === 1) await expect(previous).toBeDisabled();
    }
    await expect(ink).toBeVisible();
    await exitPlay.tap();
    await expect(music.getByRole("toolbar", { name: "Music ink tools" })).toBeVisible();
    await expect(turns).toHaveCount(0);
  } finally {
    for (const pagePath of paths.reverse()) await context.request.delete(`/api/page?path=${encodeURIComponent(pagePath)}`);
    await context.close();
  }
});

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

test("SN-417: continuation page is added immediately after current, prev/next navigates, and ink persists independently after reload", async ({ page }) => {
  test.setTimeout(180_000);
  await fs.mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  // Create the first music page.
  const title = `sn417-song-${Date.now()}`;
  const r1 = await page.request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title, noteType: "music" },
  });
  expect(r1.status()).toBe(201);
  const { page: page1 } = await r1.json() as { page: { path: string } };

  // Open the first page.
  await page.goto(`/?page=${encodeURIComponent(page1.path)}`);
  const music = page.getByTestId("music-page");
  await expect(music).toBeVisible({ timeout: 20_000 });

  // Add a continuation from the music page view.
  const addBtn = music.getByTestId("music-add-page");
  await expect(addBtn).toBeVisible({ timeout: 10_000 });
  const page2Response = page.waitForResponse(
    (r) => r.url().includes("/api/page") && r.request().method() === "POST" && r.status() === 201
  );
  await addBtn.click();
  const page2Created = await page2Response;
  const { page: page2 } = await page2Created.json() as { page: { path: string; title: string } };

  // Should auto-navigate to the new page.
  await expect(page.getByTestId("music-page")).toBeVisible({ timeout: 20_000 });

  // Page 2 should be titled as a continuation.
  expect(page2.title).toMatch(/page 2/i);

  // Verify prev/next nav appears on page 2.
  const prevBtn = music.getByTestId("music-prev-page");
  const nextBtn = music.getByTestId("music-next-page");
  await expect(prevBtn).toBeVisible({ timeout: 10_000 });
  await expect(nextBtn).toBeVisible({ timeout: 5_000 });
  await expect(prevBtn).not.toBeDisabled();
  await expect(nextBtn).toBeDisabled();

  // Draw a stroke on page 2.
  await expect(music.locator(".tl-canvas")).toBeVisible({ timeout: 15_000 });
  const paperBox2 = (await music.locator(".music-page__paper").boundingBox())!;
  await page.mouse.move(paperBox2.x + paperBox2.width * 0.4, paperBox2.y + paperBox2.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(paperBox2.x + paperBox2.width * 0.6, paperBox2.y + paperBox2.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => {
    const ink = await page.request.get(`/api/ink?path=${encodeURIComponent(page2.path)}`);
    const data = await ink.json() as { scene?: { document?: { store?: Record<string, unknown> } } };
    return Object.keys(data.scene?.document?.store ?? {}).filter((k) => k.startsWith("shape:")).length;
  }, { timeout: 10_000 }).toBeGreaterThan(0);

  // Navigate back to page 1 via Prev button.
  await prevBtn.click();
  await expect(page.getByTestId("music-page")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".music-page__name")).toHaveText(title, { timeout: 10_000 });

  // Verify page 1's ink sidecar has no shapes (ink is independent).
  const ink1 = await page.request.get(`/api/ink?path=${encodeURIComponent(page1.path)}`);
  const data1 = await ink1.json() as { scene?: { document?: { store?: Record<string, unknown> } } };
  const page1Shapes = Object.keys(data1.scene?.document?.store ?? {}).filter((k) => k.startsWith("shape:")).length;
  expect(page1Shapes).toBe(0);

  // Page 1 shows no Prev button and an enabled Next button.
  const prevOnPage1 = music.getByTestId("music-prev-page");
  const nextOnPage1 = music.getByTestId("music-next-page");
  await expect(prevOnPage1).toBeDisabled();
  await expect(nextOnPage1).not.toBeDisabled();

  // After reload, page 2 ink persists.
  await page.goto(`/?page=${encodeURIComponent(page2.path)}`);
  await expect(page.getByTestId("music-page")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".music-page__ink .tl-shape").first()).toBeVisible({ timeout: 15_000 });

  // Clean up.
  await page.request.delete(`/api/page?path=${encodeURIComponent(page2.path)}`);
  await page.request.delete(`/api/page?path=${encodeURIComponent(page1.path)}`);
});

test("page ellipsis converts text and music, and Add Page chevron chooses a type", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const title = `sn415-convert-${Date.now()}`;
  const response = await page.request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: "Personal Notebook/Quick Notes", title },
  });
  expect(response.status()).toBe(201);
  const { page: created } = await response.json() as { page: { path: string } };
  let addedPath: string | null = null;
  try {
    await page.goto(`/?page=${encodeURIComponent(created.path)}`);
    const row = page.getByTestId(`page-${created.path}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.locator("button[data-page-menu]").click();
    const convertedToMusic = page.waitForResponse((result) => result.url().endsWith("/api/page") && result.request().method() === "PATCH" && result.request().postDataJSON()?.action === "convertType");
    await page.getByTestId(`page-convert-${created.path}`).click();
    expect((await convertedToMusic).request().postDataJSON().noteType).toBe("music");
    await expect(page.getByTestId("music-page")).toBeVisible({ timeout: 20_000 });

    await row.locator("button[data-page-menu]").click();
    const convertedToText = page.waitForResponse((result) => result.url().endsWith("/api/page") && result.request().method() === "PATCH" && result.request().postDataJSON()?.action === "convertType");
    await page.getByTestId(`page-convert-${created.path}`).click();
    expect((await convertedToText).request().postDataJSON().noteType).toBe("text");
    await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("page-pane-add-type").click();
    const createdMusic = page.waitForResponse((result) => result.url().endsWith("/api/page") && result.request().method() === "POST" && result.request().postDataJSON()?.noteType === "music");
    await page.getByRole("menuitem", { name: "Music page" }).click();
    const added = await createdMusic;
    expect(added.status()).toBe(201);
    addedPath = ((await added.json()) as { page: { path: string } }).page.path;
    await expect(page.getByTestId("music-page")).toBeVisible({ timeout: 20_000 });
  } finally {
    if (addedPath) await page.request.delete(`/api/page?path=${encodeURIComponent(addedPath)}`);
    await page.request.delete(`/api/page?path=${encodeURIComponent(created.path)}`);
  }
});
