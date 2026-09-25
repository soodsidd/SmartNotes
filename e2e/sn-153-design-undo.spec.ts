import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureNotebookTreeVisible } from "./helpers";

// SN-153 (post-SN-167 integration): design pages mount AnnotationLayer through
// next/dynamic, which drops a forwarded `ref` — so the draw toolbar's undo/redo
// buttons (which call layerRef.current?.undo()) were dead on design pages. The
// fix routes the imperative handle through the `handleRef` prop. This test
// proves undo actually reverses a stroke on a DESIGN page: the annotation
// sidecar shape count must fall from 2 → 1 after one undo. With the dead ref it
// stays at 2 (the click no-ops).

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const SECTION_PATH = "Personal Notebook/Quick Notes";

async function createDesignPage(
  request: APIRequestContext,
  title: string,
  body: string
): Promise<string> {
  const created = await request.post("/api/agent/vault", {
    data: { tool: "page_create", args: { sectionPath: SECTION_PATH, title, noteType: "design" } },
  });
  expect(created.ok(), `page_create failed: ${await created.text()}`).toBeTruthy();
  const pagePath: string = (await created.json()).result.data.page.path;

  const written = await request.post("/api/agent/vault", {
    data: { tool: "page_write", args: { path: pagePath, body } },
  });
  expect(written.ok(), `page_write failed: ${await written.text()}`).toBeTruthy();
  return pagePath;
}

async function sidecarShapeCount(title: string): Promise<number> {
  const sidecarPath = path.join(VAULT, "Personal Notebook", "Quick Notes", `${title}.annotations.json`);
  try {
    const raw = await fs.readFile(sidecarPath, "utf8");
    const payload = JSON.parse(raw) as {
      scene?: { document?: { store?: Record<string, { typeName?: string }> } };
    };
    const store = payload.scene?.document?.store ?? {};
    return Object.values(store).filter((r) => r?.typeName === "shape").length;
  } catch {
    return -1;
  }
}

test("SN-153 desktop: undo reverses an ink stroke on a design page (handleRef reaches the layer)", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop draw-mode undo workflow only");
  test.setTimeout(180_000);

  const title = `sn153-design-undo-${Date.now()}`;
  const body = [
    "<!doctype html><html><head><style>",
    "body{margin:0;font-family:sans-serif}.hero{height:1400px;background:linear-gradient(#eef,#fff);padding:40px}",
    "</style></head><body><section class=\"hero\"><h1 data-testid=\"art-hero\">Undo target</h1></section></body></html>",
  ].join("");
  await createDesignPage(request, title, body);

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
  const tree = await ensureNotebookTreeVisible(page);
  const row = tree.getByText(title, { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();

  await expect(page.getByTestId("design-page-frame")).toBeVisible({ timeout: 20000 });

  // Enter draw mode and wait for the tldraw overlay to hydrate with an owner
  // path (otherwise autosave skips with "skip-no-owner").
  await page.getByTestId("design-pen-toggle").click();
  const layer = page.getByTestId("annotation-layer");
  await expect(layer).toHaveAttribute("data-annotation-mode", "draw", { timeout: 15000 });
  await expect(layer).toHaveAttribute("data-annotation-ready", "true", { timeout: 15000 });
  await expect(page.getByTestId("design-draw-toolbar")).toBeVisible({ timeout: 15000 });

  const box = (await layer.boundingBox())!;
  expect(box).not.toBeNull();

  // Two distinct strokes at different positions → two draw shapes.
  const drawStroke = async (fromX: number, fromY: number, toX: number, toY: number) => {
    await page.mouse.move(box.x + fromX, box.y + fromY);
    await page.mouse.down();
    await page.mouse.move(box.x + toX, box.y + toY, { steps: 10 });
    await page.mouse.up();
  };
  await drawStroke(box.width * 0.25, box.height * 0.25, box.width * 0.45, box.height * 0.35);
  await drawStroke(box.width * 0.55, box.height * 0.45, box.width * 0.75, box.height * 0.55);

  // Autosave (debounced) persists both strokes to the sidecar.
  await expect.poll(() => sidecarShapeCount(title), { timeout: 20000 }).toBe(2);

  // Undo must be enabled after drawing, then reverse exactly one stroke.
  const undoBtn = page.getByTestId("ink-tool-undo");
  await expect(undoBtn).toBeEnabled({ timeout: 15000 });
  await undoBtn.click();

  // The undone state autosaves: sidecar converges to a single shape. With the
  // pre-fix dead ref the click no-ops and this stays at 2.
  await expect.poll(() => sidecarShapeCount(title), { timeout: 20000 }).toBe(1);

  // Redo restores the second stroke (same handleRef path).
  const redoBtn = page.getByTestId("ink-tool-redo");
  await expect(redoBtn).toBeEnabled({ timeout: 15000 });
  await redoBtn.click();
  await expect.poll(() => sidecarShapeCount(title), { timeout: 20000 }).toBe(2);
});
