import { expect, test, type Page } from "@playwright/test";
import { annotationSuffix, readAnnotationSidecar, readNoteInk, smartInk, renderedStrokeSelector, standaloneCanvasSelector, strokePathSelector, useAnnotationInkEngine } from "./annotation-ink-parity";
import fs from "node:fs/promises";
import path from "node:path";
import { closeNotebookTreeSheet } from "./helpers";

useAnnotationInkEngine();

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const SECTION_PATH = "Personal Notebook/Quick Notes";

async function seedPage(
  request: import("@playwright/test").APIRequestContext,
  title: string
) {
  const response = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title },
  });
  expect(response.ok()).toBeTruthy();
  const { page } = await response.json() as { page: { path: string } };
  return page.path;
}

async function selectPage(page: Page, title: string) {
  let pageButton = page.getByRole("button", { name: title, exact: false })
    .filter({ visible: true }).first();
  if ((page.viewportSize()?.width ?? 0) <= 600) {
    const menuButton = await page.getByTestId("ink-overlay-bar").isVisible()
      ? page.getByTestId("ink-sidebar-toggle")
      : await page.getByTestId("music-page").isVisible()
        ? page.getByTestId("music-page").getByRole("button", { name: "Open sidebar" })
        : page.getByTestId("open-sidebar-btn");
    await menuButton.click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();
    // Reopening from the ink bar keeps the last drilled section view.
    const drillBack = sheet.getByTestId("mobile-drill-back");
    if (await drillBack.isVisible()) {
      await drillBack.click();
    }
    await page.getByRole("dialog", { name: "Notes" })
      .getByRole("button", { name: "Quick Notes", exact: true }).click();
    pageButton = page.locator('[data-slot="sheet-content"]')
      .getByRole("button", { name: title, exact: false });
  }
  await pageButton.click();
  await closeNotebookTreeSheet(page);
}

async function useInstalledPwaPath(page: Page, pagePath?: string) {
  const search = new URLSearchParams({ source: "pwa" });
  if (pagePath) search.set("page", pagePath);
  await page.goto(`/?${search}`);
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    } catch {
      return false; // The first worker claim can reload the page mid-check.
    }
  }, { timeout: 20_000 }).toBe(true);
  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20_000 });
}

async function drawStroke(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  touch: boolean
) {
  const start = {
    x: Math.round(box.x + box.width * 0.3),
    y: Math.round(box.y + box.height * 0.38),
  };

  if (!touch) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 140, start.y + 34, { steps: 14 });
    await page.mouse.up();
    return;
  }

  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  for (let step = 1; step <= 14; step += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + step * 10,
          y: start.y + Math.round(step * 2.5),
        },
      ],
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

async function drawPenStrokeWithPalm(
  page: Page,
  box: { x: number; y: number; width: number; height: number }
) {
  const session = await page.context().newCDPSession(page);
  const start = {
    x: Math.round(box.x + box.width * 0.32),
    y: Math.round(box.y + box.height * 0.58),
  };
  const pen = { pointerType: "pen" as const, button: "left" as const, buttons: 1 };

  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: start.x,
    y: start.y,
    pointerType: "pen",
  });
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    clickCount: 1,
    force: 0.35,
    ...pen,
  });
  for (let step = 1; step <= 14; step += 1) {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: start.x + step * 10,
      y: start.y + Math.round(step * 2.5),
      force: 0.35,
      ...pen,
    });
    if (step === 5) {
      // Android can emit a touch stream for a resting palm while the stylus is
      // still down. That touch must be rejected without cancelling the pen.
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: start.x - 30, y: start.y + 70 }],
      });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
  }
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: start.x + 140,
    y: start.y + 35,
    clickCount: 1,
    force: 0,
    pointerType: "pen",
    button: "left",
    buttons: 0,
  });
  await session.detach();
}

async function readDrawShapeCount(sidecarPath: string): Promise<number> {
  return (await readAnnotationSidecar(sidecarPath)).strokes.length;
}
async function expectCommittedStrokePainted(layer: import("@playwright/test").Locator) {
  const path = layer.locator(strokePathSelector).last();
  await expect(path).toBeVisible();
  await expect
    .poll(async () => {
      return path.evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const fill = style.fill;
        const stroke = style.stroke;
        const hasPaint =
          !["none", "transparent", "rgba(0, 0, 0, 0)"].includes(fill) ||
          !["none", "transparent", "rgba(0, 0, 0, 0)"].includes(stroke);
        return Boolean(element.getAttribute("d")) && box.width > 8 && box.height > 2 && hasPaint;
      });
    })
    .toBe(true);
}

test("SN-216: a new stroke stays rendered through autosave and reopen", async ({
  page,
  request,
}, testInfo) => {
  if (smartInk) test.setTimeout(120_000);
  const stamp = String(Date.now());
  const title = `sn216-${stamp}-draw-persistence`;
  const pagePath = path.join(VAULT, "Personal Notebook", "Quick Notes", `${title}.html`);
  const sidecarPath = pagePath.replace(/\.html$/, annotationSuffix);
  const mobile = testInfo.project.name === "mobile";

  try {
    const fixturePath = await seedPage(request, title);
    if (mobile) {
      await useInstalledPwaPath(page, fixturePath);
    } else {
      await page.goto(`/?page=${encodeURIComponent(fixturePath)}`);
    }
    const layer = page.getByTestId("annotation-layer");
    await expect(layer).toHaveAttribute("data-annotation-loaded-path", fixturePath, { timeout: 20_000 });

    await page.getByTestId(mobile ? "toolbar-annotate-mobile" : "toolbar-annotate").click();
    await expect(layer).toHaveAttribute("data-annotation-ready", "true", { timeout: 20_000 });
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();

    const renderedStroke = layer.locator(renderedStrokeSelector);
    await expect(renderedStroke).toHaveCount(0);
    await drawStroke(page, box!, mobile);

    // The committed Tldraw shape must replace the transient scribble and remain
    // in the live canvas after the debounced reconciliation/save window.
    await expect(renderedStroke).toHaveCount(1, { timeout: 5_000 });
    await expectCommittedStrokePainted(layer);

    if (mobile) {
      await drawPenStrokeWithPalm(page, box!);
      await expect(renderedStroke).toHaveCount(2, { timeout: 5_000 });
      await expectCommittedStrokePainted(layer);
    }

    const expectedShapeCount = mobile ? 2 : 1;
    await expect
      .poll(() => readDrawShapeCount(sidecarPath), { timeout: 10_000 })
      .toBe(expectedShapeCount);
    await page.waitForTimeout(smartInk ? 30_000 : 1_800);
    await expect(renderedStroke).toHaveCount(expectedShapeCount);
    await expectCommittedStrokePainted(layer);

    await page.getByTestId(mobile ? "ink-exit-draw-mobile" : "ink-exit-draw").click();
    await expect(layer).toHaveAttribute("data-annotation-visible", "true");
    await expect(renderedStroke).toHaveCount(expectedShapeCount);
    await expectCommittedStrokePainted(layer);

    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20_000 });
    await expect(layer).toHaveAttribute("data-annotation-loaded-path", fixturePath, { timeout: 20_000 });
    const reopenedLayer = page.getByTestId("annotation-layer");
    await expect(reopenedLayer).toHaveAttribute("data-annotation-ready", "true", {
      timeout: 20_000,
    });
    await expect(reopenedLayer.locator(renderedStrokeSelector)).toHaveCount(
      expectedShapeCount
    );
    await expectCommittedStrokePainted(reopenedLayer);
    await expect.poll(() => readDrawShapeCount(sidecarPath)).toBe(expectedShapeCount);
  } finally {
    await fs.rm(pagePath, { force: true });
    await fs.rm(sidecarPath, { force: true });
  }
});

test("SN-416: installed PWA fetches the current shell despite a stale cached launch", async ({
  page,
  request,
}, testInfo) => {
  test.skip(smartInk || testInfo.project.name !== "mobile", "Engine-independent PWA delivery path");
  await useInstalledPwaPath(page);

  const script = await (await request.get("/service-worker.js")).text();
  const buildId = script.match(/const BUILD_ID = "([^"]+)"/)?.[1];
  expect(buildId).toBeTruthy();
  const staleMarker = "sn416-stale-cached-shell";
  const cachedMarker = await page.evaluate(async ({ buildId, staleMarker }) => {
    const cache = await caches.open(`smart-notes-app-shell-${buildId}`);
    await cache.put(window.location.href, new Response(
      `<!doctype html><title>${staleMarker}</title><body>${staleMarker}</body>`,
      { headers: { "Content-Type": "text/html" } }
    ));
    return (await (await cache.match(window.location.href))?.text())?.includes(staleMarker);
  }, { buildId, staleMarker });
  expect(cachedMarker).toBe(true);

  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20_000 });
  await expect(page).not.toHaveTitle(staleMarker);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
});

for (const noteType of ["ink", "music"] as const) test(`SN-416: installed PWA keeps ${noteType}-page touch strokes painted after navigation and reload`, async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Installed PWA touch workflow");
  test.setTimeout(150_000);
  const title = `sn416-${Date.now()}-pwa-${noteType}`;
  const created = await request.post("/api/page", {
    data: { sectionPath: SECTION_PATH, title, noteType },
  });
  expect(created.status()).toBe(201);
  const { page: inkPage } = await created.json() as { page: { path: string } };
  const inkPath = inkPage.path;
  const persistedShapeCount = async () => (await readNoteInk(request, inkPath)).origins.length;

  // A new worker claims the controlled page while the ink PUT is still held.
  // The dev harness exercises reopen too, but only production drains and reloads on a claim.
  const verifyWorkerSwap = process.env.SMART_NOTES_E2E_WORKER_SWAP === "1";
  let releaseWrite = () => {};

  try {
    await useInstalledPwaPath(page, inkPath);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const host = noteType === "music" ? ".music-page__ink" : ".ink-canvas-host";
    await expect(page.getByTestId(noteType === "music" ? "music-page" : "ink-overlay-bar")).toBeVisible({ timeout: 20_000 });
    const layer = page.locator(host);
    const canvas = layer.locator(standaloneCanvasSelector);
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    if (noteType === "music") {
      if (!smartInk) await expect(layer.locator(".tl-container")).toHaveClass(/tl-theme__light/);
      await expect(layer).toHaveCSS("z-index", "1");
    }
    if (!smartInk) {
      await expect(canvas).toHaveCSS("content-visibility", "visible");
      if (noteType === "ink") await page.getByRole("button", { name: /^Draw —/ }).click();
    }
    const getNavigation = () => page.evaluate(() => performance.timeOrigin);
    const firstNavigation = await getNavigation();
    let heldWrite: Promise<void> | undefined;
    if (verifyWorkerSwap) {
      const allowWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
      let markWriteHeld!: () => void;
      heldWrite = new Promise<void>((resolve) => { markWriteHeld = resolve; });
      await page.route("**/api/ink", async (route) => {
        markWriteHeld();
        await allowWrite;
        await route.continue();
      });
    }
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await drawStroke(page, box!, true);
    await expect(layer.locator(renderedStrokeSelector)).toHaveCount(1);
    await expectCommittedStrokePainted(layer);
    if (heldWrite) {
      const workerUrl = `/service-worker.js?sn425-update=${Date.now()}`;
      await page.evaluate(async (url) => { await navigator.serviceWorker.register(url, { scope: "/" }); }, workerUrl);
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain(workerUrl);
      await heldWrite;
      expect(await getNavigation()).toBe(firstNavigation);
      expect(await persistedShapeCount()).toBe(0);
      releaseWrite();
      await expect.poll(async () => {
        try { return await getNavigation(); } catch { return firstNavigation; }
      }).not.toBe(firstNavigation);
      await expectCommittedStrokePainted(layer);
    }
    await expect.poll(persistedShapeCount, { timeout: 10_000 }).toBe(1);
    const https = new URL(page.url()).protocol === "https:";
    await page.waitForTimeout(https ? 30_000 : 3_000);
    await expectCommittedStrokePainted(layer);
    if (https) await page.screenshot({ path: testInfo.outputPath(`${noteType}-after-30s.png`) });
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 80 });
    await expectCommittedStrokePainted(layer);
    await page.setViewportSize(viewport);

    await selectPage(page, "AssetTarget");
    await selectPage(page, title);
    await expectCommittedStrokePainted(page.locator(host));
    await page.waitForTimeout(3_000);
    await expectCommittedStrokePainted(page.locator(host));
    // Relaunch the installed app straight onto the page (full document reload).
    await page.goto(`/?source=pwa&page=${encodeURIComponent(inkPath)}`);
    await expect(page.getByTestId(noteType === "music" ? "music-page" : "ink-overlay-bar")).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expectCommittedStrokePainted(page.locator(host));
    await page.waitForTimeout(3_000);
    await expectCommittedStrokePainted(page.locator(host));
    await expect.poll(persistedShapeCount).toBe(1);
    if (https) await page.screenshot({ path: testInfo.outputPath(`${noteType}-after-reload.png`) });
    expect(pageErrors).toEqual([]);
  } finally {
    releaseWrite();
    await request.delete(`/api/page?path=${encodeURIComponent(inkPath)}`);
  }
});
