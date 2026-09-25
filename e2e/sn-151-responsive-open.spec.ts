/**
 * SN-151 — the reader must stay RESPONSIVE while the Deep Learning book opens
 * and paints, on desktop and mobile viewports.
 *
 * Reproduces the owner-reported failure cluster:
 *  1. UI frozen while pages render (main-thread long tasks / stalled rAF)
 *  2. Scroll dead during/after first paint
 *  3. Only one page paints — other visible frames stay blank
 *  4. Toolbar vanishes once painting settles (late-delivered tap toggles chrome)
 *  5. Exit → reopen restarts the whole freeze
 *
 * Budgets: warm reopen first paint < 3s (owner target "well under 5s"),
 * cold first paint < 12s on localhost, no main-thread task > 2.5s ever.
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
/**
 * The owner's real book carries a ~3.4MB annotation sidecar (SN-136 stylus
 * work). Importing it is part of every open — the harness must include it.
 */
const SRC_SIDECAR = `${SRC_PDF}.annotations.json`;

/** No single main-thread task may exceed this — the freeze was 30–60s+. */
const MAX_LONG_TASK_MS = 2_500;
const COLD_PAINT_BUDGET_MS = 12_000;
const WARM_PAINT_BUDGET_MS = 3_000;
/** Scroll must move the pager and paint the newly visible pages within this. */
const SCROLL_RESPONSE_BUDGET_MS = 10_000;
const SCROLL_PAINT_BUDGET_MS = 20_000;

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
  expect(
    fs.existsSync(SRC_SIDECAR),
    `missing annotation sidecar at ${SRC_SIDECAR}`
  ).toBe(true);
  fs.copyFileSync(SRC_SIDECAR, path.join(ASSETS_DIR, `${PDF_NAME}.annotations.json`));
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

declare global {
  interface Window {
    __snPerf?: {
      longTasks: number[];
      maxLongTaskMs: number;
      maxRafGapMs: number;
      lastRaf: number;
    };
  }
}

async function gotoPage(page: Page) {
  await page.addInitScript(
    ({ activePath }) => {
      window.localStorage.setItem("smart-notes-active-page", activePath);
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("smart-notes:pdf-reader:")) {
          window.localStorage.removeItem(key);
        }
      }
      // Main-thread health instrumentation. Long Tasks API reports any task
      // over 50ms with its full duration; the rAF heartbeat catches stalls the
      // observer can only report after the task finally yields.
      const perf = {
        longTasks: [] as number[],
        maxLongTaskMs: 0,
        maxRafGapMs: 0,
        lastRaf: 0,
      };
      window.__snPerf = perf;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const ms = Math.round(entry.duration);
            perf.longTasks.push(ms);
            if (ms > perf.maxLongTaskMs) perf.maxLongTaskMs = ms;
          }
        }).observe({ type: "longtask", buffered: true });
      } catch {
        // longtask unsupported — rAF gap still catches freezes
      }
      const tick = (ts: number) => {
        if (perf.lastRaf) {
          const gap = Math.round(ts - perf.lastRaf);
          if (gap > perf.maxRafGapMs) perf.maxRafGapMs = gap;
        }
        perf.lastRaf = ts;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
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

async function resetPerf(page: Page) {
  await page.evaluate(() => {
    const perf = window.__snPerf;
    if (!perf) return;
    perf.longTasks = [];
    perf.maxLongTaskMs = 0;
    perf.maxRafGapMs = 0;
    perf.lastRaf = 0;
  });
}

async function readPerf(page: Page) {
  return page.evaluate(() => {
    const perf = window.__snPerf;
    return {
      maxLongTaskMs: perf?.maxLongTaskMs ?? 0,
      maxRafGapMs: perf?.maxRafGapMs ?? 0,
      longTaskCount: perf?.longTasks.length ?? 0,
      worstFive: [...(perf?.longTasks ?? [])].sort((a, b) => b - a).slice(0, 5),
    };
  });
}

/** Visible page frames vs how many of them have a painted tile img. */
async function paintedVisibleFrames(page: Page) {
  return page.evaluate(() => {
    const vp = document.querySelector('[data-testid="pdf-reader-viewport"]');
    if (!vp) return { visible: 0, painted: 0 };
    const vpRect = vp.getBoundingClientRect();
    const frames = Array.from(
      document.querySelectorAll<HTMLElement>(".pdf-reader__page-frame")
    );
    const visible = frames.filter((frame) => {
      const r = frame.getBoundingClientRect();
      return r.bottom > vpRect.top + 12 && r.top < vpRect.bottom - 12 && r.height > 0;
    });
    const painted = visible.filter((frame) =>
      Array.from(frame.querySelectorAll("img")).some(
        (img) => img.complete && img.naturalWidth > 8 && img.naturalHeight > 8
      )
    );
    return { visible: visible.length, painted: painted.length };
  });
}

async function openAndVerifyResponsive(
  page: Page,
  label: string,
  paintBudgetMs: number
) {
  await resetPerf(page);
  const t0 = Date.now();
  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 60_000 });

  // Document open — pager proves parse completed.
  await expect
    .poll(
      async () => {
        const text =
          (await page
            .getByTestId("pdf-reader-page-total")
            .textContent()
            .catch(() => "")) ?? "";
        const match = text.match(/\/\s*(\d+)/);
        return match ? Number(match[1]) : 0;
      },
      { timeout: 180_000, message: `${label}: pager must go live` }
    )
    .toBeGreaterThan(100);
  const pagerLiveMs = Date.now() - t0;

  // First painted tile — the owner-facing "the book is open" moment.
  await expect
    .poll(async () => (await paintedVisibleFrames(page)).painted, {
      timeout: 120_000,
      message: `${label}: first visible page must paint`,
    })
    .toBeGreaterThan(0);
  const firstPaintMs = Date.now() - t0;

  // ALL visible frames must paint, not just page 1.
  await expect
    .poll(async () => paintedVisibleFrames(page), {
      timeout: SCROLL_PAINT_BUDGET_MS,
      message: `${label}: every visible frame must paint`,
    })
    .toEqual(expect.objectContaining({ painted: expect.any(Number) }));
  await expect
    .poll(
      async () => {
        const { visible, painted } = await paintedVisibleFrames(page);
        return visible > 0 && painted === visible;
      },
      {
        timeout: SCROLL_PAINT_BUDGET_MS,
        message: `${label}: blank sibling frames — only part of the viewport painted`,
      }
    )
    .toBe(true);

  // Main thread must never have frozen. The reported hang was 30–60s+; any
  // single task beyond MAX_LONG_TASK_MS reproduces the "cannot scroll" state.
  const perfAtPaint = await readPerf(page);
  console.log(`[${label}] pagerLiveMs=${pagerLiveMs} firstPaintMs=${firstPaintMs}`, perfAtPaint);
  expect(
    perfAtPaint.maxLongTaskMs,
    `${label}: main-thread task of ${perfAtPaint.maxLongTaskMs}ms froze the UI (worst: ${perfAtPaint.worstFive.join(",")})`
  ).toBeLessThan(MAX_LONG_TASK_MS);
  expect(
    perfAtPaint.maxRafGapMs,
    `${label}: rAF stalled ${perfAtPaint.maxRafGapMs}ms — UI frozen`
  ).toBeLessThan(MAX_LONG_TASK_MS);

  expect(
    firstPaintMs,
    `${label}: first paint ${firstPaintMs}ms exceeds ${paintBudgetMs}ms budget`
  ).toBeLessThan(paintBudgetMs);

  // Scroll must respond promptly and newly revealed pages must paint.
  const pageInput = page.getByTestId("pdf-reader-page-input");
  const beforePage = Number((await pageInput.inputValue().catch(() => "1")) || "1");
  const viewport = page.getByTestId("pdf-reader-viewport");
  const box = await viewport.boundingBox();
  expect(box, `${label}: viewport must have a box`).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const scrollStarted = Date.now();
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(120);
  }
  await expect
    .poll(
      async () => Number((await pageInput.inputValue().catch(() => "0")) || "0"),
      {
        timeout: SCROLL_RESPONSE_BUDGET_MS,
        message: `${label}: pager did not advance after scrolling — scroll is dead`,
      }
    )
    .toBeGreaterThan(beforePage);
  const scrollResponseMs = Date.now() - scrollStarted;

  await expect
    .poll(
      async () => {
        const { visible, painted } = await paintedVisibleFrames(page);
        return visible > 0 && painted === visible;
      },
      {
        timeout: SCROLL_PAINT_BUDGET_MS,
        message: `${label}: pages revealed by scrolling stayed blank`,
      }
    )
    .toBe(true);
  const scrollPaintMs = Date.now() - scrollStarted;

  // Chrome must still be up — no late-delivered tap may have toggled it away.
  await expect(
    page.getByTestId("pdf-reader-bar"),
    `${label}: toolbar disappeared after painting settled`
  ).toBeVisible();

  const perfFinal = await readPerf(page);
  console.log(
    `[${label}] scrollResponseMs=${scrollResponseMs} scrollPaintMs=${scrollPaintMs}`,
    perfFinal
  );
  expect(
    perfFinal.maxLongTaskMs,
    `${label}: main-thread task of ${perfFinal.maxLongTaskMs}ms during scroll/paint (worst: ${perfFinal.worstFive.join(",")})`
  ).toBeLessThan(MAX_LONG_TASK_MS);

  return { pagerLiveMs, firstPaintMs, scrollResponseMs, scrollPaintMs };
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

for (const project of ["desktop", "mobile"]) {
  test(`${project}: Deep Learning book opens responsive, paints fully, survives reopen`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== project, `${project} responsiveness gate`);

    await gotoPage(page);

    // Cold: drop the PDF Cache Storage copy so the open includes the download.
    await page.evaluate(async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("smart-notes-vault-pdfs-"))
          .map((k) => caches.delete(k))
      );
    });

    const cold = await openAndVerifyResponsive(page, `${project}-cold`, COLD_PAINT_BUDGET_MS);
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${project}-responsive-cold.png`),
    });
    await closeReader(page);

    // Warm reopen — the owner's every-time path; this is the <5s target.
    const warm = await openAndVerifyResponsive(page, `${project}-warm`, WARM_PAINT_BUDGET_MS);
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${project}-responsive-warm.png`),
    });
    await closeReader(page);

    // Second reopen — "exiting pdf mode and coming back restarts the issue".
    const warm2 = await openAndVerifyResponsive(page, `${project}-warm2`, WARM_PAINT_BUDGET_MS);

    console.log(
      JSON.stringify(
        {
          project,
          coldFirstPaintMs: cold.firstPaintMs,
          warmFirstPaintMs: warm.firstPaintMs,
          warm2FirstPaintMs: warm2.firstPaintMs,
        },
        null,
        2
      )
    );
  });
}
