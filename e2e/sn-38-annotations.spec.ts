import { test, expect, type Page } from "@playwright/test";
import { annotationSuffix, readAnnotationSidecar, smartInk, useAnnotationInkEngine } from "./annotation-ink-parity";
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { apiCreatePage } from "./helpers";

useAnnotationInkEngine();

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const SECTION_PATH = "Personal Notebook/Quick Notes";

test.describe.configure({ mode: "serial" });

async function cleanupArtifacts(stamp: string) {
  const sectionDir = path.join(VAULT, "Personal Notebook", "Quick Notes");
  const entries = await fs.readdir(sectionDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((e) => e.includes(`sn38-${stamp}`))
      .map((e) => {
        const base = path.join(sectionDir, e);
        return Promise.all([
          fs.rm(base, { force: true }),
          fs.rm(base.replace(/\.html$/, annotationSuffix), { force: true }),
        ]);
      })
  );
}

async function openTextFixture(page: Page, title: string) {
  const created = await apiCreatePage(page.request, {
    notebookPath: "Personal Notebook",
    sectionPath: SECTION_PATH,
    title,
  });
  await page.goto(`/?page=${encodeURIComponent(created.path)}`);
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute(
    "data-annotation-loaded-path", created.path, { timeout: 20000 }
  );
}

async function drawStrokeOnAnnotationLayer(page: Page) {
  const layer = page.getByTestId("annotation-layer");
  await expect(layer).toBeVisible();
  await expect(layer).toHaveAttribute("data-annotation-ready", "true");

  const penTool = page.getByTestId("ink-tool-pen");
  if (await penTool.count()) {
    await penTool.click();
  } else {
    await page.keyboard.press("d");
  }

  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.35;
  const startY = box!.y + box!.height * 0.45;
  const endX = box!.x + box!.width * 0.65;
  const endY = box!.y + box!.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();
}


async function readAnnotationShapeColors(sidecarPath: string) {
  return (await readAnnotationSidecar(sidecarPath)).strokes.map(({ color }) => color).sort();
}
test("SN-38 desktop evidence: edit overlay and draw toolbar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop evidence only");
  const stamp = String(Date.now());
  const noteTitle = `sn38-${stamp}-annotations`;
  await cleanupArtifacts(stamp);

  await openTextFixture(page, noteTitle);

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("ink-format-bar")).toBeVisible();
  await expect(page.getByTestId("ink-tool-pen")).toBeVisible();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-draw-mode.png"), fullPage: true });

  await page.getByTestId("ink-exit-draw").click();
  await expect(page.getByTestId("format-bar")).toBeVisible();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-mode", "edit");
  await page.screenshot({ path: testInfo.outputPath("desktop-edit-overlay.png"), fullPage: true });

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("ink-format-bar")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-toolbar-swap.png"), fullPage: true });
});

test("SN-38 mobile evidence: draw mode toolbar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile evidence only");
  const stamp = String(Date.now());
  const noteTitle = `sn38-${stamp}-mobile`;
  await cleanupArtifacts(stamp);

  await openTextFixture(page, noteTitle);

  await page.getByTestId("toolbar-annotate-mobile").click();
  await expect(page.getByTestId("ink-format-bar-mobile")).toBeVisible();
  await expect(page.getByTestId("ink-tool-pen-mobile")).toBeVisible();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-draw-mode.png"), fullPage: true });

  await page.getByTestId("ink-exit-draw-mobile").click();
  await expect(page.getByTestId("format-bar-mobile")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-edit-overlay.png"), fullPage: true });
});

test("SN-38 desktop: ink color picker updates active swatch and stroke color", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn38-${stamp}-color`;
  await cleanupArtifacts(stamp);

  await openTextFixture(page, noteTitle);

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("ink-format-bar")).toBeVisible();

  const redSwatch = page.getByTestId("ink-color-red");
  await expect(page.getByTestId("ink-color-black")).toHaveAttribute("aria-pressed", "true");
  await redSwatch.click();
  await expect(redSwatch).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ink-color-black")).toHaveAttribute("aria-pressed", "false");

  const layer = page.getByTestId("annotation-layer");
  await expect(layer).toHaveAttribute("data-annotation-ready", "true");
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.35;
  const startY = box!.y + box!.height * 0.45;
  const endX = box!.x + box!.width * 0.65;
  const endY = box!.y + box!.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();

  await page.waitForResponse(
    (r) => r.url().includes("/api/annotations") && r.request().method() === "PUT" && r.status() === 200,
    { timeout: 15000 }
  );

  const sidecarPath = path.join(VAULT, "Personal Notebook", "Quick Notes", `${noteTitle}${annotationSuffix}`);
  await expect.poll(async () => readAnnotationShapeColors(sidecarPath)).toEqual(["red"]);
});

test("SN-38 desktop: ink stays visible in edit mode and persists to sidecar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn38-${stamp}-persist`;
  await cleanupArtifacts(stamp);

  await openTextFixture(page, noteTitle);

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-mode", "draw");
  await drawStrokeOnAnnotationLayer(page);

  const saveResponse = page.waitForResponse(
    (r) => r.url().includes("/api/annotations") && r.request().method() === "PUT" && r.status() === 200
  );
  await page.getByTestId("ink-exit-draw").click();
  await saveResponse;

  const layer = page.getByTestId("annotation-layer");
  await expect(layer).toHaveAttribute("data-annotation-mode", "edit");
  await expect(layer).toHaveAttribute("data-annotation-visible", "true");

  const sectionDir = path.join(VAULT, "Personal Notebook", "Quick Notes");
  const sidecarPath = path.join(sectionDir, `${noteTitle}${annotationSuffix}`);
  await expect.poll(async () => (await readAnnotationSidecar(sidecarPath)).strokes.length).toBe(1);

  await page.reload();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-visible", "true");
});

test("SN-51 desktop: draw mode keyboard undo and redo persist in order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn51-${stamp}-undo`;
  await cleanupArtifacts(stamp);

  await openTextFixture(page, noteTitle);

  const sectionDir = path.join(VAULT, "Personal Notebook", "Quick Notes");
  const sidecarPath = path.join(sectionDir, `${noteTitle}${annotationSuffix}`);

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("ink-format-bar")).toBeVisible();

  await drawStrokeOnAnnotationLayer(page);
  await page.getByTestId("ink-color-red").click();
  await drawStrokeOnAnnotationLayer(page);
  await page.getByTestId("ink-color-green").click();
  await drawStrokeOnAnnotationLayer(page);

  await page.keyboard.press("Control+Z");
  await page.getByTestId("ink-exit-draw").click();
  await expect
    .poll(async () => readAnnotationShapeColors(sidecarPath))
    .toEqual(["black", "red"]);

  await page.getByTestId("toolbar-annotate").click();
  await page.keyboard.press("Control+Z");
  await page.getByTestId("ink-exit-draw").click();
  await expect
    .poll(async () => readAnnotationShapeColors(sidecarPath))
    .toEqual(["black"]);

  await page.getByTestId("toolbar-annotate").click();
  await page.keyboard.press("Control+Shift+Z");
  await page.getByTestId("ink-exit-draw").click();
  await expect
    .poll(async () => readAnnotationShapeColors(sidecarPath))
    .toEqual(["black", "red"]);
});

test("SN-38 desktop: draw mode keeps live editor in the same frame", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn38-${stamp}-overlay`;
  await cleanupArtifacts(stamp);

  await openTextFixture(page, noteTitle);

  await page.getByTestId("editor-surface").locator(".ProseMirror").click();
  await page.keyboard.type(" Overlay check body text.");

  await page.getByTestId("toolbar-annotate").click();
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Overlay check body text");

  const editorBox = await editor.boundingBox();
  const layerBox = await page.getByTestId("annotation-layer").boundingBox();
  const frameBox = await page.getByTestId("editor-content-frame").boundingBox();
  const scrollBox = await page.locator(".editor-scroll-area").boundingBox();
  expect(editorBox).not.toBeNull();
  expect(layerBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  expect(scrollBox).not.toBeNull();
  // Ink layer is viewport-clipped (SN-40): sticky inside the content frame, not full document height.
  expect(Math.abs(scrollBox!.x - layerBox!.x)).toBeLessThan(36);
  expect(Math.abs(scrollBox!.y - layerBox!.y)).toBeLessThan(36);
  expect(Math.abs(scrollBox!.width - layerBox!.width)).toBeLessThan(72);
  expect(layerBox!.height).toBeLessThanOrEqual(scrollBox!.height + 4);
  expect(layerBox!.height).toBeGreaterThan(scrollBox!.height * 0.5);
  // Live editor stays visible inside the frame.
  expect(frameBox!.x).toBeLessThanOrEqual(editorBox!.x + 2);
  expect(frameBox!.y).toBeLessThanOrEqual(editorBox!.y + 2);
});

test("SN-424: read-only captures paint Smart Notes ink below the page content", async ({ request }, testInfo) => {
  test.skip(!smartInk || testInfo.project.name !== "desktop", "Smart Notes capture routes");
  test.setTimeout(240_000);

  for (const noteType of ["text", "design"] as const) {
    const created = await request.post("/api/page", {
      data: { sectionPath: SECTION_PATH, title: `SN-424 ${noteType} capture ${Date.now()}`, noteType },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { page: fixture } = await created.json() as { page: { path: string } };
    const saved = await request.put("/api/annotations", {
      data: {
        path: fixture.path,
        engine: "smart-notes",
        drawableBottom: 2000,
        scene: {
          version: 2,
          strokes: [{
            id: "deep-red-ink", points: [[120, 1320, 0.75], [220, 1340, 0.75]],
            color: "red", size: "xl", createdAt: 1,
          }],
        },
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);

    const capture = noteType === "text"
      ? await request.get(`/api/agent/render?engine=smart-notes&path=${encodeURIComponent(fixture.path)}`, { timeout: 100_000 })
      : await request.post("/api/agent/vault", {
          data: { tool: "ui_render", args: { path: fixture.path, engine: "smart-notes" } },
          timeout: 100_000,
        });
    expect(capture.ok(), await capture.text()).toBe(true);
    const payload = await capture.json();
    const render = noteType === "text" ? payload : payload.result.data;
    const image = await request.get(render.vaultUrl);
    expect(image.ok()).toBe(true);
    const png = PNG.sync.read(await image.body());
    const bottomHalf = png.data.subarray(Math.floor(png.height / 2) * png.width * 4);
    expect(bottomHalf.some((red, index) =>
      index % 4 === 0 && red > 175 && bottomHalf[index + 1] < 75 && bottomHalf[index + 2] < 75
    ), `${noteType} capture should include the red stroke below the content`).toBe(true);
  }
});
