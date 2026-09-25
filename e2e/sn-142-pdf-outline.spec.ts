import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * SN-142 — PDF reader outline/chapter navigation tree.
 *
 * Verifies the two acceptance scenarios against the real EmbedPDF bookmark
 * plugin + PDFium engine:
 *  (1) a PDF with a nested outline exposes chapter/subchapter navigation and
 *      selecting an entry jumps to the target page via the scroll path; and
 *  (2) a PDF with no outline shows no toggle, rail, or empty panel.
 *
 * `outline-book.pdf` is a 3-page fixture whose built-in outline is
 *   Chapter 1 (page 1) > Section 1.1 (page 2); Chapter 2 (page 3).
 * `rect-only.pdf` has no outline.
 */

const OUTLINE_PDF = path.resolve(__dirname, "fixtures/outline-book.pdf");
const NO_OUTLINE_PDF = path.resolve(__dirname, "fixtures/rect-only.pdf");
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/sn-142");

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

test.beforeEach(() => test.setTimeout(300_000));

interface SeedTarget {
  pageTitle: string;
  pagePath: string;
}

async function createEmptyPage(page: Page): Promise<SeedTarget> {
  const pageTitle = `SN142 Outline ${Date.now().toString(36).slice(-6)}`;
  const vaultRes = await page.request.get("/api/vault");
  expect(vaultRes.ok()).toBe(true);
  const tree = (await vaultRes.json()).tree as Array<{
    path: string;
    sections: Array<{ path: string }>;
  }>;
  const notebook = tree.find((n) => n.sections?.length > 0);
  expect(notebook, "a notebook with a section must exist in the e2e vault").toBeTruthy();
  const sectionPath = notebook!.sections[0].path;
  const create = await page.request.post("/api/page", {
    data: { sectionPath, notebookPath: notebook!.path, title: pageTitle, noteType: "text" },
  });
  expect(create.ok()).toBe(true);
  const created = (await create.json()) as { page: { path: string } };
  return { pageTitle, pagePath: created.page.path };
}

async function seedPdf(page: Page, target: SeedTarget, fixture: string, fileName: string): Promise<string> {
  const upload = await page.request.post(`/api/assets?path=${encodeURIComponent(target.pagePath)}`, {
    multipart: {
      file: { name: fileName, mimeType: "application/pdf", buffer: fs.readFileSync(fixture) },
    },
  });
  expect(upload.ok()).toBe(true);
  const href = ((await upload.json()) as { asset: { url: string } }).asset.url;
  const content = `<h1>${target.pageTitle}</h1><p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false" href="${href}" fileName="${fileName}"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${href}">${fileName}</span></span></p>`;
  const save = await page.request.put("/api/page", {
    data: { path: target.pagePath, title: target.pageTitle, content },
  });
  expect(save.ok()).toBe(true);
  return href;
}

async function scaffold(page: Page, fixture: string, fileName: string): Promise<SeedTarget> {
  const target = await createEmptyPage(page);
  await seedPdf(page, target, fixture, fileName);
  await page.addInitScript((pagePath) => {
    window.localStorage.setItem("smart-notes-active-page", pagePath);
  }, target.pagePath);
  await page.goto("/");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole("heading", { name: target.pageTitle })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible({ timeout: 15000 });
  return target;
}

async function openReader(page: Page): Promise<void> {
  // Self-hosted fallback fonts must be reachable for text paint.
  let fontOk = false;
  for (let attempt = 0; attempt < 3 && !fontOk; attempt++) {
    try {
      fontOk = (await page.request.get("/pdf-fonts/latin/NotoSans-Regular.ttf")).ok();
    } catch {
      await page.waitForTimeout(400 * (attempt + 1));
    }
  }
  expect(fontOk).toBe(true);
  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".pdf-reader__page-frame").first()).toBeVisible({ timeout: 30000 });
}

test("nested outline exposes chapter navigation and jumps to target pages", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  await scaffold(page, OUTLINE_PDF, "outline-book.pdf");
  await openReader(page);
  await expect(page.getByTestId("pdf-reader-page-total")).toContainText("/ 3", { timeout: 30000 });

  // Outline affordance is present because the document has a bookmark tree.
  const toggle = page.getByTestId("pdf-reader-outline-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();

  const outline = page.getByTestId("pdf-reader-outline");
  await expect(outline).toBeVisible();

  const links = page.getByTestId("pdf-reader-outline-link");
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveText("Chapter 1");
  await expect(links.nth(1)).toHaveText("Section 1.1");
  await expect(links.nth(2)).toHaveText("Chapter 2");

  // On mobile the outline is an overlay drawer — it must not shrink the
  // document viewport (viewport still spans the reader width).
  if (mobile) {
    const readerBox = await page.getByTestId("pdf-reader").boundingBox();
    const vpBox = await page.getByTestId("pdf-reader-viewport").boundingBox();
    expect(readerBox && vpBox).toBeTruthy();
    expect(vpBox!.width).toBeGreaterThanOrEqual(readerBox!.width - 1);
  }

  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-outline-open.png`) });

  // Selecting a subchapter jumps to its page via the scroll path.
  await page.getByTestId("pdf-reader-outline-link").nth(1).click();
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("2", { timeout: 15000 });

  // On mobile the drawer closes after selection; reopen for the next jump.
  if (mobile) {
    await expect(outline).toBeHidden();
    await toggle.click();
    await expect(outline).toBeVisible();
  }
  await page.getByTestId("pdf-reader-outline-link").nth(2).click();
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("3", { timeout: 15000 });
});

test("document with no outline shows no navigation chrome", async ({ page }) => {
  await scaffold(page, NO_OUTLINE_PDF, "rect-only.pdf");
  await openReader(page);
  // No toggle, no rail, no empty panel.
  await expect(page.getByTestId("pdf-reader-outline-toggle")).toHaveCount(0);
  await expect(page.getByTestId("pdf-reader-outline")).toHaveCount(0);
});
