import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureNotebookTreeVisible, closeNotebookTreeSheet } from "./helpers";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const SECTION_PATH = "Personal Notebook/Quick Notes";

async function cleanupArtifacts(stamp: string) {
  const sectionDir = path.join(VAULT, "Personal Notebook", "Quick Notes");
  const entries = await fs.readdir(sectionDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((e) => e.includes(`sn156-${stamp}`))
      .map((e) => {
        const base = path.join(sectionDir, e);
        return Promise.all([
          fs.rm(base, { force: true }),
          fs.rm(base.replace(/\.html$/, ".annotations.json"), { force: true }),
        ]);
      })
  );
}

async function seedLongPage(
  request: import("@playwright/test").APIRequestContext,
  title: string
) {
  const html = Array.from(
    { length: 120 },
    (_, i) => `<p>Paragraph ${i + 1}: ${"lorem ipsum dolor sit amet ".repeat(10)}</p>`
  ).join("");
  const create = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title },
  });
  expect(create.ok()).toBeTruthy();
  const created = (await create.json()) as { page: { path: string } };
  const put = await request.put("/api/page", {
    data: { path: created.page.path, title, content: html },
  });
  expect(put.ok()).toBeTruthy();
  return created.page.path;
}

async function openSeededPage(page: Page, title: string) {
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 15000 });
  await closeNotebookTreeSheet(page);
}

/** Dispatch a raw two-finger vertical swipe via CDP so both touch and pointer
 * streams fire the way real tablet hardware drives them. */
async function twoFingerSwipe(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  dyPerStep: number,
  steps: number
) {
  const session = await page.context().newCDPSession(page);
  const cx1 = box.x + box.width * 0.4;
  const cx2 = box.x + box.width * 0.6;
  let y = box.y + box.height * 0.7;
  const point = (px: number, py: number) => ({ x: Math.round(px), y: Math.round(py) });

  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(cx1, y), point(cx2, y)],
  });
  for (let i = 0; i < steps; i++) {
    y += dyPerStep;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(cx1, y), point(cx2, y)],
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

/** Single-finger diagonal drag — should ink a stroke like a stylus. */
async function oneFingerDraw(
  page: Page,
  box: { x: number; y: number; width: number; height: number }
) {
  const session = await page.context().newCDPSession(page);
  let x = box.x + box.width * 0.3;
  let y = box.y + box.height * 0.35;
  const point = (px: number, py: number) => ({ x: Math.round(px), y: Math.round(py) });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(x, y)] });
  for (let i = 0; i < 10; i++) {
    x += 10;
    y += 6;
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(x, y)] });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

/** Single-finger vertical swipe via CDP (one touch point). */
async function oneFingerSwipe(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  dyPerStep: number,
  steps: number
) {
  const session = await page.context().newCDPSession(page);
  const cx = box.x + box.width * 0.5;
  let y = box.y + box.height * 0.7;
  const point = (px: number, py: number) => ({ x: Math.round(px), y: Math.round(py) });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(cx, y)] });
  for (let i = 0; i < steps; i++) {
    y += dyPerStep;
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(cx, y)] });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

/** Latch "pen mode" by firing a synthetic stylus contact on the annotation
 * host, the way an Android tablet stylus reports `pointerType: "pen"`. */
async function tapStylus(page: Page) {
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="annotation-layer"]');
    if (!host) throw new Error("annotation host not found");
    const opts = { pointerType: "pen", bubbles: true, cancelable: true } as PointerEventInit;
    host.dispatchEvent(new PointerEvent("pointerdown", opts));
    host.dispatchEvent(new PointerEvent("pointerup", opts));
  });
}

async function readShapeCount(sidecarPath: string): Promise<number> {
  const raw = await fs.readFile(sidecarPath, "utf8").catch(() => "");
  if (!raw) return 0;
  const payload = JSON.parse(raw) as {
    scene?: { document?: { store?: Record<string, { typeName?: string }> } };
  };
  const store = payload.scene?.document?.store ?? {};
  return Object.values(store).filter((r) => r?.typeName === "shape").length;
}

test("SN-156 tablet: two-finger swipe scrolls the page in draw mode without inking", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Touch/tablet workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn156-${stamp}-scroll`;
  const sidecarPath = path.join(VAULT, "Personal Notebook", "Quick Notes", `${noteTitle}.annotations.json`);
  await cleanupArtifacts(stamp);

  await seedLongPage(request, noteTitle);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await openSeededPage(page, noteTitle);

  await page.getByTestId("toolbar-annotate-mobile").click();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-mode", "draw");
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-ready", "true", {
    timeout: 20000,
  });

  const scrollTopBefore = await page.evaluate(
    () => (document.querySelector(".editor-scroll-area") as HTMLElement | null)?.scrollTop ?? 0
  );

  const layer = page.getByTestId("annotation-layer");
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  // Fingers move up -> page scrolls down.
  await twoFingerSwipe(page, box!, -30, 8);

  await expect
    .poll(async () =>
      page.evaluate(
        () => (document.querySelector(".editor-scroll-area") as HTMLElement | null)?.scrollTop ?? 0
      )
    )
    .toBeGreaterThan(scrollTopBefore + 50);

  // AC: two-finger gesture must not leave ink behind.
  expect(await readShapeCount(sidecarPath)).toBe(0);

  // AC: single finger still draws ink strokes as before.
  const layerBox = await layer.boundingBox();
  await oneFingerDraw(page, layerBox!);
  await page.getByTestId("ink-exit-draw-mobile").click();
  await page.waitForResponse(
    (r) => r.url().includes("/api/annotations") && r.request().method() === "PUT" && r.status() === 200
  );
  await expect.poll(async () => readShapeCount(sidecarPath), { timeout: 10000 }).toBeGreaterThan(0);

  await cleanupArtifacts(stamp);
});

test("SN-156 tablet: after a stylus is seen, a single finger pans instead of inking", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Touch/tablet workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn156-${stamp}-penmode`;
  const sidecarPath = path.join(VAULT, "Personal Notebook", "Quick Notes", `${noteTitle}.annotations.json`);
  await cleanupArtifacts(stamp);

  await seedLongPage(request, noteTitle);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await openSeededPage(page, noteTitle);

  await page.getByTestId("toolbar-annotate-mobile").click();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-mode", "draw");
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-ready", "true", {
    timeout: 20000,
  });

  const layer = page.getByTestId("annotation-layer");
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();

  const scrollTopBefore = await page.evaluate(
    () => (document.querySelector(".editor-scroll-area") as HTMLElement | null)?.scrollTop ?? 0
  );

  // A stylus touches down once — pen mode latches on for this draw-mode entry.
  await tapStylus(page);

  // Now a lone finger must PAN (not draw): page scrolls, no ink is left.
  await oneFingerSwipe(page, box!, -30, 8);

  await expect
    .poll(async () =>
      page.evaluate(
        () => (document.querySelector(".editor-scroll-area") as HTMLElement | null)?.scrollTop ?? 0
      )
    )
    .toBeGreaterThan(scrollTopBefore + 50);

  // AC: lone finger in pen mode leaves no ink.
  expect(await readShapeCount(sidecarPath)).toBe(0);

  await cleanupArtifacts(stamp);
});
