import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { closeNotebookTreeSheet, ensureNotebookTreeVisible } from "./helpers";

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
}

async function openPage(page: Page, title: string) {
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 15_000 });
  await closeNotebookTreeSheet(page);
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
  const source = await fs.readFile(sidecarPath, "utf8").catch(() => "");
  if (!source) return 0;
  const sidecar = JSON.parse(source) as {
    scene?: { document?: { store?: Record<string, { typeName?: string; type?: string }> } };
  };
  return Object.values(sidecar.scene?.document?.store ?? {}).filter(
    (record) => record.typeName === "shape" && record.type === "draw"
  ).length;
}

async function expectCommittedStrokePainted(layer: import("@playwright/test").Locator) {
  const path = layer.locator('.tl-shape[data-shape-type="draw"] path').last();
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
  const stamp = String(Date.now());
  const title = `sn216-${stamp}-draw-persistence`;
  const pagePath = path.join(VAULT, "Personal Notebook", "Quick Notes", `${title}.html`);
  const sidecarPath = pagePath.replace(/\.html$/, ".annotations.json");
  const mobile = testInfo.project.name === "mobile";

  try {
    await seedPage(request, title);
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20_000 });
    await openPage(page, title);

    await page.getByTestId(mobile ? "toolbar-annotate-mobile" : "toolbar-annotate").click();
    const layer = page.getByTestId("annotation-layer");
    await expect(layer).toHaveAttribute("data-annotation-ready", "true", { timeout: 20_000 });
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();

    const renderedStroke = layer.locator('.tl-shape[data-shape-type="draw"]');
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
    await page.waitForTimeout(1_800);
    await expect(renderedStroke).toHaveCount(expectedShapeCount);
    await expectCommittedStrokePainted(layer);

    await page.getByTestId(mobile ? "ink-exit-draw-mobile" : "ink-exit-draw").click();
    await expect(layer).toHaveAttribute("data-annotation-visible", "true");
    await expect(renderedStroke).toHaveCount(expectedShapeCount);
    await expectCommittedStrokePainted(layer);

    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20_000 });
    await openPage(page, title);
    const reopenedLayer = page.getByTestId("annotation-layer");
    await expect(reopenedLayer).toHaveAttribute("data-annotation-ready", "true", {
      timeout: 20_000,
    });
    await expect(reopenedLayer.locator('.tl-shape[data-shape-type="draw"]')).toHaveCount(
      expectedShapeCount
    );
    await expectCommittedStrokePainted(reopenedLayer);
    await expect.poll(() => readDrawShapeCount(sidecarPath)).toBe(expectedShapeCount);
  } finally {
    await fs.rm(pagePath, { force: true });
    await fs.rm(sidecarPath, { force: true });
  }
});
