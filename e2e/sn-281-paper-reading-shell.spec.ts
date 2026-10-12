import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { dismissBlockingOverlays } from "./helpers";

const PDF_FIXTURE = path.resolve(__dirname, "fixtures/catalogue-final.pdf");
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-281");
// First requests compile routes and the PDFium engine in the dev harness.
const SLOW = { timeout: 60_000 };

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return { x: Math.round(value!.x), y: Math.round(value!.y), width: Math.round(value!.width), height: Math.round(value!.height) };
}

async function seedPaperWithPdf(page: Page, title: string) {
  const created = await page.request.post("/api/papers", { data: { title } });
  expect(created.ok()).toBe(true);
  const paper = (await created.json()).page as { path: string };
  const upload = await page.request.post(`/api/assets?path=${encodeURIComponent(paper.path)}`, {
    multipart: { file: { name: "Catalogue(Final).pdf", mimeType: "application/pdf", buffer: fs.readFileSync(PDF_FIXTURE) } },
  });
  expect(upload.ok()).toBe(true);
  const href = (await upload.json()).asset.url as string;
  const content =
    `<h1>${title}</h1><p>Docked paper notes body</p>` +
    `<p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false" href="${href}" fileName="Catalogue(Final).pdf"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${href}">Catalogue(Final).pdf</span></span></p>`;
  const save = await page.request.put("/api/page", { data: { path: paper.path, title, content } });
  expect(save.ok()).toBe(true);
  return paper.path;
}

async function openPaperPdf(page: Page, paperPath: string, title: string) {
  await page.goto(`/?page=${encodeURIComponent(paperPath)}`);
  await dismissBlockingOverlays(page);
  await expect(page.getByTestId("paper-ownership")).toContainText(title, SLOW);
  await page.locator('[data-file-type="pdf"]').first().click();
  const reader = page.getByTestId("pdf-reader");
  await expect(reader).toBeVisible(SLOW);
  await expect(page.getByTestId("pdf-reader-page-total")).toContainText("/ 3", SLOW);
  return reader;
}

test("paper PDF opens beside docked notes and Companion overlays without displacing them", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  const title = `SN-281 Paper ${testInfo.project.name} ${Date.now().toString(36)}`;
  const paperPath = await seedPaperWithPdf(page, title);
  const isMobile = testInfo.project.name === "mobile";

  const reader = await openPaperPdf(page, paperPath, title);
  const dock = page.getByTestId("paper-notes-dock");
  const notesToggle = page.getByTestId("pdf-reader-paper-notes-toggle");
  const notesEditor = page.frameLocator('[data-testid="paper-notes-frame"]').locator('.tiptap[contenteditable="true"]').first();
  const viewport = page.viewportSize()!;

  if (isMobile) {
    // Narrow: the PDF owns the screen until notes are requested as a layer.
    await expect(notesToggle).toHaveAttribute("aria-pressed", "false");
    expect((await box(reader)).width).toBe(viewport.width);
    await notesToggle.click();
    await expect(dock).toBeVisible();
    await expect(dock).toHaveAttribute("data-mode", "overlay");
    expect((await box(dock)).width).toBe(viewport.width);
    await expect(notesEditor).toContainText("Docked paper notes body", SLOW);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "mobile-notes-overlay.png") });
    await dock.getByRole("button", { name: "Back to PDF" }).click();
    await expect(dock).toBeHidden();
    const readerBefore = await box(reader);
    await page.getByTestId("pdf-reader-companion-toggle").click();
    await expect(page.getByTestId("mobile-ai-sheet")).toBeVisible(SLOW);
    expect(await box(reader)).toEqual(readerBefore);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "mobile-companion-over-pdf.png") });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mobile-ai-sheet")).toBeHidden();
    expect(await box(reader)).toEqual(readerBefore);
  } else {
    // Wide: PDF | notes split at the default width, frames abutting.
    await expect(dock).toBeVisible(SLOW);
    await expect(dock).toHaveAttribute("data-mode", "split");
    await expect(notesToggle).toHaveAttribute("aria-pressed", "true");
    await expect(notesEditor).toContainText("Docked paper notes body", SLOW);
    let readerBox = await box(reader);
    let dockBox = await box(dock);
    expect(dockBox.width).toBe(440);
    expect(readerBox.x + readerBox.width).toBe(dockBox.x);
    expect(dockBox.x + dockBox.width).toBe(viewport.width);

    // Drag the separator 100px left: notes widen, the PDF narrows, and the width persists.
    // The separator straddles the dock's left edge; width = viewport - pointer x.
    await expect(page.getByTestId("paper-notes-resize-handle")).toBeVisible();
    await page.mouse.move(dockBox.x, dockBox.y + 200);
    await page.mouse.down();
    await page.mouse.move(dockBox.x - 100, dockBox.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await box(dock)).width).toBe(540);
    expect(await page.evaluate(() => window.localStorage.getItem("smart-notes-paper-notes-width"))).toBe("540");
    readerBox = await box(reader);
    dockBox = await box(dock);
    expect(readerBox.x + readerBox.width).toBe(dockBox.x);

    // Companion overlays the right edge on its own layer; neither frame moves.
    await page.getByTestId("pdf-reader-companion-toggle").click();
    const rail = page.getByTestId("pdf-reader-ai-sidebar");
    await expect(rail).toBeVisible(SLOW);
    expect(await box(reader)).toEqual(readerBox);
    expect(await box(dock)).toEqual(dockBox);
    const railBox = await box(rail);
    expect(railBox.x).toBeLessThan(dockBox.x + dockBox.width);
    const topmost = await page.evaluate(([x, y]) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest('[data-testid="pdf-reader-ai-sidebar"]') ? "companion" : element?.closest('[data-testid="paper-notes-dock"]') ? "notes" : "other";
    }, [railBox.x + railBox.width / 2, railBox.y + railBox.height / 2]);
    expect(topmost).toBe("companion");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-companion-overlay.png") });
    await page.getByTestId("pdf-reader-companion-toggle").click();
    await expect(rail).toBeHidden();
    expect(await box(reader)).toEqual(readerBox);
    expect(await box(dock)).toEqual(dockBox);

    // Hiding notes returns the whole viewport to the PDF; showing restores the split.
    await notesToggle.click();
    await expect(dock).toBeHidden();
    expect((await box(reader)).width).toBe(viewport.width);
    await notesToggle.click();
    await expect(dock).toBeVisible();
    expect(await box(reader)).toEqual(readerBox);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-split.png") });
  }

  // Edits in the notes frame are saved before the reader closes.
  if (isMobile) await notesToggle.click();
  const edit = `Docked edit ${testInfo.project.name}`;
  await notesEditor.click();
  await notesEditor.press("End");
  await notesEditor.pressSequentially(` ${edit}`);
  if (isMobile) await dock.getByRole("button", { name: "Back to PDF" }).click();
  await page.getByTestId("pdf-reader-close").click();
  await expect(page.getByTestId("pdf-reader")).toBeHidden(SLOW);
  await expect(dock).toHaveCount(0);
  const saved = await page.request.get(`/api/page?path=${encodeURIComponent(paperPath)}`);
  expect((await saved.json()).page.content).toContain(edit);

  if (!isMobile) {
    // Reopening the paper's PDF restores the split at the persisted width.
    await page.locator('[data-file-type="pdf"]').first().click();
    await expect(page.getByTestId("pdf-reader")).toBeVisible(SLOW);
    await expect.poll(async () => (await box(page.getByTestId("paper-notes-dock"))).width, SLOW).toBe(540);
    await page.getByTestId("pdf-reader-close").click();
    await expect(page.getByTestId("pdf-reader")).toBeHidden(SLOW);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(crashes).toEqual([]);
});
