import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { dismissBlockingOverlays } from "./helpers";

/**
 * SN-366: promote a vault PDF to a Bibliography paper from the chip context menu and from the
 * reader's Save as paper, then use the paper reading shell's Back to paper and Back to topic.
 * Pre-fix: right-clicking the chip opened the reader over the menu, the promote dialog rendered
 * under the reader, and the shell had no way back to the paper notes.
 */
const PDF_FIXTURE = path.resolve(__dirname, "fixtures/catalogue-final.pdf");
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-366");
const SLOW = { timeout: 60_000 };

async function seedPageWithPdf(page: Page, title: string, fileName: string) {
  const created = await page.request.post("/api/page", { data: { sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBe(true);
  const article = (await created.json()).page as { path: string };
  const upload = await page.request.post(`/api/assets?path=${encodeURIComponent(article.path)}`, {
    multipart: { file: { name: fileName, mimeType: "application/pdf", buffer: fs.readFileSync(PDF_FIXTURE) } },
  });
  expect(upload.ok()).toBe(true);
  const href = (await upload.json()).asset.url as string;
  const content =
    `<h1>${title}</h1><p>Intro paragraph</p>` +
    `<p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false" href="${href}" fileName="${fileName}"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${href}">${fileName}</span></span></p>` +
    `<p>Closing paragraph</p>`;
  expect((await page.request.put("/api/page", { data: { path: article.path, title, content } })).ok()).toBe(true);
  return article.path;
}

async function pageContent(page: Page, pagePath: string) {
  return (await (await page.request.get(`/api/page?path=${encodeURIComponent(pagePath)}`)).json()).page.content as string;
}

async function paperByTitle(page: Page, title: string) {
  const papers = (await (await page.request.get("/api/papers")).json()).papers as Array<{ id: string; page: { path: string; title: string } }>;
  return papers.find((entry) => entry.page.title === title) ?? null;
}

async function isTopmost(page: Page, testId: string) {
  return page.evaluate((id) => {
    const target = document.querySelector(`[data-testid="${id}"]`);
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + 24);
    return Boolean(hit && target.contains(hit));
  }, testId);
}

test("SN-366: promote vault PDF to paper, then Back to paper and Back to topic from the reading shell", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "chip right-click and the split reading shell are desktop flows");
  test.setTimeout(300_000);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  const stamp = Date.now().toString(36);
  const topicTitle = `SN366 Topic ${stamp}`;
  const paperTitle = `SN366 Paper ${stamp}`;
  const topicPath = await seedPageWithPdf(page, topicTitle, `topic-${stamp}.pdf`);

  // (a1) Chip context menu → Promote to paper: the reader stays closed, the dialog is usable.
  await page.goto(`/?page=${encodeURIComponent(topicPath)}`);
  await dismissBlockingOverlays(page);
  const editor = page.getByTestId("rich-text-editor");
  const chip = editor.locator('[data-file-type="pdf"]').first();
  await expect(chip).toBeVisible(SLOW);
  await chip.click({ button: "right" });
  await page.getByTestId("ctx-promote-pdf").click();
  const dialog = page.getByTestId("promote-pdf-dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("pdf-reader")).toBeHidden();
  await expect(page.getByTestId("promote-pdf-title")).toHaveValue(`topic-${stamp}`);
  await page.getByTestId("promote-pdf-title").fill(paperTitle);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-promote-dialog.png") });
  await page.getByTestId("promote-pdf-submit").click();
  await expect(dialog).toBeHidden(SLOW);
  await expect(page.getByText("Paper created from PDF.")).toBeVisible(SLOW);
  const paper = await paperByTitle(page, paperTitle);
  expect(paper).not.toBeNull();
  const topicContent = await pageContent(page, topicPath);
  // The paper chip lands at the PDF's location (before it), and the original PDF chip stays.
  expect(topicContent.indexOf(`data-paper-id="${paper!.id}"`)).toBeGreaterThan(-1);
  expect(topicContent.indexOf(`data-paper-id="${paper!.id}"`)).toBeLessThan(topicContent.indexOf('data-file-type="pdf"'));
  await expect(editor.locator(`[data-paper-reference="${paper!.id}"]`)).toBeVisible(SLOW);
  await expect(chip).toBeVisible();
  expect(await pageContent(page, paper!.page.path)).toContain('data-file-type="pdf"');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-promoted-chip.png") });

  // (a2) Reader → Save as paper with "remove the original chip": the dialog sits above the reader.
  const savedTitle = `SN366 Saved ${stamp}`;
  const savePath = await seedPageWithPdf(page, `SN366 Save ${stamp}`, `save-${stamp}.pdf`);
  await page.goto(`/?page=${encodeURIComponent(savePath)}`);
  await dismissBlockingOverlays(page);
  await editor.locator('[data-file-type="pdf"]').first().click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible(SLOW);
  await page.getByTestId("pdf-reader-save-as-paper").click();
  await expect(dialog).toBeVisible();
  expect(await isTopmost(page, "promote-pdf-dialog")).toBe(true);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-save-as-paper-over-reader.png") });
  await page.getByTestId("promote-pdf-title").fill(savedTitle);
  await page.getByTestId("promote-pdf-replace-chip").check();
  await page.getByTestId("promote-pdf-submit").click();
  await expect(dialog).toBeHidden(SLOW);
  await expect(page.getByTestId("pdf-reader")).toBeHidden(SLOW);
  const saved = await paperByTitle(page, savedTitle);
  expect(saved).not.toBeNull();
  const saveContent = await pageContent(page, savePath);
  expect(saveContent).toContain(`data-paper-id="${saved!.id}"`);
  expect(saveContent).not.toContain('data-file-type="pdf"');

  // (b1) Paper page → its PDF → Back to paper returns to the paper notes.
  await page.goto(`/?page=${encodeURIComponent(paper!.page.path)}`);
  await dismissBlockingOverlays(page);
  await expect(page.getByTestId("paper-ownership")).toBeVisible(SLOW);
  await editor.locator('[data-file-type="pdf"]').first().click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible(SLOW);
  const topbar = page.getByTestId("paper-reading-topbar");
  const backToPaper = page.getByTestId("paper-reading-back-to-paper");
  await expect(backToPaper).toBeVisible();
  await expect(topbar.getByRole("button")).toHaveText([/Back to paper/, /Back to topic/, /Companion/]);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-reading-shell-topbar.png") });
  await backToPaper.click();
  await expect(page.getByTestId("pdf-reader")).toBeHidden(SLOW);
  await expect(page.getByTestId("paper-ownership")).toBeVisible();
  await expect(page.getByTestId("paper-notes-dock")).toHaveCount(0);

  // (b2) Back to topic from the shell returns to the referring topic page.
  await editor.locator('[data-file-type="pdf"]').first().click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible(SLOW);
  await page.getByTestId("paper-reading-back").click();
  await expect(page.getByTestId("pdf-reader")).toBeHidden(SLOW);
  await expect(page.getByTestId("paper-ownership")).toHaveCount(0, SLOW);
  await expect(editor).toContainText("Intro paragraph", SLOW);
  await expect(editor.locator(`[data-paper-reference="${paper!.id}"]`)).toBeVisible(SLOW);

  // (b3) Owner flow: topic page → paper chip title (open full paper) → PDF → Back to paper keeps the
  // paper notes open, and the paper's Back to topic still returns to this topic page.
  const refChip = editor.locator(`[data-paper-reference="${paper!.id}"]`);
  // The chip title opens the full paper (same openFullPaper path as "Open full paper").
  await refChip.getByRole("button", { name: paperTitle, exact: true }).click();
  await expect(page.getByTestId("paper-ownership")).toBeVisible(SLOW);
  await editor.locator('[data-file-type="pdf"]').first().click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible(SLOW);
  await backToPaper.click();
  await expect(page.getByTestId("pdf-reader")).toBeHidden(SLOW);
  await expect(page.getByTestId("paper-ownership")).toBeVisible(SLOW);
  await expect(page.getByTestId("paper-back-to-topic")).toBeEnabled();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-back-to-paper-notes.png") });
  await page.getByTestId("paper-back-to-topic").click();
  await expect(page.getByTestId("paper-ownership")).toHaveCount(0, SLOW);
  await expect(editor).toContainText("Intro paragraph", SLOW);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-back-to-topic.png") });

  expect(crashes).toEqual([]);
});
