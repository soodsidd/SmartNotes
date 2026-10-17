import { test, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * SN-334 walkthrough: PDF selection → Highlight / Record / Ask Companion on
 * desktop and phone, Highlight survives reopen with no duplicate, and a tapped
 * highlight offers Record and Ask Companion beside its comment controls.
 * Screenshots land in evidence/sn-334 for review.
 */

const PDF_FIXTURE = path.resolve(__dirname, "fixtures/catalogue-final.pdf");
const SHOT_DIR = path.resolve(__dirname, "../evidence/sn-334");
const PDF_WIDTH = 612;
const PDF_HEIGHT = 792;

fs.mkdirSync(SHOT_DIR, { recursive: true });

test.beforeEach(() => test.setTimeout(300_000));

interface Target {
  pageTitle: string;
  pagePath: string;
  vaultPath: string;
}

type Rect = { origin: { x: number; y: number }; size: { width: number; height: number } };
type SidecarItem = { annotation?: { id?: string; type?: number; rect?: Rect; custom?: { text?: string } } };

async function scaffold(page: Page): Promise<Target> {
  const pageTitle = `SN334 Menu ${Date.now().toString(36).slice(-6)}`;
  const tree = (await (await page.request.get("/api/vault")).json()).tree as Array<{ path: string; sections: Array<{ path: string }> }>;
  const notebook = tree.find((n) => n.sections?.length > 0)!;
  const create = await page.request.post("/api/page", {
    data: { sectionPath: notebook.sections[0].path, notebookPath: notebook.path, title: pageTitle, noteType: "text" },
  });
  expect(create.ok()).toBe(true);
  const pagePath = ((await create.json()) as { page: { path: string } }).page.path;
  const upload = await page.request.post(`/api/assets?path=${encodeURIComponent(pagePath)}`, {
    multipart: { file: { name: "Catalogue(Final).pdf", mimeType: "application/pdf", buffer: fs.readFileSync(PDF_FIXTURE) } },
  });
  const href = ((await upload.json()) as { asset: { url: string } }).asset.url;
  const content = `<h1>${pageTitle}</h1><p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false" href="${href}" fileName="Catalogue(Final).pdf"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${href}">Catalogue(Final).pdf</span></span></p>`;
  expect((await page.request.put("/api/page", { data: { path: pagePath, title: pageTitle, content } })).ok()).toBe(true);
  await page.addInitScript((p) => window.localStorage.setItem("smart-notes-active-page", p), pagePath);
  return { pageTitle, pagePath, vaultPath: decodeURIComponent(href.replace(/^\/vault\//, "")) };
}

async function openReader(page: Page) {
  await page.goto("/");
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible({ timeout: 90000 });
  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 30000 });
  const frame = page.locator(".pdf-reader__page-frame").first();
  await expect.poll(async () => frame.locator("img").count(), { timeout: 45000 }).toBeGreaterThan(0);
  // Annotate readiness == sidecar imported, which also enables menu Highlight.
  await expect(page.getByTestId("pdf-reader-annotate-toggle")).toBeEnabled({ timeout: 30000 });
}

async function sidecar(page: Page, vaultPath: string): Promise<SidecarItem[]> {
  const res = await page.request.get(`/api/pdf-annotations?path=${encodeURIComponent(vaultPath)}`);
  return ((await res.json()) as { items: SidecarItem[] }).items;
}

/** Drag-select a text line on page 1 in read mode; returns the line's y. */
async function selectLine(page: Page, preferredFraction?: number): Promise<number> {
  const frame = page.locator(".pdf-reader__page-frame").first();
  const fractions = preferredFraction ? [preferredFraction] : [0.08, 0.1, 0.12, 0.14, 0.17, 0.2, 0.24, 0.27];
  for (const fy of fractions) {
    const box = (await frame.boundingBox())!;
    const y = box.y + box.height * fy;
    await page.mouse.move(box.x + box.width * 0.08, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, y, { steps: 12 });
    await page.mouse.up();
    const menu = page.getByTestId("pdf-passage-menu");
    if (await menu.isVisible({ timeout: 1500 }).catch(() => false)) return fy;
  }
  throw new Error("no selectable text line found on page 1");
}

async function press(locator: Locator, touch: boolean) {
  if (touch) await locator.tap();
  else await locator.click();
}

async function tapHighlight(page: Page, rect: Rect, touch: boolean) {
  const box = (await page.locator(".pdf-reader__page-frame").first().boundingBox())!;
  const x = box.x + ((rect.origin.x + rect.size.width / 2) / PDF_WIDTH) * box.width;
  const y = box.y + ((rect.origin.y + rect.size.height / 2) / PDF_HEIGHT) * box.height;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

test("selection menu: Highlight, Record, Ask Companion, reopen and tapped highlight (SN-334)", async ({ page }, testInfo) => {
  const proj = testInfo.project.name;
  const touch = proj === "mobile";
  const shot = async (name: string) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOT_DIR, `${proj}-${name}.png`) });
  };

  const target = await scaffold(page);
  await openReader(page);
  await shot("01-open");

  // 1. Selection shows the three actions, beside (not over) the passage.
  const fy = await selectLine(page);
  const menu = page.getByTestId("pdf-passage-menu");
  const actions = menu.getByRole("toolbar", { name: "Selected passage actions" });
  await expect(actions.getByRole("button")).toHaveText(["Highlight", "Record", "Ask Companion"]);
  const frameBox = (await page.locator(".pdf-reader__page-frame").first().boundingBox())!;
  const lineY = frameBox.y + frameBox.height * fy;
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.y > lineY || menuBox.y + menuBox.height < lineY, "menu must not cover the selected line").toBe(true);
  const viewport = page.viewportSize()!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
  if (touch) {
    for (const button of await actions.getByRole("button").all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await shot("02-selection-menu");

  // 2. Highlight creates exactly one normal EmbedPDF highlight in the sidecar.
  await press(actions.getByRole("button", { name: "Highlight" }), touch);
  await expect(page.getByTestId("pdf-reader-highlight-notice")).toContainText("Highlighted");
  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await sidecar(page, target.vaultPath)).length, { timeout: 10000 }).toBe(1);
  const [created] = await sidecar(page, target.vaultPath);
  expect(created.annotation?.type).toBe(9);
  expect(created.annotation?.custom?.text?.length ?? 0).toBeGreaterThan(0);
  await shot("03-highlighted");

  // 3. Repeating Highlight on the same passage never stacks a duplicate.
  await selectLine(page, fy);
  await press(page.getByTestId("pdf-passage-highlight"), touch);
  await expect(page.getByTestId("pdf-reader-highlight-notice")).toContainText("Already highlighted");
  await page.waitForTimeout(1200);
  expect(await sidecar(page, target.vaultPath)).toHaveLength(1);
  await shot("04-already-highlighted");

  // 4. Reopen: the highlight is still there, once.
  await openReader(page);
  await expect.poll(async () => (await sidecar(page, target.vaultPath)).length).toBe(1);
  await shot("05-reopened");

  // 5. Tapping the highlight offers Record and Ask Companion with comment controls.
  const rect = created.annotation!.rect!;
  await tapHighlight(page, rect, touch);
  const dish = page.getByTestId("pdf-reader-anno-menu");
  await expect(dish).toBeVisible({ timeout: 10000 });
  await expect(dish.getByTestId("pdf-reader-anno-edit")).toBeVisible();
  await expect(dish.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button")).toHaveText(["Record", "Ask Companion"]);
  await shot("06-highlight-tapped");

  // 6. Tapped highlight → Ask Companion carries that highlight's passage.
  await press(dish.getByRole("button", { name: "Ask Companion" }), touch);
  const popover = page.getByTestId("ask-companion-popover");
  await expect(popover).toBeVisible();
  await expect(popover.locator(".inline-ai-target")).toHaveText("Selection");
  await expect(popover.locator("blockquote")).toContainText(created.annotation!.custom!.text!.trim().slice(0, 12));
  await shot("07-highlight-ask");
  await press(popover.getByRole("button", { name: "Close Companion popover" }), touch);

  // 7. Tapped highlight → Record saves the passage.
  await tapHighlight(page, rect, touch);
  await expect(dish).toBeVisible({ timeout: 10000 });
  await press(dish.getByRole("button", { name: "Record" }), touch);
  const record = page.getByTestId("pdf-record-panel");
  await expect(record).toContainText(`Saved in ${target.pagePath}`, { timeout: 15000 });
  await shot("08-highlight-record");
  await press(record.getByRole("button", { name: "Close Record panel" }), touch);

  // 8. Selection → Record.
  await selectLine(page);
  await press(page.getByTestId("pdf-passage-record"), touch);
  await expect(record).toContainText(`Saved in ${target.pagePath}`, { timeout: 15000 });
  await shot("09-selection-record");
  await press(record.getByRole("button", { name: "Close Record panel" }), touch);

  // 9. Selection → Ask Companion keeps the exact range as target.
  await selectLine(page);
  await press(page.getByTestId("pdf-passage-ask"), touch);
  await expect(popover).toBeVisible();
  await expect(popover.locator(".inline-ai-target")).toHaveText("Selection");
  await shot("10-selection-ask");
  await press(popover.getByRole("button", { name: "Close Companion popover" }), touch);

  if (!touch) {
    // 10. Desktop right-click menu on a live range.
    const line = await selectLine(page, 0.2).catch(() => selectLine(page));
    const box = (await page.locator(".pdf-reader__page-frame").first().boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * line, { button: "right" });
    await expect(page.getByRole("menuitem")).toHaveText(["Highlight", "Record", "Record options…", "Record area", "Record page", "Ask Companion..."]);
    await shot("11-context-menu");
    // 11. Context-menu Highlight then Undo from the notice, without Annotate.
    const before = (await sidecar(page, target.vaultPath)).length;
    await page.getByRole("menuitem", { name: "Highlight" }).click();
    const notice = page.getByTestId("pdf-reader-highlight-notice");
    await expect(notice).toContainText(/Highlighted|Already highlighted/);
    if ((await notice.textContent())?.startsWith("Highlighted")) {
      await expect.poll(async () => (await sidecar(page, target.vaultPath)).length).toBe(before + 1);
      await shot("12-context-highlighted");
      await page.getByTestId("pdf-reader-highlight-undo").click();
      await expect.poll(async () => (await sidecar(page, target.vaultPath)).length).toBe(before);
      await shot("13-undo");
    }
  }

  // Read-mode copy still uses the virtual selection.
  if (!touch) {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await selectLine(page);
    await page.keyboard.press("Control+C");
    await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).length).toBeGreaterThan(0);
  }
});
