/**
 * SN-151 throwaway — reproduce the owner's DESKTOP blank-page state at a
 * remembered numeric zoom and dump the in-app render diagnostics ring so we can
 * see where paint breaks without a device round-trip.
 */
import { test, expect } from "@playwright/test";
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
const ZOOM = Number(process.env.SN151_ZOOM || 1.99);

test.beforeEach(() => test.setTimeout(600_000));

test.beforeAll(() => {
  expect(fs.existsSync(SRC_PDF), `missing source PDF at ${SRC_PDF}`).toBe(true);
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const dest = path.join(ASSETS_DIR, PDF_NAME);
  if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(SRC_PDF).size) {
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

test("desktop: dump render diagnostics at remembered numeric zoom", async ({ page }) => {
  await page.addInitScript(
    ({ activePath, href, zoom }) => {
      window.localStorage.setItem("smart-notes-active-page", activePath);
      window.localStorage.setItem(
        `smart-notes:pdf-reader:${href}`,
        JSON.stringify({ page: 1, zoom })
      );
    },
    { activePath: PAGE_PATH, href: HREF, zoom: ZOOM }
  );

  await page.goto("/");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 30_000 });

  // Let the render pipeline + diagnostics run through their timers.
  await page.waitForTimeout(13_000);

  const ring = await page.evaluate(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem("smart-notes.pdf-render-debug.v1") ?? "[]"
      );
    } catch {
      return [];
    }
  });

  console.log("=== PDF RENDER DIAGNOSTICS RING ===");
  for (const e of ring) {
    console.log(`${e.tag}\t${JSON.stringify(e.fields)}`);
  }
  console.log("=== END RING (", ring.length, "entries) ===");

  const domState = await page.evaluate(() => {
    const imgs = Array.from(
      document.querySelectorAll<HTMLImageElement>(".pdf-reader__page-frame img")
    );
    return {
      frames: document.querySelectorAll(".pdf-reader__page-frame").length,
      imgs: imgs.length,
      loaded: imgs.filter((i) => i.naturalWidth > 0).length,
      canvases: document.querySelectorAll(".pdf-reader__page-frame canvas").length,
    };
  });
  console.log("DOM STATE:", JSON.stringify(domState));
});
