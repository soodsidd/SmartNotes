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
      .filter((e) => e.includes(`sn153-${stamp}`))
      .map((e) => {
        const base = path.join(sectionDir, e);
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
    data: { path: created.page.path, title, content: "<p>SN-153 undo probe.</p>" },
  });
  expect(put.ok()).toBeTruthy();
  return created.page.path;
}

async function openSeededPage(page: Page, title: string) {
  const asideVisible = await page.locator("aside").first().isVisible();
  if (!asideVisible) {
    await page.getByTestId("open-sidebar-btn").click();
  }
  await page.getByTestId("tree").getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 15000 });
}

async function drawStroke(page: Page) {
  const layer = page.getByTestId("annotation-layer");
  const box = await layer.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.35;
  const startY = box!.y + box!.height * 0.4;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 40, { steps: 12 });
  await page.mouse.up();
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

test("SN-153 desktop: draw enables undo and undo removes the last stroke", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn153-${stamp}-undo`;
  const sidecarPath = path.join(VAULT, "Personal Notebook", "Quick Notes", `${noteTitle}.annotations.json`);
  await cleanupArtifacts(stamp);

  await seedTextPage(request, noteTitle);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await openSeededPage(page, noteTitle);

  await page.getByTestId("toolbar-annotate").click();
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-mode", "draw");
  await expect(page.getByTestId("annotation-layer")).toHaveAttribute("data-annotation-ready", "true", {
    timeout: 20000,
  });

  const undoBtn = page.getByTestId("ink-tool-undo");
  const redoBtn = page.getByTestId("ink-tool-redo");
  // AC: freshly loaded scene has nothing to undo (canUndo tracking; the load must
  // not sit on the undo stack — that was the SN-153 regression).
  await expect(undoBtn).toBeDisabled();

  await drawStroke(page);
  await drawStroke(page);

  // AC: canUndo becomes true after drawing at least one stroke.
  await expect(undoBtn).toBeEnabled({ timeout: 5000 });

  // AC: clicking the toolbar undo reverses the most recent stroke, and keyboard
  // Ctrl+Z reverses the next one. Both go through the handleRef imperative handle
  // that next/dynamic was silently dropping before the fix.
  await undoBtn.click();
  await expect(redoBtn).toBeEnabled({ timeout: 5000 });
  await page.keyboard.press("Control+Z");

  // AC: redo (keyboard Ctrl+Shift+Z) restores an undone stroke within the session.
  await page.keyboard.press("Control+Shift+Z");

  await page.getByTestId("ink-exit-draw").click();
  await page.waitForResponse(
    (r) => r.url().includes("/api/annotations") && r.request().method() === "PUT" && r.status() === 200
  );
  // Drew 2, undo (button) -> 1, undo (Ctrl+Z) -> 0, redo (Ctrl+Shift+Z) -> 1.
  await expect.poll(async () => readShapeCount(sidecarPath), { timeout: 10000 }).toBe(1);

  await cleanupArtifacts(stamp);
});
