/**
 * SN-151 — end-to-end open timing for the Deep Learning book.
 * Measures click → first painted tile for cold + warm (cache) opens.
 * Target: warm reopen well under 5s.
 */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const SRC_PDF = path.resolve(
  __dirname,
  "../vault/AI/Learning/deep-learning-book.assets/Deep.Learning.for.Coders.with.fastai.and.PyTorch_copy-2.pdf"
);
const VAULT = path.resolve(__dirname, "../.e2e-vault");
const NOTEBOOK = "Learning";
const SECTION = "Books";
const PAGE = "deep-learning-e2e";
const PDF_NAME = "Deep.Learning.for.Coders.with.fastai.and.PyTorch_copy-2.pdf";
const PAGE_PATH = `${NOTEBOOK}/${SECTION}/${PAGE}.html`;
const ASSETS_DIR = path.join(VAULT, NOTEBOOK, SECTION, `${PAGE}.assets`);
const PAGE_FILE = path.join(VAULT, NOTEBOOK, SECTION, `${PAGE}.html`);
const HREF = `/vault/${NOTEBOOK}/${SECTION}/${PAGE}.assets/${PDF_NAME}`;

test.beforeEach(() => test.setTimeout(600_000));

test.beforeAll(() => {
  expect(fs.existsSync(SRC_PDF), `missing source PDF at ${SRC_PDF}`).toBe(true);
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const dest = path.join(ASSETS_DIR, PDF_NAME);
  if (
    !fs.existsSync(dest) ||
    fs.statSync(dest).size !== fs.statSync(SRC_PDF).size
  ) {
    fs.copyFileSync(SRC_PDF, dest);
  }
  fs.writeFileSync(
    PAGE_FILE,
    [
      "---",
      "title: Deep Learning E2E",
      "created: 2026-07-22T00:00:00.000Z",
      "updated: 2026-07-22T00:00:00.000Z",
      "---",
      `<h1>Deep Learning E2E</h1><p><span href="${HREF}" filename="${PDF_NAME}" data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${HREF}">${PDF_NAME}</span></span></p>`,
    ].join("\n"),
    "utf8"
  );
});

async function gotoPage(page: Page) {
  await page.addInitScript(
    ({ activePath }) => {
      window.localStorage.setItem("smart-notes-active-page", activePath);
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("smart-notes:pdf-reader:")) {
          window.localStorage.removeItem(key);
        }
      }
    },
    { activePath: PAGE_PATH }
  );
  await page.goto("/");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible({
    timeout: 30_000,
  });
}

async function openAndTime(page: Page, label: string) {
  const t0 = Date.now();
  console.log(`[${label}] click`);
  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 120_000 });
  const readerVisibleMs = Date.now() - t0;
  console.log(`[${label}] readerVisibleMs=${readerVisibleMs}`);

  await expect
    .poll(
      async () => {
        const text =
          (await page.getByTestId("pdf-reader-page-total").textContent().catch(() => "")) ??
          "";
        const match = text.match(/\/\s*(\d+)/);
        return match ? Number(match[1]) : 0;
      },
      { timeout: 180_000 }
    )
    .toBeGreaterThan(100);
  const pagerLiveMs = Date.now() - t0;
  console.log(`[${label}] pagerLiveMs=${pagerLiveMs}`);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const imgs = document.querySelectorAll<HTMLImageElement>(
            ".pdf-reader__page-frame img, .pdf-reader__viewport img"
          );
          if (Array.from(imgs).some((img) => img.naturalWidth > 0)) return true;
          return document.querySelectorAll(".pdf-reader__page-frame canvas").length > 0;
        }),
      { timeout: 180_000, message: `${label}: first painted tile` }
    )
    .toBe(true);
  const firstPaintMs = Date.now() - t0;
  console.log(`[${label}] firstPaintMs=${firstPaintMs}`);

  const diagTail = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem("smart-notes.pdf-render-debug.v1");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(-20) : [];
    } catch {
      return [];
    }
  });
  console.log(`[${label}] diag`, JSON.stringify(diagTail).slice(0, 2500));

  return {
    marks: { readerVisibleMs, pagerLiveMs, firstPaintMs },
    diagTail,
  };
}

async function closeReader(page: Page) {
  const back = page.getByTestId("pdf-reader-back");
  if (await back.isVisible().catch(() => false)) {
    await back.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("pdf-reader")).toHaveCount(0, {
    timeout: 30_000,
  });
}

test("desktop: cold then warm open timing for Deep Learning book", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop timing gate");

  await gotoPage(page);

  await page.evaluate(async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("smart-notes-vault-pdfs-"))
        .map((k) => caches.delete(k))
    );
  });

  const cold = await openAndTime(page, "cold");
  expect(cold.marks.firstPaintMs).toBeGreaterThan(0);
  await closeReader(page);

  const warm = await openAndTime(page, "warm");
  expect(warm.marks.firstPaintMs).toBeGreaterThan(0);

  console.log(
    JSON.stringify(
      {
        coldMs: cold.marks.firstPaintMs,
        warmMs: warm.marks.firstPaintMs,
        warmPagerMs: warm.marks.pagerLiveMs,
        warmReaderMs: warm.marks.readerVisibleMs,
      },
      null,
      2
    )
  );

  expect(
    warm.marks.firstPaintMs,
    `warm reopen firstPaint ${warm.marks.firstPaintMs}ms must be < 5000ms`
  ).toBeLessThan(5000);
});
