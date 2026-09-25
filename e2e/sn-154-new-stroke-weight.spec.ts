import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const SECTION_PATH = "Personal Notebook/Quick Notes";
const STROKE_SCALE_META_KEY = "smartNotesInkStrokeScale";

interface AnnotationRecord {
  id?: string;
  typeName?: string;
  type?: string;
  meta?: Record<string, unknown>;
}

interface AnnotationSidecar {
  scene?: {
    document?: {
      store?: Record<string, AnnotationRecord>;
    };
  };
}

async function cleanupArtifacts(stamp: string) {
  const sectionDir = path.join(VAULT, "Personal Notebook", "Quick Notes");
  const entries = await fs.readdir(sectionDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((entry) => entry.includes(`sn154-${stamp}`))
      .map((entry) => {
        const base = path.join(sectionDir, entry);
        return Promise.all([
          fs.rm(base, { force: true }),
          fs.rm(base.replace(/\.html$/, ".annotations.json"), { force: true }),
        ]);
      })
  );
}

async function seedTextPage(
  request: import("@playwright/test").APIRequestContext,
  title: string
) {
  const create = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title },
  });
  expect(create.ok()).toBeTruthy();
  const created = (await create.json()) as { page: { path: string } };
  const put = await request.put("/api/page", {
    data: {
      path: created.page.path,
      title,
      content: "<p>SN-154 new-strokes-only weight probe.</p>",
    },
  });
  expect(put.ok()).toBeTruthy();
}

async function openSeededPage(page: Page, title: string) {
  const asideVisible = await page.locator("aside").first().isVisible();
  if (!asideVisible) {
    await page.getByTestId("open-sidebar-btn").click();
  }
  await page.getByTestId("tree").getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 15000 });
}

async function drawStroke(page: Page, yFraction: number) {
  const layer = page.getByTestId("annotation-layer");
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.3;
  const startY = box!.y + box!.height * yFraction;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 30, { steps: 12 });
  await page.mouse.up();
}

async function readSidecar(sidecarPath: string): Promise<AnnotationSidecar> {
  return JSON.parse(await fs.readFile(sidecarPath, "utf8")) as AnnotationSidecar;
}

function drawShapes(payload: AnnotationSidecar): AnnotationRecord[] {
  return Object.values(payload.scene?.document?.store ?? {}).filter(
    (record) => record.typeName === "shape" && record.type === "draw"
  );
}

test("SN-154 desktop: only newly drawn strokes receive the thinner weight marker", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop draw workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn154-${stamp}-stroke-weight`;
  const sidecarPath = path.join(
    VAULT,
    "Personal Notebook",
    "Quick Notes",
    `${noteTitle}.annotations.json`
  );
  await cleanupArtifacts(stamp);

  await seedTextPage(request, noteTitle);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await openSeededPage(page, noteTitle);

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute(
    "data-annotation-ready",
    "true",
    { timeout: 20000 }
  );
  await drawStroke(page, 0.35);
  const firstSave = page.waitForResponse(
    (response) =>
      response.url().includes("/api/annotations") &&
      response.request().method() === "PUT" &&
      response.status() === 200
  );
  await page.getByTestId("ink-exit-draw").click();
  await firstSave;
  await expect.poll(async () => drawShapes(await readSidecar(sidecarPath)).length).toBe(1);

  // Simulate a sidecar written before SN-154 by removing the authoring marker
  // from the first stroke. A full reload then exercises the real hydration path.
  const historicalSidecar = await readSidecar(sidecarPath);
  const [historicalShape] = drawShapes(historicalSidecar);
  expect(historicalShape?.id).toBeTruthy();
  const historicalId = historicalShape.id!;
  if (historicalShape.meta) {
    delete historicalShape.meta[STROKE_SCALE_META_KEY];
  }
  await fs.writeFile(sidecarPath, `${JSON.stringify(historicalSidecar, null, 2)}\n`, "utf8");

  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await openSeededPage(page, noteTitle);
  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute(
    "data-annotation-ready",
    "true",
    { timeout: 20000 }
  );
  await drawStroke(page, 0.55);
  const secondSave = page.waitForResponse(
    (response) =>
      response.url().includes("/api/annotations") &&
      response.request().method() === "PUT" &&
      response.status() === 200
  );
  await page.getByTestId("ink-exit-draw").click();
  await secondSave;

  await expect
    .poll(async () => drawShapes(await readSidecar(sidecarPath)).length, { timeout: 10000 })
    .toBe(2);
  const savedShapes = drawShapes(await readSidecar(sidecarPath));
  const rehydratedHistorical = savedShapes.find((shape) => shape.id === historicalId);
  const newlyDrawn = savedShapes.find((shape) => shape.id !== historicalId);

  expect(rehydratedHistorical?.meta?.[STROKE_SCALE_META_KEY]).toBeUndefined();
  expect(newlyDrawn?.meta?.[STROKE_SCALE_META_KEY]).toBe(0.75);

  await cleanupArtifacts(stamp);
});
