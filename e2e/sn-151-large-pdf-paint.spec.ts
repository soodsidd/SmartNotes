/**
 * SN-151 — large vault PDF must paint in-app on a mobile viewport.
 *
 * Uses the Deep Learning book (same file the owner opens). Asserts painted
 * <img> tiles AFTER the pager is live so the gate is client paint, not network.
 */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const SRC_PDF = path.resolve(
  __dirname,
  "../vault/AI/Learning/deep-learning-book.assets/Deep.Learning.for.Coders.with.fastai.and.PyTorch_copy-2.pdf"
);
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/sn-151");
const VAULT = path.resolve(__dirname, "../.e2e-vault");
const NOTEBOOK = "Learning";
const SECTION = "Books";
const PAGE = "deep-learning-e2e";
const PDF_NAME = "Deep.Learning.for.Coders.with.fastai.and.PyTorch_copy-2.pdf";
const PAGE_PATH = `${NOTEBOOK}/${SECTION}/${PAGE}.html`;
const ASSETS_DIR = path.join(VAULT, NOTEBOOK, SECTION, `${PAGE}.assets`);
const PAGE_FILE = path.join(VAULT, NOTEBOOK, SECTION, `${PAGE}.html`);
const HREF = `/vault/${NOTEBOOK}/${SECTION}/${PAGE}.assets/${PDF_NAME}`;

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

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
  const hrefAttr = HREF;
  fs.writeFileSync(
    PAGE_FILE,
    [
      "---",
      "title: Deep Learning E2E",
      "created: 2026-07-22T00:00:00.000Z",
      "updated: 2026-07-22T00:00:00.000Z",
      "---",
      `<h1>Deep Learning E2E</h1><p><span href="${hrefAttr}" filename="${PDF_NAME}" data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${hrefAttr}">${PDF_NAME}</span></span></p>`,
    ].join("\n"),
    "utf8"
  );
});

async function openDeepLearningReader(
  page: Page,
  opts?: { rememberedZoom?: number }
) {
  const rememberedZoom = opts?.rememberedZoom;
  await page.addInitScript(
    ({ activePath, href, zoom }) => {
      window.localStorage.setItem("smart-notes-active-page", activePath);
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("smart-notes:pdf-reader:")) {
          window.localStorage.removeItem(key);
        }
      }
      // Numeric remembered zoom is the Android stuck-gate failure mode:
      // EmbedPDF only auto-releases the viewport gate for Fit*/Automatic.
      if (typeof zoom === "number") {
        window.localStorage.setItem(
          `smart-notes:pdf-reader:${href}`,
          JSON.stringify({ page: 1, zoom })
        );
      }
    },
    { activePath: PAGE_PATH, href: HREF, zoom: rememberedZoom ?? null }
  );

  await page.goto("/");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByRole("heading", { name: "Deep Learning E2E" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible({
    timeout: 30_000,
  });

  const fontRes = await page.request.get("/pdf-fonts/latin/NotoSans-Regular.ttf");
  expect(fontRes.ok()).toBe(true);
  const wasmRes = await page.request.get("/pdfium.wasm");
  expect(wasmRes.ok()).toBe(true);

  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 30_000 });
}

test("mobile: Deep Learning book paints in-app after pager is live", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile paint regression");

  // Reproduce the Android failure mode: the EmbedPDF viewport's initial
  // ResizeObserver delivery can be missed after a fast cached open. The reader
  // must seed its viewport metrics and mount page frames independently.
  await page.addInitScript(() => {
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class PdfViewportFilteredResizeObserver {
      private readonly inner: ResizeObserver;

      constructor(callback: ResizeObserverCallback) {
        this.inner = new NativeResizeObserver((entries, observer) => {
          const visibleEntries = entries.filter(
            (entry) =>
              !(entry.target as HTMLElement).classList?.contains(
                "pdf-reader__viewport"
              )
          );
          if (visibleEntries.length > 0) callback(visibleEntries, observer);
        });
      }

      observe(target: Element, options?: ResizeObserverOptions) {
        this.inner.observe(target, options);
      }

      unobserve(target: Element) {
        this.inner.unobserve(target);
      }

      disconnect() {
        this.inner.disconnect();
      }
    } as typeof ResizeObserver;
  });

  await openDeepLearningReader(page, {
    rememberedZoom: Number(process.env.SN151_ZOOM || 1.25),
  });

  // Phase A — document open (parse). Network may dominate here.
  await expect
    .poll(
      async () => {
        const text =
          (await page.getByTestId("pdf-reader-page-total").textContent()) ?? "";
        const match = text.match(/\/\s*(\d+)/);
        return match ? Number(match[1]) : 0;
      },
      { timeout: 300_000, message: "expected large PDF page count" }
    )
    .toBeGreaterThan(100);

  const totalText = await page.getByTestId("pdf-reader-page-total").textContent();
  console.log("pager live:", totalText);

  // Phase B — client paint only. Clock starts after pager is live so a slow
  // download cannot hide a paint hang.
  const paintStarted = Date.now();
  const frame = page.locator(".pdf-reader__page-frame").first();
  await expect
    .poll(
      async () => {
        const vp = page.getByTestId("pdf-reader-viewport");
        const box = await vp.boundingBox().catch(() => null);
        const frames = await page.locator(".pdf-reader__page-frame").count();
        return { frames, h: box?.height ?? 0, w: box?.width ?? 0 };
      },
      { timeout: 60_000 }
    )
    .toMatchObject({ frames: expect.any(Number) });

  await expect
    .poll(async () => page.locator(".pdf-reader__page-frame").count(), {
      timeout: 60_000,
      message: "expected scroller page frames (viewport must be non-zero)",
    })
    .toBeGreaterThan(0);

  const vpBox = await page.getByTestId("pdf-reader-viewport").boundingBox();
  console.log("viewport-box", vpBox);
  expect(vpBox?.height ?? 0, "viewport height must be > 0 for paint").toBeGreaterThan(
    100
  );

  await expect(frame).toBeVisible({ timeout: 30_000 });

  await expect
    .poll(
      async () => {
        const imgs = frame.locator("img");
        const count = await imgs.count();
        if (count === 0) return 0;
        const ok = await imgs.first().evaluate((img) => {
          const el = img as HTMLImageElement;
          return el.complete && el.naturalWidth > 8 && el.naturalHeight > 8
            ? el.naturalWidth
            : 0;
        });
        return ok;
      },
      {
        timeout: 120_000,
        message: "expected painted tile img after pager live (client paint)",
      }
    )
    .toBeGreaterThan(8);

  const paintMs = Date.now() - paintStarted;
  console.log(`paint-after-pager-ms=${paintMs}`);
  expect(paintMs, "paint should not hang after document is open").toBeLessThan(
    90_000
  );

  // Portrait mobile must keep zoom steppers (title removed to free space).
  await expect(page.getByTestId("pdf-reader-zoom-in")).toBeVisible();
  await expect(page.getByTestId("pdf-reader-zoom-out")).toBeVisible();
  await expect(page.getByTestId("pdf-reader-title")).toHaveCount(0);

  // Gate-bootstrap must not re-apply remembered zoom after the user zooms.
  const beforeZoom = (await page.getByTestId("pdf-reader-zoom").textContent()) ?? "";
  await page.getByTestId("pdf-reader-zoom-in").click();
  await expect
    .poll(async () => (await page.getByTestId("pdf-reader-zoom").textContent()) ?? "", {
      timeout: 5_000,
      message: "zoom-in should change the displayed percent",
    })
    .not.toBe(beforeZoom);
  const afterZoom = (await page.getByTestId("pdf-reader-zoom").textContent()) ?? "";
  await page.waitForTimeout(1_000);
  expect(
    (await page.getByTestId("pdf-reader-zoom").textContent()) ?? "",
    "zoom must not snap back after gate-bootstrap retries"
  ).toBe(afterZoom);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "mobile-deep-learning-painted.png"),
  });
});
