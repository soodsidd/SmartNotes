import { expect, test, type Page } from "@playwright/test";
import {
  readNoteInk,
  renderedStrokeSelector,
  smartInk,
  standaloneCanvasSelector,
  useAnnotationInkEngine,
} from "./annotation-ink-parity";

useAnnotationInkEngine();

const SECTION_PATH = "Personal Notebook/Quick Notes";

async function createInkNote(page: Page, title: string) {
  const response = await page.request.post("/api/page", {
    data: { sectionPath: SECTION_PATH, title, noteType: "ink" },
  });
  expect(response.status()).toBe(201);
  const { page: note } = await response.json() as { page: { path: string } };
  return note.path;
}

test("SN-26: Ink Note opens with sidebar access and saves ink and its grid independently", async ({ page, isMobile }, testInfo) => {
  const title = `sn26-ink-${Date.now()}`;
  const notePath = await createInkNote(page, title);
  try {
    await page.goto(`/?page=${encodeURIComponent(notePath)}`);
    const host = page.locator(".ink-canvas-host");
    const overlay = host.getByTestId("ink-overlay-bar");
    const canvas = host.locator(standaloneCanvasSelector);
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await expect(overlay).toContainText(title);
    const sidebarToggle = overlay.getByRole("button", { name: "Open sidebar" });
    await expect(sidebarToggle).toBeVisible();
    if (isMobile) {
      await sidebarToggle.click();
      await expect(page.getByRole("dialog", { name: "Notes" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Notes" })).toBeHidden();
    }

    if (!smartInk) await page.getByRole("button", { name: /^Draw —/ }).click();
    else if (isMobile) {
      await host.getByRole("button", { name: "Ink color", exact: true }).tap();
      await host.getByRole("button", { name: "Ink color blue", exact: true }).tap();
      await host.getByRole("button", { name: "Stroke width" }).tap();
      await host.getByRole("button", { name: "Thick", exact: true }).tap();
    }
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.43, { steps: 8 });
    await page.mouse.up();
    await expect(host.locator(renderedStrokeSelector)).toHaveCount(1);
    if (smartInk && isMobile) await expect(host.locator(renderedStrokeSelector)).toHaveAttribute("fill", "#2563eb");

    await overlay.getByRole("button", { name: "Show grid" }).click();
    await expect.poll(() => readNoteInk(page.request, notePath)).toMatchObject({
      backgroundMode: "grid", origins: [expect.any(Object)],
    });
    expect(await readNoteInk(page.request, notePath, smartInk ? "tldraw" : "smart-notes")).toEqual({
      origins: [], backgroundMode: "blank",
    });

    await page.reload();
    await expect(overlay.getByRole("button", { name: "Hide grid" })).toBeVisible({ timeout: 20_000 });
    await expect(host.locator(renderedStrokeSelector)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("ink-note.png") });
  } finally {
    await page.request.delete(`/api/page?path=${encodeURIComponent(notePath)}`);
  }
});

test("SN-425: Smart Notes Ink Note edits strokes and pans and zooms ink with its grid", async ({ page, isMobile }) => {
  test.skip(!smartInk || !isMobile, "Smart Notes canvas interaction on a touch-capable viewport");
  const title = `sn425-canvas-${Date.now()}`;
  const notePath = await createInkNote(page, title);
  try {
    await page.goto(`/?page=${encodeURIComponent(notePath)}`);
    const host = page.locator(".ink-canvas-host");
    const canvas = host.locator(standaloneCanvasSelector);
    const stroke = host.locator(renderedStrokeSelector);
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await host.getByRole("button", { name: "Show grid" }).click();
    const { x, y, width, height } = (await canvas.boundingBox())!;
    const start = { x: x + width * 0.3, y: y + height * 0.35 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 65, start.y, { steps: 6 });
    await page.mouse.up();
    await expect(stroke).toBeVisible();

    const inkTools = host.getByRole("toolbar", { name: "Ink tools" });
    await expect(inkTools.getByRole("button")).toHaveCount(7);
    await inkTools.getByRole("button", { name: "Select" }).tap();
    await page.mouse.click(start.x + 30, start.y);
    await expect(host.getByRole("button", { name: "Delete selected ink" })).toBeEnabled();
    await inkTools.getByRole("button", { name: "Eraser" }).tap();
    await page.mouse.click(start.x + 30, start.y);
    await expect(stroke).toHaveCount(0);
    await inkTools.getByRole("button", { name: "Undo" }).tap();
    await expect(stroke).toBeVisible();
    await inkTools.getByRole("button", { name: "Redo" }).tap();
    await expect(stroke).toHaveCount(0);
    await inkTools.getByRole("button", { name: "Undo" }).tap();

    const grid = canvas.locator("pattern");
    const inkTransform = stroke.locator("../..");
    const camera = () => grid.getAttribute("patternTransform");
    const scale = async () => Number((await camera())?.match(/scale\((.+)\)/)?.[1]);
    const expectCameraChanged = async (before: string | null) => {
      await expect.poll(camera).not.toBe(before);
      await expect(inkTransform).toHaveAttribute("transform", (await camera())!);
    };

    const original = await camera();
    await page.mouse.wheel(25, 30);
    await expectCameraChanged(original);
    expect(await scale()).toBe(1);
    const panned = await camera();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await expectCameraChanged(panned);
    const zoom = await scale();
    expect(zoom).toBeGreaterThan(1);

    const touch = await page.context().newCDPSession(page);
    const gesture = async (type: "touchStart" | "touchMove", x1: number, x2: number, row: number) => {
      await touch.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: [{ id: 1, x: x1, y: row }, { id: 2, x: x2, y: row }],
      });
    };
    const beforeTouch = await camera();
    await gesture("touchStart", start.x, start.x + 60, start.y + 100);
    await gesture("touchMove", start.x + 20, start.x + 80, start.y + 140);
    await expectCameraChanged(beforeTouch);
    expect(await scale()).toBeCloseTo(zoom, 5);
    const beforePinch = await camera();
    await gesture("touchMove", start.x, start.x + 100, start.y + 140);
    await expectCameraChanged(beforePinch);
    expect(await scale()).toBeGreaterThan(zoom);
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.detach();
    await expect(stroke).toHaveCount(1);
  } finally {
    await page.request.delete(`/api/page?path=${encodeURIComponent(notePath)}`);
  }
});
