import { test, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { PNG } from "pngjs";

/**
 * SN-336 walkthrough: Record area (explicit crop) on a vector figure and
 * Record page on an image-only page, desktop and phone. Clips must be
 * PDFium renders of the PDF — not viewport screenshots — so night mode and
 * reader chrome never leak into the saved note image. Screenshots land in
 * evidence/sn-336 for review.
 */

const PDF_FIXTURE = path.resolve(__dirname, "fixtures/sn-336-figures.pdf");
const SHOT_DIR = path.resolve(__dirname, "../evidence/sn-336");

fs.mkdirSync(SHOT_DIR, { recursive: true });

test.beforeEach(() => test.setTimeout(300_000));

interface Target { pageTitle: string; pagePath: string; vaultPath: string; href: string }

async function scaffold(page: Page): Promise<Target> {
  const pageTitle = `SN336 Clip ${Date.now().toString(36).slice(-6)}`;
  const tree = (await (await page.request.get("/api/vault")).json()).tree as Array<{ path: string; sections: Array<{ path: string }> }>;
  const notebook = tree.find((n) => n.sections?.length > 0)!;
  const create = await page.request.post("/api/page", {
    data: { sectionPath: notebook.sections[0].path, notebookPath: notebook.path, title: pageTitle, noteType: "text" },
  });
  expect(create.ok()).toBe(true);
  const pagePath = ((await create.json()) as { page: { path: string } }).page.path;
  const upload = await page.request.post(`/api/assets?path=${encodeURIComponent(pagePath)}`, {
    multipart: { file: { name: "Figures.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(PDF_FIXTURE) } },
  });
  const href = ((await upload.json()) as { asset: { url: string } }).asset.url;
  const content = `<h1>${pageTitle}</h1><p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false" href="${href}" fileName="Figures.pdf"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${href}">Figures.pdf</span></span></p>`;
  expect((await page.request.put("/api/page", { data: { path: pagePath, title: pageTitle, content } })).ok()).toBe(true);
  await page.addInitScript((p) => window.localStorage.setItem("smart-notes-active-page", p), pagePath);
  return { pageTitle, pagePath, vaultPath: decodeURIComponent(href.replace(/^\/vault\//, "")), href };
}

async function openReader(page: Page) {
  await page.goto("/");
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible({ timeout: 90000 });
  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 30000 });
  const frame = page.locator(".pdf-reader__page-frame").first();
  await expect.poll(async () => frame.locator("img").count(), { timeout: 45000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("pdf-reader-annotate-toggle")).toBeEnabled({ timeout: 30000 });
}

async function press(locator: Locator, touch: boolean) {
  if (touch) await locator.tap();
  else await locator.click();
}

async function noteBody(page: Page, pagePath: string): Promise<string> {
  const res = await page.request.get(`/api/page?path=${encodeURIComponent(pagePath)}`);
  const json = (await res.json()) as { page?: { body?: string; content?: string }; body?: string; content?: string };
  return json.page?.body ?? json.page?.content ?? json.body ?? json.content ?? "";
}

/** Fetch the clip the note references and decode it. */
async function savedClip(page: Page, body: string, kind: "area" | "page") {
  const match = body.match(new RegExp(`<img src="([^"]+)"[^>]*data-pdf-record-clip="${kind}"`));
  expect(match, `note must embed a ${kind} clip`).toBeTruthy();
  const res = await page.request.get(match![1].replace(/&amp;/g, "&"));
  expect(res.status()).toBe(200);
  return PNG.sync.read(Buffer.from(await res.body()));
}

function pixel(png: PNG, fx: number, fy: number) {
  const x = Math.min(png.width - 1, Math.round(png.width * fx));
  const y = Math.min(png.height - 1, Math.round(png.height * fy));
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

function hasColor(png: PNG, test: (r: number, g: number, b: number) => boolean) {
  for (let i = 0; i < png.data.length; i += 4 * 7) if (test(png.data[i], png.data[i + 1], png.data[i + 2])) return true;
  return false;
}

/** Open the page-actions menu: the desktop bar's Record menu, or phone More. */
async function openPageActions(page: Page, touch: boolean): Promise<string> {
  const trigger = page.getByTestId(touch ? "pdf-reader-more-menu" : "pdf-reader-record-clip");
  // Chrome may be collapsed; a centre tap brings it back (the first tap may
  // only dismiss a live selection).
  const shown = async () => (await trigger.isVisible()) && ((await trigger.boundingBox())?.y ?? -1) >= 0;
  for (let attempt = 0; attempt < 4 && !(await shown()); attempt += 1) {
    const box = (await page.getByTestId("pdf-reader-viewport").boundingBox())!;
    if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
  }
  await press(trigger, touch);
  return touch ? "pdf-reader-more" : "pdf-reader-bar";
}

test("Record area and Record page save PDF-rendered clips with provenance (SN-336)", async ({ page }, testInfo) => {
  const proj = testInfo.project.name;
  const touch = proj === "mobile";
  const shot = async (name: string) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOT_DIR, `${proj}-${name}.png`) });
  };
  const target = await scaffold(page);
  const originalPdf = fs.readFileSync(PDF_FIXTURE);
  await openReader(page);
  await shot("01-open");

  // 1. Page actions offer Record area and Record page (desktop: page menu; phone: More).
  const frame = page.locator(".pdf-reader__page-frame").first();
  if (touch) {
    const prefix = await openPageActions(page, touch);
    await expect(page.getByTestId(`${prefix}-record-area`)).toHaveText("Record area on page 1");
    await expect(page.getByTestId(`${prefix}-record-page`)).toHaveText("Record page 1");
    await shot("02-page-actions");
    await press(page.getByTestId(`${prefix}-record-area`), touch);
  } else {
    // Desktop: the bar's Record menu, and the right-click page menu.
    const prefix = await openPageActions(page, touch);
    await expect(page.getByTestId(`${prefix}-record-area`)).toHaveText("Record area on page 1");
    await expect(page.getByTestId(`${prefix}-record-page`)).toHaveText("Record page 1");
    await shot("02a-bar-record-menu");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(`${prefix}-record-area`)).toHaveCount(0);
    await expect(page.getByTestId("pdf-reader")).toBeVisible();
    const box = (await frame.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6, { button: "right" });
    await expect(page.getByRole("menuitem", { name: "Record area" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Record page" })).toBeVisible();
    await shot("02-page-actions");
    await page.getByRole("menuitem", { name: "Record area" }).click();
  }

  // 2. Explicit crop mode on page 1 only; confirm stays disabled until an intentional area exists.
  const bar = page.getByTestId("pdf-reader-crop-bar");
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("pdf-reader-viewport")).toHaveAttribute("data-record-area", "on");
  await expect(page.getByTestId("pdf-reader-crop-layer")).toHaveCount(1);
  await expect(page.getByTestId("pdf-reader-crop-confirm")).toBeDisabled();
  const layer = page.getByTestId("pdf-reader-crop-layer");
  const lb = (await layer.boundingBox())!;
  // Bar chart sits at PDF x 100–500, y 200–450 (bottom-left origin) on a 612×792 page.
  const from = { x: lb.x + lb.width * 0.15, y: lb.y + lb.height * 0.41 };
  const to = { x: lb.x + lb.width * 0.84, y: lb.y + lb.height * 0.76 };
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const touchAt = (type: string, p?: { x: number; y: number }) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
    await touchAt("touchStart", from);
    for (let i = 1; i <= 10; i += 1) await touchAt("touchMove", { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 });
    await touchAt("touchEnd");
    // Headless Chrome's gesture detector keeps a CDP drag over touch-action:none
    // open, so the next tap gets no click. A cancelled touch resets it; this is
    // a harness artifact (reproduced on a plain injected div), not app code.
    await touchAt("touchStart", { x: 2, y: lb.y + lb.height - 2 });
    await touchAt("touchCancel");
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  }
  await expect(page.getByTestId("pdf-reader-crop-rect")).toBeVisible();
  await expect(page.getByTestId("pdf-reader-crop-confirm")).toBeEnabled();
  await expect(bar).toContainText("Area selected on page 1");
  // The crop gesture must not have turned the page, toggled chrome, or started a text selection.
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("1");
  await expect(page.getByTestId("pdf-passage-menu")).toHaveCount(0);
  await shot("03-crop-drawn");

  // 3. Preview before saving: a readable PDF render, not yet written.
  await press(page.getByTestId("pdf-reader-crop-confirm"), touch);
  const panel = page.getByTestId("pdf-record-panel");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("dialog", { name: "Record PDF area" })).toBeVisible();
  const preview = panel.getByTestId("pdf-record-clip-preview");
  await expect(preview).toBeVisible();
  const natural = await preview.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }));
  expect(natural.w).toBeGreaterThan(1000); // ~4x a 420pt-wide figure, capped at 2400
  expect(await noteBody(page, target.pagePath)).not.toContain("data-pdf-record-clip");
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId("pdf-reader-crop-layer")).toHaveCount(0);
  await expect(panel.getByLabel("Save in")).toHaveValue(target.pagePath);
  await shot("04-area-preview");

  // 4. Record → durable note image with title, 1-based page and return link.
  await press(panel.getByRole("button", { name: "Record", exact: true }), touch);
  await expect(panel).toContainText(`Saved in ${target.pagePath}`, { timeout: 15000 });
  let body = await noteBody(page, target.pagePath);
  expect(body).toContain("<strong>Figures.pdf</strong> · Page 1");
  expect(body).toContain(`${target.href}#page=1`);
  const area = await savedClip(page, body, "area");
  expect(area.width).toBe(natural.w);
  expect(area.height).toBe(natural.h);
  expect(hasColor(area, (r, g, b) => r < 90 && g > 90 && g < 150 && b > 180), "blue bar inside crop").toBe(true);
  expect(hasColor(area, (r, g, b) => r > 200 && g > 100 && g < 160 && b < 60), "orange bar inside crop").toBe(true);
  expect(pixel(area, 0.98, 0.02).every((v) => v > 240), "page background, not reader chrome").toBe(true);
  await shot("05-area-saved");

  // 5. Undo removes the record and its asset; Record again then keep it.
  const areaUrl = body.match(/<img src="([^"]+)"/)![1];
  await press(panel.getByRole("button", { name: "Undo" }), touch);
  await expect(panel).toHaveCount(0, { timeout: 15000 });
  expect(await noteBody(page, target.pagePath)).not.toContain("data-pdf-record-clip");
  expect((await page.request.get(areaUrl)).status()).toBe(404);

  // 6. Ordinary navigation is intact after leaving crop mode.
  await expect(page.getByTestId("pdf-reader-viewport")).toHaveAttribute("data-record-area", "off");
  await expect(page.getByTestId("pdf-reader-viewport")).toHaveAttribute("data-tap-zones", "on");
  if (!touch) {
    const viewport = page.getByTestId("pdf-reader-viewport");
    const before = await viewport.evaluate((el) => el.scrollTop);
    await viewport.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    await viewport.evaluate((el) => { el.scrollTop = 0; });
    // Text selection still reaches EmbedPDF.
    const fb = (await frame.boundingBox())!;
    await page.mouse.move(fb.x + fb.width * 0.12, fb.y + fb.height * 0.093);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width * 0.7, fb.y + fb.height * 0.093, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByTestId("pdf-passage-menu")).toBeVisible({ timeout: 5000 });
    // Entering Record area below clears this live selection itself.
  }

  // 7. Cancel leaves crop mode without writing anything.
  let prefix = await openPageActions(page, touch);
  await press(page.getByTestId(`${prefix}-record-area`), touch);
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("pdf-passage-menu")).toHaveCount(0);
  await press(page.getByTestId("pdf-reader-crop-cancel"), touch);
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId("pdf-reader-crop-layer")).toHaveCount(0);

  // 8. Image-only page 2 in night mode: Record page renders the page itself (no inversion, no chrome).
  if (touch) {
    await openPageActions(page, touch);
    await press(page.getByTestId("pdf-reader-more-night"), touch);
    // Checkbox items keep the menu open; the trigger closes it.
    await press(page.getByTestId("pdf-reader-more-menu"), touch);
    await expect(page.getByTestId("pdf-reader-more-menu-content")).toHaveCount(0);
  } else {
    await press(page.getByTestId("pdf-reader-night-mode"), touch);
  }
  await expect(page.getByTestId("pdf-reader-viewport")).toHaveAttribute("data-night-mode", "on");
  await press(page.getByTestId("pdf-reader-next"), touch);
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("2", { timeout: 10000 });
  await shot("06-image-only-night");
  prefix = await openPageActions(page, touch);
  await expect(page.getByTestId(`${prefix}-record-page`)).toHaveText("Record page 2");
  await press(page.getByTestId(`${prefix}-record-page`), touch);
  await expect(page.getByRole("dialog", { name: "Record PDF page" })).toBeVisible({ timeout: 15000 });
  await expect(panel).toContainText("Full page");
  await shot("07-page-preview");
  await press(panel.getByRole("button", { name: "Record", exact: true }), touch);
  await expect(panel).toContainText(`Saved in ${target.pagePath}`, { timeout: 15000 });
  body = await noteBody(page, target.pagePath);
  expect(body).toContain("<strong>Figures.pdf</strong> · Page 2");
  expect(body).toContain(`${target.href}#page=2`);
  expect(body).not.toContain("Text unavailable");
  const full = await savedClip(page, body, "page");
  expect(Math.max(full.width, full.height)).toBe(2400);
  expect(full.width / full.height).toBeCloseTo(612 / 792, 2);
  expect(pixel(full, 0.02, 0.02).every((v) => v > 240), "white page corner despite night mode").toBe(true);
  const [r, g, b] = pixel(full, 0.5, 0.5);
  expect(r > 170 && g < 80 && b < 100, `raster ring at page centre, got ${r},${g},${b}`).toBe(true);
  await shot("08-page-saved");

  // 9. One asset per kept record, PDF bytes untouched, no stray annotations.
  const assets = body.match(/data-pdf-record-clip=/g) ?? [];
  expect(assets).toHaveLength(1);
  const pdfBytes = Buffer.from(await (await page.request.get(target.href)).body());
  expect(pdfBytes.equals(originalPdf)).toBe(true);
  const sidecar = await (await page.request.get(`/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`)).json() as { items: unknown[] };
  expect(sidecar.items).toHaveLength(0);

  // 10. The return link in the note reopens the PDF on the recorded page.
  await press(panel.getByRole("button", { name: "Open note" }), touch);
  // Record writes server-side; the open host page shows the standard
  // external-update banner, same as text Record and Companion writes.
  const reload = page.getByRole("button", { name: "Reload", exact: true });
  if (await reload.isVisible().catch(() => false)) await press(reload, touch);
  const editorImg = page.locator('.editor-content img[data-pdf-record-clip="page"], .ProseMirror img[src*="pdf-record-"]').first();
  await expect(editorImg).toBeVisible({ timeout: 30000 });
  await editorImg.scrollIntoViewIfNeeded();
  await expect(page.locator(`a[href="${target.href}#page=2"]`).first()).toBeAttached();
  await shot("09-note-with-clip");
});
