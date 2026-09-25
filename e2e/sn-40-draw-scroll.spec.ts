import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const SECTION_PATH = "Personal Notebook/Quick Notes";

async function cleanupArtifacts(stamp: string) {
  const sectionDir = path.join(VAULT, "Personal Notebook", "Quick Notes");
  const entries = await fs.readdir(sectionDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((e) => e.includes(`sn40-${stamp}`))
      .map((e) => {
        const base = path.join(sectionDir, e);
        return Promise.all([
          fs.rm(base, { force: true }),
          fs.rm(base.replace(/\.html$/, ".annotations.json"), { force: true }),
        ]);
      })
  );
}

async function seedLongTextPage(
  request: import("@playwright/test").APIRequestContext,
  title: string
) {
  const html = Array.from(
    { length: 100 },
    (_, i) => `<p>Paragraph ${i + 1}: ${"lorem ipsum dolor ".repeat(12)}</p>`
  ).join("");
  const create = await request.post("/api/page", {
    data: {
      notebookPath: "Personal Notebook",
      sectionPath: SECTION_PATH,
      title,
    },
  });
  expect(create.ok()).toBeTruthy();
  const created = (await create.json()) as { page: { path: string } };
  const put = await request.put("/api/page", {
    data: { path: created.page.path, title, content: html },
  });
  expect(put.ok()).toBeTruthy();
  const absolutePath = path.join(VAULT, ...created.page.path.split("/"));
  expect(await fs.readFile(absolutePath, "utf8")).toContain("Paragraph 100");
  return created.page.path;
}

async function openSeededPage(page: Page, title: string) {
  const asideVisible = await page.locator("aside").first().isVisible();
  if (!asideVisible) {
    await page.getByTestId("open-sidebar-btn").click();
  }
  await page.getByTestId("tree").getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".ProseMirror")).toContainText("Paragraph 100", { timeout: 15000 });
}

async function getScrollMetrics(page: Page) {
  return page.evaluate(() => {
    const scrollArea = document.querySelector(".editor-scroll-area") as HTMLElement | null;
    const layer = document.querySelector('[data-testid="annotation-layer"]') as HTMLElement | null;
    const frame = document.querySelector('[data-testid="editor-content-frame"]') as HTMLElement | null;
    if (!scrollArea || !layer) return null;
    const scrollBox = scrollArea.getBoundingClientRect();
    const layerBox = layer.getBoundingClientRect();
    const frameBox = frame?.getBoundingClientRect() ?? null;
    return {
      scrollTop: scrollArea.scrollTop,
      scrollHeight: scrollArea.scrollHeight,
      clientHeight: scrollArea.clientHeight,
      layerHeight: layerBox.height,
      layerTop: layerBox.top - scrollBox.top,
      frameHeight: frameBox?.height ?? 0,
      cameraScrollTop: layer.getAttribute("data-annotation-camera-scroll-top"),
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

async function readShapePageYs(sidecarPath: string): Promise<number[]> {
  const raw = await fs.readFile(sidecarPath, "utf8");
  const payload = JSON.parse(raw) as {
    scene?: { document?: { store?: Record<string, { typeName?: string; y?: number }> } };
  };
  const store = payload.scene?.document?.store ?? {};
  return Object.values(store)
    .filter((r) => r?.typeName === "shape" && typeof r.y === "number")
    .map((r) => r.y as number);
}

test.describe.configure({ mode: "serial" });

test("SN-40 desktop: draw after scroll aligns ink to viewport, not page top", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn40-${stamp}-scroll-draw`;
  await cleanupArtifacts(stamp);

  // Seed via API before the browser attaches so autosave cannot overwrite the body.
  await seedLongTextPage(request, noteTitle);

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await openSeededPage(page, noteTitle);

  const targetScroll = await page.evaluate(() => {
    const el = document.querySelector(".editor-scroll-area") as HTMLElement | null;
    if (!el) return 0;
    const target = Math.floor(el.scrollHeight * 0.55);
    el.scrollTop = target;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    return el.scrollTop;
  });
  expect(targetScroll).toBeGreaterThan(400);

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-mode", "draw");
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-ready", "true", {
    timeout: 20000,
  });

  let metrics = await getScrollMetrics(page);
  expect(metrics).not.toBeNull();
  expect(metrics!.layerHeight).toBeLessThan(metrics!.frameHeight * 0.5);
  expect(metrics!.layerHeight).toBeLessThanOrEqual(metrics!.clientHeight + 4);

  await expect
    .poll(async () => {
      const m = await getScrollMetrics(page);
      const raw = m?.cameraScrollTop;
      return raw != null ? Number(raw) : (m?.scrollTop ?? 0);
    })
    .toBeGreaterThan(400);

  const sidecarPath = path.join(VAULT, "Personal Notebook", "Quick Notes", `${noteTitle}.annotations.json`);
  const saveResponse = page.waitForResponse(
    (r) => r.url().includes("/api/annotations") && r.request().method() === "PUT" && r.status() === 200,
    { timeout: 20000 }
  );
  await drawHorizontalStroke(page, 0.5);
  await saveResponse;
  await expect
    .poll(async () => {
      try {
        return (await readShapePageYs(sidecarPath)).length;
      } catch {
        return 0;
      }
    }, { timeout: 10000 })
    .toBeGreaterThanOrEqual(1);
  const shapeYs = await readShapePageYs(sidecarPath);
  const minY = Math.min(...shapeYs);
  expect(minY).toBeGreaterThan(targetScroll * 0.35);
});

test("SN-40 desktop: wheel scroll works while in draw mode", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn40-${stamp}-wheel`;
  await cleanupArtifacts(stamp);

  await seedLongTextPage(request, noteTitle);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await openSeededPage(page, noteTitle);

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-mode", "draw");

  const before = await getScrollMetrics(page);
  const layer = page.getByTestId("annotation-layer");
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, 900);

  await expect
    .poll(async () => {
      const m = await getScrollMetrics(page);
      return m?.scrollTop ?? 0;
    })
    .toBeGreaterThan((before?.scrollTop ?? 0) + 200);
});
