import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const SECTION_PATH = "Personal Notebook/Quick Notes";

test.describe.configure({ mode: "serial" });

async function cleanupArtifacts(stamp: string) {
  const sectionDir = path.join(VAULT, "Personal Notebook", "Quick Notes");
  const entries = await fs.readdir(sectionDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((e) => e.includes(`sn123-${stamp}`))
      .map((e) => {
        const base = path.join(sectionDir, e);
        return Promise.all([
          fs.rm(base, { force: true }),
          fs.rm(base.replace(/\.html$/, ".annotations.json"), { force: true }),
        ]);
      })
  );
}

async function createShortPageViaApi(page: Page, title: string) {
  const pagePath = `${SECTION_PATH}/${title}.html`;
  const createResponse = await page.request.post("/api/page", {
    data: { sectionPath: SECTION_PATH, title },
  });
  expect(createResponse.status()).toBe(201);

  const writeResponse = await page.request.put("/api/page", {
    data: {
      path: pagePath,
      title,
      content: "<p>Short note for margin ink.</p>",
    },
  });
  expect(writeResponse.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("tree").getByText(title).first().click();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".ProseMirror")).toContainText("Short note for margin ink");
  return { pagePath, title };
}

async function getFrameMetrics(page: Page) {
  return page.evaluate(() => {
    const scrollArea = document.querySelector(".editor-scroll-area") as HTMLElement | null;
    const frame = document.querySelector('[data-testid="editor-content-frame"]') as HTMLElement | null;
    const prose = document.querySelector(".ProseMirror") as HTMLElement | null;
    const clip = document.querySelector("[data-print-ink-clip]") as HTMLElement | null;
    const layer = document.querySelector('[data-testid="annotation-layer"]') as HTMLElement | null;
    if (!scrollArea || !frame) return null;
    return {
      scrollTop: scrollArea.scrollTop,
      scrollHeight: scrollArea.scrollHeight,
      clientHeight: scrollArea.clientHeight,
      frameHeight: frame.offsetHeight,
      textHeight: prose?.scrollHeight ?? 0,
      clipHeight: clip?.offsetHeight ?? 0,
      layerHeight: layer?.offsetHeight ?? 0,
      editorZoom: frame.getAttribute("data-editor-zoom"),
    };
  });
}

async function drawHorizontalStroke(page: Page, yFraction: number) {
  const layer = page.getByTestId("annotation-layer");
  await expect(layer).toBeVisible();
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.2;
  const endX = box!.x + box!.width * 0.8;
  const y = box!.y + box!.height * yFraction;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 16 });
  await page.mouse.up();
}

async function readSidecarMetrics(sidecarPath: string) {
  const raw = await fs.readFile(sidecarPath, "utf8");
  const payload = JSON.parse(raw) as {
    drawableBottom?: number;
    scene?: { document?: { store?: Record<string, { typeName?: string; y?: number }> } };
  };
  const store = payload.scene?.document?.store ?? {};
  const shapeYs = Object.values(store)
    .filter((r) => r?.typeName === "shape" && typeof r.y === "number")
    .map((r) => r.y as number);
  return {
    drawableBottom: payload.drawableBottom,
    minShapeY: shapeYs.length ? Math.min(...shapeYs) : null,
    shapeCount: shapeYs.length,
  };
}

test("SN-123 desktop: short page offers scrollable margin below text", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  const stamp = String(Date.now());
  const title = `sn123-${stamp}-margin-scroll`;
  await cleanupArtifacts(stamp);
  await createShortPageViaApi(page, title);

  const beforeDraw = await getFrameMetrics(page);
  expect(beforeDraw).not.toBeNull();
  expect(beforeDraw!.frameHeight).toBeGreaterThan(beforeDraw!.textHeight + 400);
  expect(beforeDraw!.scrollHeight).toBeGreaterThan(beforeDraw!.clientHeight + 200);
});

test("SN-123 desktop: draw in margin below text persists and extends canvas", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  test.setTimeout(120_000);
  const stamp = String(Date.now());
  const title = `sn123-${stamp}-margin-draw`;
  await cleanupArtifacts(stamp);
  const { pagePath } = await createShortPageViaApi(page, title);
  const sidecarPath = path.join(VAULT, ...pagePath.split("/").slice(0, -1), `${title}.annotations.json`);

  const beforeScroll = await getFrameMetrics(page);
  const targetScroll = Math.min(
    Math.max(beforeScroll!.scrollHeight - beforeScroll!.clientHeight - 120, 0),
    Math.floor(beforeScroll!.frameHeight * 0.45)
  );
  await page.evaluate((scrollTo) => {
    const el = document.querySelector(".editor-scroll-area") as HTMLElement | null;
    if (!el) return;
    el.scrollTop = scrollTo;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, targetScroll);

  await page.getByTestId("toolbar-annotate").click();
  const layer = page.getByTestId("annotation-layer");
  await expect(layer).toHaveAttribute("data-annotation-mode", "draw");
  await expect(layer).toHaveAttribute("data-annotation-ready", "true", { timeout: 20000 });

  const inDraw = await getFrameMetrics(page);
  expect(inDraw!.layerHeight).toBeLessThanOrEqual(inDraw!.clientHeight + 4);
  expect(inDraw!.layerHeight).toBeGreaterThan(inDraw!.clientHeight * 0.5);

  await drawHorizontalStroke(page, 0.55);

  const saveResponse = page.waitForResponse(
    (r) => r.url().includes("/api/annotations") && r.request().method() === "PUT" && r.status() === 200,
    { timeout: 20000 }
  );
  await page.getByTestId("ink-exit-draw").click();
  await saveResponse;

  await expect
    .poll(async () => readSidecarMetrics(sidecarPath).then((m) => m.shapeCount))
    .toBeGreaterThanOrEqual(1);

  const afterDraw = await readSidecarMetrics(sidecarPath);
  expect(afterDraw.minShapeY).not.toBeNull();
  expect(afterDraw.minShapeY!).toBeGreaterThan(beforeScroll!.textHeight * 0.5);
  expect(afterDraw.drawableBottom).toBeGreaterThan(afterDraw.minShapeY!);

  const grown = await getFrameMetrics(page);
  expect(grown!.scrollHeight).toBeGreaterThanOrEqual(beforeScroll!.scrollHeight);

  await page.reload();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 20000 });
  const layerAfterReload = page.getByTestId("annotation-layer");
  await expect(layerAfterReload).toHaveAttribute("data-annotation-ready", "true", { timeout: 30000 });
  await expect(layerAfterReload).toHaveAttribute("data-annotation-visible", "true");

  const reloaded = await readSidecarMetrics(sidecarPath);
  expect(reloaded.shapeCount).toBeGreaterThanOrEqual(1);
  expect(reloaded.drawableBottom).toBeGreaterThan(beforeScroll!.textHeight);
});

test("SN-123 desktop: workspace zoom in draw mode keeps ink layer usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  test.setTimeout(120_000);
  const stamp = String(Date.now());
  const title = `sn123-${stamp}-zoom-draw`;
  await cleanupArtifacts(stamp);
  const { pagePath } = await createShortPageViaApi(page, title);
  const sidecarPath = path.join(VAULT, ...pagePath.split("/").slice(0, -1), `${title}.annotations.json`);

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-mode", "draw");
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-ready", "true", {
    timeout: 20000,
  });

  const scrollArea = page.locator(".editor-scroll-area");
  await scrollArea.hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -400);
  await page.keyboard.up("Control");

  await expect
    .poll(async () => getFrameMetrics(page).then((m) => m?.editorZoom ?? "1"))
    .not.toBe("1");

  const zoomed = await getFrameMetrics(page);
  expect(zoomed!.clipHeight).toBeGreaterThan(0);
  expect(zoomed!.layerHeight).toBeLessThanOrEqual(zoomed!.clipHeight + 2);

  await drawHorizontalStroke(page, 0.5);

  const saveResponse = page.waitForResponse(
    (r) => r.url().includes("/api/annotations") && r.request().method() === "PUT" && r.status() === 200,
    { timeout: 20000 }
  );
  await page.getByTestId("ink-exit-draw").click();
  await saveResponse;

  await expect
    .poll(async () => readSidecarMetrics(sidecarPath).then((m) => m.shapeCount))
    .toBeGreaterThanOrEqual(1);
});
