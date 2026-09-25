import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const PDF_FIXTURE = path.resolve(__dirname, "fixtures/catalogue-final.pdf");
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/sn-135");
const E2E_STATE_DIR = path.resolve(__dirname, "../.e2e-state");
const PORTABLE_FIXTURE_ROOT = path.resolve(__dirname, "../.e2e-portable-vault");
const PORTABLE_NOTEBOOK_ID = "8d9fbe2b";

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// Dev-mode first-compile + repeated WASM engine init (React StrictMode
// double-mounts in dev) need generous headroom.
test.beforeEach(() => test.setTimeout(300_000));

test.beforeAll(() => {
  seedExistingPortableVaultPdf();
});

interface SeedTarget {
  pageTitle: string;
  pagePath: string;
}

interface SeededPdfTarget extends SeedTarget {
  href: string;
  vaultPath: string;
}

/** Create an empty note deterministically via the REST API. */
async function createEmptyPage(page: Page): Promise<SeedTarget> {
  const pageTitle = `SN135 Catalogue ${Date.now().toString(36).slice(-6)}`;

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

  return {
    pageTitle,
    pagePath: created.page.path,
  };
}

async function seedPdfAttachment(page: Page, target: SeedTarget): Promise<string> {
  const upload = await page.request.post(`/api/assets?path=${encodeURIComponent(target.pagePath)}`, {
    multipart: {
      file: {
        name: "Catalogue(Final).pdf",
        mimeType: "application/pdf",
        buffer: fs.readFileSync(PDF_FIXTURE),
      },
    },
  });
  expect(upload.ok()).toBe(true);
  const uploaded = (await upload.json()) as { asset: { url: string } };
  const href = uploaded.asset.url;
  const content = `<h1>${target.pageTitle}</h1><p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false" href="${href}" fileName="Catalogue(Final).pdf"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${href}">Catalogue(Final).pdf</span></span></p>`;

  const save = await page.request.put("/api/page", {
    data: {
      path: target.pagePath,
      title: target.pageTitle,
      content,
    },
  });
  expect(save.ok()).toBe(true);
  return href;
}

async function scaffoldPageWithPdf(page: Page): Promise<SeededPdfTarget> {
  const target = await createEmptyPage(page);
  const href = await seedPdfAttachment(page, target);
  await page.addInitScript((pagePath) => {
    window.localStorage.setItem("smart-notes-active-page", pagePath);
  }, target.pagePath);

  await page.goto("/");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole("heading", { name: target.pageTitle })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible({ timeout: 15000 });
  return {
    ...target,
    href,
    vaultPath: decodeURIComponent(href.replace(/^\/vault\//, "")),
  };
}

function seedExistingPortableVaultPdf(): void {
  const pageTitle = "SN135 Existing Portable Catalogue";
  const sectionName = "Config";
  const pageName = "existing-catalogue";
  const assetsDir = path.join(PORTABLE_FIXTURE_ROOT, sectionName, `${pageName}.assets`);
  const pdfPath = path.join(assetsDir, "Catalogue(Final).pdf");
  const href = `/vault/%2B${PORTABLE_NOTEBOOK_ID}/${sectionName}/${pageName}.assets/Catalogue(Final).pdf`;

  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(E2E_STATE_DIR, { recursive: true });
  fs.copyFileSync(PDF_FIXTURE, pdfPath);
  fs.writeFileSync(
    path.join(E2E_STATE_DIR, "notebook-registry.json"),
    `${JSON.stringify(
      {
        version: 1,
        notebooks: [
          {
            id: PORTABLE_NOTEBOOK_ID,
            name: "Higher Ground",
            rootPath: PORTABLE_FIXTURE_ROOT,
            addedAt: "2026-07-17T00:00:00.000Z",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(PORTABLE_FIXTURE_ROOT, sectionName, `${pageName}.html`),
    [
      "---",
      `title: ${pageTitle}`,
      "created: 2026-07-17T00:00:00.000Z",
      "updated: 2026-07-17T00:00:00.000Z",
      "---",
      `<h1>${pageTitle}</h1><p><span href="${href}" filename="Catalogue(Final).pdf" data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${href}">Catalogue(Final).pdf</span></span></p>`,
    ].join("\n"),
    "utf8"
  );
}

async function scaffoldExistingPortableVaultPdf(page: Page): Promise<void> {
  const pageTitle = "SN135 Existing Portable Catalogue";
  const pagePath = `+${PORTABLE_NOTEBOOK_ID}/Config/existing-catalogue.html`;

  await page.addInitScript((activePagePath) => {
    window.localStorage.setItem("smart-notes-active-page", activePagePath);
  }, pagePath);

  await page.goto("/");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole("heading", { name: pageTitle })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible({ timeout: 15000 });
}

async function openReader(page: Page) {
  // Self-hosted fallback fonts must be reachable for text paint.
  let fontOk = false;
  for (let attempt = 0; attempt < 3 && !fontOk; attempt++) {
    try {
      const fontRes = await page.request.get("/pdf-fonts/latin/NotoSans-Regular.ttf");
      fontOk = fontRes.ok();
    } catch {
      await page.waitForTimeout(400 * (attempt + 1));
    }
  }
  expect(fontOk, "expected self-hosted PDF font at /pdf-fonts/latin/NotoSans-Regular.ttf").toBe(
    true
  );

  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("pdf-reader-page-total")).toContainText("/ 3", {
    timeout: 30000,
  });
  await expect(page.locator(".pdf-reader__page-frame").first()).toBeVisible({
    timeout: 30000,
  });
  // Guard blank-page regression: page count alone is not enough (SN-148).
  const frame = page.locator(".pdf-reader__page-frame").first();
  await expect
    .poll(async () => frame.locator("img").count(), { timeout: 45000 })
    .toBeGreaterThan(0);
  const painted = await frame.locator("img").first().evaluate((img) => {
    const el = img as HTMLImageElement;
    return el.naturalWidth > 0 && el.naturalHeight > 0 && el.complete;
  });
  expect(painted).toBe(true);
}

test("immersive reader opens full-viewport and renders without horizontal clip (desktop)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only");
  await page.setViewportSize({ width: 1280, height: 900 });
  await scaffoldPageWithPdf(page);
  await openReader(page);

  const reader = page.getByTestId("pdf-reader");
  const viewport = page.getByTestId("pdf-reader-viewport");

  // The reader surface fills the viewport width (immersive, not a side pane).
  const box = await reader.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(1200);

  // A rendered page canvas/image is present and fits within the viewport
  // width — no horizontal clipping of page content.
  const pageFrame = page.locator(".pdf-reader__page-frame").first();
  await expect(pageFrame).toBeVisible({ timeout: 30000 });
  const frameBox = await pageFrame.boundingBox();
  const vpBox = await viewport.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(vpBox).not.toBeNull();
  // Fit-width: page frame is no wider than the scroll viewport.
  expect(frameBox!.width).toBeLessThanOrEqual(vpBox!.width + 1);

  // Page pixels must actually paint (guards DocNotOpen / blank-page regressions).
  const pageImage = pageFrame.locator("img").first();
  await expect(pageImage).toBeVisible({ timeout: 30000 });
  await expect
    .poll(async () => pageImage.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-reader-page1.png") });

  // Navigate to the wide landscape page (page 2) and confirm it still fits.
  await page.getByTestId("pdf-reader-next").click();
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("2");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-reader-page2-wide.png") });
});

test("immersive reader is a maximized surface with collapsible chrome (mobile)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only");
  await scaffoldPageWithPdf(page);
  await openReader(page);

  const reader = page.getByTestId("pdf-reader");
  const box = await reader.boundingBox();
  const vp = page.viewportSize()!;
  expect(box).not.toBeNull();
  // Full-viewport immersive surface.
  expect(box!.width).toBeGreaterThanOrEqual(vp.width - 1);
  expect(box!.height).toBeGreaterThanOrEqual(vp.height - 1);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "mobile-reader-chrome-visible.png") });

  // Single collapsible bar — tapping the document hides the chrome to maximize
  // the reading area (no permanent/nested toolbar stack).
  await page.getByTestId("pdf-reader-viewport").click({ position: { x: 40, y: 300 } });
  await expect(page.getByTestId("pdf-reader-bar")).toHaveAttribute("data-hidden", "true");
  // A minimal back affordance always remains available.
  await expect(page.getByTestId("pdf-reader-back")).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "mobile-reader-chrome-hidden.png") });
});

test("outer tap zones turn pages for desktop click and mobile tap (SN-242)", async ({
  page,
}, testInfo) => {
  await scaffoldPageWithPdf(page);
  await openReader(page);
  const viewport = page.getByTestId("pdf-reader-viewport");
  const pageInput = page.getByTestId("pdf-reader-page-input");
  await pageInput.fill("1");
  await pageInput.press("Enter");
  await expect(pageInput).toHaveValue("1");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();

  const tap = async (x: number, y: number) => {
    if (testInfo.project.name === "mobile") await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  await tap(box!.x + box!.width * 0.9, box!.y + box!.height * 0.5);
  await expect(pageInput).toHaveValue("2");

  await page.mouse.move(box!.x + box!.width * 0.9, box!.y + box!.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, box!.y + box!.height * 0.6);
  await page.mouse.up();
  await expect(pageInput).toHaveValue("2");

  await tap(box!.x + box!.width * 0.1, box!.y + box!.height * 0.5);
  await expect(pageInput).toHaveValue("1");
});

test("landscape spread renders paired pages and falls back when narrow (SN-243)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "landscape desktop/tablet harness");
  await page.setViewportSize({ width: 1024, height: 768 });
  await scaffoldPageWithPdf(page);
  await openReader(page);
  await page.getByTestId("pdf-reader-spread-mode").click();
  const viewport = page.getByTestId("pdf-reader-viewport");
  await expect(viewport).toHaveAttribute("data-spread-effective", "on");
  await page.getByTestId("pdf-reader-next").click();
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("2");
  const pair = page.locator('[data-testid="pdf-reader-spread-row"][data-pages="2,3"]');
  await expect(pair).toBeVisible();
  await expect(pair.locator(".pdf-reader__page-frame")).toHaveCount(2);
  await expect.poll(async () => pair.locator(".pdf-reader__page-frame img").count()).toBeGreaterThanOrEqual(2);

  await page.setViewportSize({ width: 600, height: 900 });
  await expect(viewport).toHaveAttribute("data-spread-effective", "off");
  await expect(page.getByTestId("pdf-reader-spread-mode")).toHaveAttribute("aria-pressed", "true");
});

test("spread position, mode, and offset persist across reopen (SN-243)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "landscape desktop/tablet harness");
  await page.setViewportSize({ width: 1024, height: 768 });
  const target = await scaffoldPageWithPdf(page);
  await openReader(page);
  await page.getByTestId("pdf-reader-spread-mode").click();
  await page.getByTestId("pdf-reader-spread-offset").selectOption("odd");
  await page.getByTestId("pdf-reader-next").click();
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("3");
  await page.waitForTimeout(700);
  await page.getByTestId("pdf-reader-close").click();
  await openReader(page);
  await expect(page.getByTestId("pdf-reader-spread-mode")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("pdf-reader-spread-offset")).toHaveValue("odd");
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("3");
  await expect(page.getByTestId("pdf-reader-viewport")).toHaveAttribute("data-spread-effective", "on");
  const stored = await page.evaluate((href) => {
    return JSON.parse(localStorage.getItem(`smart-notes:pdf-reader:${href}`) || "null");
  }, target.href);
  expect(stored).toMatchObject({ page: 3, spreadMode: true, spreadOffset: "odd" });
});

test("opens an existing registered portable-vault PDF attachment", async ({ page }, testInfo) => {
  await scaffoldExistingPortableVaultPdf(page);
  await openReader(page);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `existing-portable-reader-${testInfo.project.name}.png`),
  });
});

test("restores an active reader target across shell reloads", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only");
  await scaffoldPageWithPdf(page);

  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 30000 });

  await page.reload();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("pdf-reader-page-total")).toContainText("/ 3", {
    timeout: 30000,
  });

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "active-reader-restored-after-reload.png"),
  });
});

test("direct page jump clamps out-of-range input and persists (SN-138)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only");
  await scaffoldPageWithPdf(page);
  await openReader(page);

  // Total-page indicator is visible next to the editable field.
  await expect(page.getByTestId("pdf-reader-page-total")).toContainText("/ 3");

  // Typing an out-of-range page and pressing Enter clamps to the last page.
  const input = page.getByTestId("pdf-reader-page-input");
  await input.click();
  await input.fill("99");
  await input.press("Enter");
  await expect(input).toHaveValue("3");
  await page.waitForTimeout(700); // allow debounced persistence to flush

  // Jump back to page 2 directly.
  await input.click();
  await input.fill("2");
  await input.press("Enter");
  await expect(input).toHaveValue("2");
  await page.waitForTimeout(700);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "desktop-reader-page-jump.png"),
  });

  // Close and reopen — the jumped-to page is remembered.
  await page.getByTestId("pdf-reader-close").click();
  await expect(page.getByTestId("pdf-reader")).toBeHidden();
  await openReader(page);
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("2", {
    timeout: 30000,
  });
});

test("remembers last-read page across close/reopen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only");
  await scaffoldPageWithPdf(page);
  await openReader(page);

  // Go to page 3, then close.
  await page.getByTestId("pdf-reader-next").click();
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("2");
  await page.getByTestId("pdf-reader-next").click();
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("3");
  await page.waitForTimeout(700); // allow debounced persistence to flush

  await page.getByTestId("pdf-reader-close").click();
  await expect(page.getByTestId("pdf-reader")).toBeHidden();

  // The chip survives the reader session.
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible();

  // Reopen — should restore to the remembered page 3.
  await openReader(page);
  await expect(page.getByTestId("pdf-reader-page-input")).toHaveValue("3", {
    timeout: 30000,
  });
});

test("shows staged PDF loading progress before the document opens (SN-148)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only");
  await scaffoldPageWithPdf(page);

  let releasePdf!: () => void;
  const pdfGate = new Promise<void>((resolve) => {
    releasePdf = resolve;
  });
  await page.route(/\/vault\/.*\.pdf(?:\?.*)?$/i, async (route) => {
    await pdfGate;
    await route.continue();
  });

  await page.locator('[data-file-type="pdf"]').click();
  const loading = page.getByTestId("pdf-reader-loading");
  await expect(loading).toBeVisible({ timeout: 10000 });
  await expect(loading.getByRole("list", { name: "Loading progress" })).toContainText(
    "Downloading"
  );
  await expect(loading.getByRole("list", { name: "Loading progress" })).toContainText(
    "Opening document"
  );

  releasePdf();
  await expect(page.getByTestId("pdf-reader-page-total")).toContainText("/ 3", {
    timeout: 30000,
  });
  await page.unroute(/\/vault\/.*\.pdf(?:\?.*)?$/i);
});

test("Annotate mode exposes ink + highlight and restores pan when off (SN-136)", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile") {
    // Use a phone-height viewport so the three-page fixture has a real native
    // scroll range; the project default is intentionally tall for screenshots.
    await page.setViewportSize({ width: 430, height: 520 });
  }
  const target = await scaffoldPageWithPdf(page);
  await openReader(page);

  const annotateToggle = page.getByTestId("pdf-reader-annotate-toggle");
  // Must become enabled (not flash-disabled) after sidecar load.
  await expect(annotateToggle).toBeEnabled({ timeout: 30000 });
  await expect(annotateToggle).toHaveAttribute("aria-pressed", "false");
  await expect(annotateToggle).toHaveText("");

  // Annotate-off: annotation layer must not steal pan/zoom gestures.
  await expect(page.getByTestId("pdf-reader-viewport")).toHaveAttribute(
    "data-annotate",
    "off"
  );
  await expect(page.getByTestId("pdf-reader-annotate-bar")).toHaveCount(0);

  // On touch devices, Done must restore native document scrolling rather than
  // merely hiding the toolbar while an invisible annotation layer intercepts.
  if (testInfo.project.name === "mobile") {
    const viewport = page.getByTestId("pdf-reader-viewport");
    const startScrollTop = await viewport.evaluate((element) => element.scrollTop);
    const scrollMetrics = await viewport.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      childHeight: (element.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0,
      childScrollHeight:
        (element.firstElementChild as HTMLElement | null)?.scrollHeight ?? 0,
      frameHeights: Array.from(element.querySelectorAll<HTMLElement>(".pdf-reader__page-frame")).map(
        (frame) => frame.offsetHeight
      ),
    }));
    expect(
      scrollMetrics.scrollHeight - scrollMetrics.clientHeight,
      JSON.stringify(scrollMetrics)
    ).toBeGreaterThan(50);
    const box = await viewport.boundingBox();
    expect(box).toBeTruthy();
    const session = await page.context().newCDPSession(page);
    const x = box!.x + box!.width / 2;
    const startY = box!.y + Math.min(box!.height - 60, 360);
    await page.evaluate(() => {
      (window as Window & { __sn136TouchPrevented?: boolean }).__sn136TouchPrevented = true;
      document.addEventListener(
        "touchmove",
        (event) => {
          (window as Window & { __sn136TouchPrevented?: boolean }).__sn136TouchPrevented =
            event.defaultPrevented;
        },
        { once: true }
      );
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: startY }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: startY - 120 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __sn136TouchPrevented?: boolean })
              .__sn136TouchPrevented
        )
      )
      .toBe(false);
    await expect(viewport).toHaveCSS("touch-action", "auto");

    // Headless Chromium does not consistently apply compositor scrolling for
    // dispatchTouchEvent. A wheel step verifies that this same element is the
    // active scroll container once the uncancelled touch path is established.
    await page.mouse.move(x, startY);
    await page.mouse.wheel(0, 160);
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop), { timeout: 5000 })
      .toBeGreaterThan(startScrollTop + 20);
    await viewport.evaluate((element) => element.scrollTo({ top: 0 }));
  }

  await annotateToggle.click();
  await expect(annotateToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("pdf-reader-viewport")).toHaveAttribute(
    "data-annotate",
    "on"
  );

  const annotateBar = page.getByTestId("pdf-reader-annotate-bar");
  await expect(annotateBar).toBeVisible();
  await expect(page.getByTestId("pdf-reader-tool-pan")).toBeVisible();
  await expect(page.getByTestId("pdf-reader-tool-ink")).toBeVisible();
  await expect(page.getByTestId("pdf-reader-tool-highlight")).toBeVisible();
  await expect(page.getByTestId("pdf-reader-tool-eraser")).toBeVisible();
  // SN-136 scope is ink + native highlight + eraser — no free-text / select tool.
  await expect(page.getByTestId("pdf-reader-tool-freeText")).toHaveCount(0);
  await expect(page.getByTestId("pdf-reader-tool-select")).toHaveCount(0);
  await expect(page.getByTestId("pdf-reader-tool-pan")).toHaveAttribute(
    "data-active",
    "true"
  );
  await expect(page.getByTestId("pdf-reader-viewport")).toHaveAttribute(
    "data-annotation-tool",
    "pan"
  );
  await expect(page.getByTestId("pdf-reader-annotation-undo")).toBeDisabled();
  await expect(page.getByTestId("pdf-reader-annotation-redo")).toBeDisabled();

  if (testInfo.project.name === "mobile") {
    // Finger input must navigate, not author ink, even while Ink is selected.
    await page.getByTestId("pdf-reader-tool-ink").click();
    const inkViewport = page.getByTestId("pdf-reader-viewport");
    await expect(inkViewport).toHaveCSS("touch-action", "pan-y pinch-zoom");
    const frameBox = await page.locator(".pdf-reader__page-frame").first().boundingBox();
    expect(frameBox).toBeTruthy();
    const session = await page.context().newCDPSession(page);
    const x = frameBox!.x + frameBox!.width / 2;
    const startY = Math.min(frameBox!.y + frameBox!.height - 40, 420);
    await page.evaluate(() => {
      (window as Window & { __sn136InkTouchPrevented?: boolean })
        .__sn136InkTouchPrevented = true;
      document.addEventListener(
        "touchmove",
        (event) => {
          (window as Window & { __sn136InkTouchPrevented?: boolean })
            .__sn136InkTouchPrevented = event.defaultPrevented;
        },
        { once: true }
      );
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: startY }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: startY - 100 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __sn136InkTouchPrevented?: boolean })
              .__sn136InkTouchPrevented
        )
      )
      .toBe(false);
    await page.waitForTimeout(700);
    const sidecar = await page.request.get(
      `/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`
    );
    const payload = (await sidecar.json()) as { items: unknown[] };
    expect(payload.items).toHaveLength(0);

    // A pen on the same Ink tool must author normally while touch navigates.
    await inkViewport.evaluate((element) => element.scrollTo({ top: 0 }));
    const penFrameBox = await page.locator(".pdf-reader__page-frame").first().boundingBox();
    expect(penFrameBox).toBeTruthy();
    const penStart = {
      x: penFrameBox!.x + penFrameBox!.width * 0.35,
      y: penFrameBox!.y + penFrameBox!.height * 0.35,
    };
    const penEnd = {
      x: penStart.x + 70,
      y: penStart.y + 30,
    };
    await session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: penStart.x,
      y: penStart.y,
      button: "left",
      buttons: 1,
      pointerType: "pen",
      force: 0.5,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: penEnd.x,
      y: penEnd.y,
      button: "left",
      buttons: 1,
      pointerType: "pen",
      force: 0.5,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: penEnd.x,
      y: penEnd.y,
      button: "left",
      buttons: 0,
      pointerType: "pen",
      force: 0,
    });
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`
        );
        const saved = (await response.json()) as { items: unknown[] };
        return saved.items.length;
      }, { timeout: 10000 })
      .toBeGreaterThan(0);
    await expect(page.getByTestId("pdf-reader-annotation-undo")).toBeEnabled();
    await page.getByTestId("pdf-reader-annotation-undo").click();
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`
        );
        const saved = (await response.json()) as { items: unknown[] };
        return saved.items.length;
      }, { timeout: 10000 })
      .toBe(0);
  }

  await page.getByTestId("pdf-reader-tool-highlight").click();
  await expect(page.getByTestId("pdf-reader-tool-highlight")).toHaveAttribute(
    "data-active",
    "true"
  );
  const highlightViewport = page.getByTestId("pdf-reader-viewport");
  await expect(highlightViewport).toHaveAttribute(
    "data-annotation-tool",
    "highlight"
  );
  await expect(highlightViewport).toHaveCSS(
    "touch-action",
    "pan-y pinch-zoom"
  );
  await expect(page.locator(".pdf-reader__annotate-hint")).toContainText(
    "tap a highlight"
  );

  if (testInfo.project.name === "mobile") {
    // Highlight mode must not cancel a one-finger vertical gesture. The
    // selection provider still receives horizontal pointer drags for text.
    const frameBox = await page.locator(".pdf-reader__page-frame").first().boundingBox();
    expect(frameBox).toBeTruthy();
    const session = await page.context().newCDPSession(page);
    const x = frameBox!.x + frameBox!.width / 2;
    const startY = Math.min(frameBox!.y + frameBox!.height - 40, 420);
    await page.evaluate(() => {
      (window as Window & { __sn136HighlightTouchPrevented?: boolean })
        .__sn136HighlightTouchPrevented = true;
      document.addEventListener(
        "touchmove",
        (event) => {
          (window as Window & { __sn136HighlightTouchPrevented?: boolean })
            .__sn136HighlightTouchPrevented = event.defaultPrevented;
        },
        { once: true }
      );
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: startY }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: startY - 100 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __sn136HighlightTouchPrevented?: boolean })
              .__sn136HighlightTouchPrevented
        )
      )
      .toBe(false);
  }

  await page.screenshot({
    path: path.join(
      EVIDENCE_DIR,
      `sn-136-annotate-active-${testInfo.project.name}.png`
    ),
  });

  await page.getByTestId("pdf-reader-annotate-done").click();
  await expect(annotateToggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("pdf-reader-viewport")).toHaveAttribute(
    "data-annotate",
    "off"
  );
  await expect(page.getByTestId("pdf-reader-annotate-bar")).toHaveCount(0);

  // Companion toggle opens an overlay above the immersive reader.
  const companionToggle = page.getByTestId("pdf-reader-companion-toggle");
  await expect(companionToggle).toBeVisible();
  await companionToggle.click();
  await expect(companionToggle).toHaveAttribute("aria-pressed", "true");
  const companionOverlay = page
    .getByTestId("pdf-reader-ai-sidebar")
    .or(page.getByTestId("pdf-reader-ai-sheet"));
  await expect(companionOverlay).toBeVisible({ timeout: 10000 });
  // Overlay covers the PDF toolbar — dismiss via companion chrome, not the bar toggle.
  const companionClose = companionOverlay
    .getByTestId("pdf-reader-ai-close")
    .or(companionOverlay.getByRole("button", { name: "Close AI sheet" }));
  await companionClose.click();
  await expect(companionToggle).toHaveAttribute("aria-pressed", "false");
  await expect(companionOverlay).toHaveCount(0);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `sn-136-annotate-off-${testInfo.project.name}.png`),
  });
});

test("re-tapping a highlight opens comment and delete controls that persist (SN-136)", async ({
  page,
}) => {
  test.setTimeout(75_000);
  const target = await scaffoldPageWithPdf(page);
  const highlightRect = {
    origin: { x: 72, y: 96 },
    size: { width: 210, height: 34 },
  };
  const seed = await page.request.put("/api/pdf-annotations", {
    data: {
      path: target.vaultPath,
      items: [
        {
          annotation: {
            id: "e2e-highlight-comment-1",
            type: 9,
            pageIndex: 0,
            rect: highlightRect,
            segmentRects: [highlightRect],
            strokeColor: "#facc15",
            color: "#facc15",
            opacity: 0.45,
            contents: "Existing research note",
          },
        },
      ],
    },
  });
  expect(seed.ok()).toBe(true);

  await openReader(page);
  const frame = page.locator(".pdf-reader__page-frame").first();
  const frameBox = await frame.boundingBox();
  expect(frameBox).toBeTruthy();
  const pdfWidth = 612;
  const pdfHeight = 792;
  await page.mouse.click(
    frameBox!.x + ((highlightRect.origin.x + highlightRect.size.width / 2) / pdfWidth) * frameBox!.width,
    frameBox!.y + ((highlightRect.origin.y + highlightRect.size.height / 2) / pdfHeight) * frameBox!.height
  );

  // Comments are readable from the normal reading surface.
  const menu = page.getByTestId("pdf-reader-anno-menu");
  await expect(menu).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("pdf-reader-highlight-comment")).toContainText(
    "Existing research note"
  );
  await expect(page.getByTestId("pdf-reader-annotate-toggle")).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  await page.screenshot({
    path: path.join(
      EVIDENCE_DIR,
      `sn-136-comment-read-${test.info().project.name}.png`
    ),
  });

  // Editing is intentional and switches to Highlight inside Annotate.
  await page.getByTestId("pdf-reader-anno-edit").click();
  await expect(page.getByTestId("pdf-reader-annotate-toggle")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("pdf-reader-tool-highlight")).toHaveAttribute(
    "data-active",
    "true"
  );
  const note = page.getByTestId("pdf-reader-highlight-note-input");
  await expect(note).toBeVisible();
  await page.screenshot({
    path: path.join(
      EVIDENCE_DIR,
      `sn-136-comment-edit-${test.info().project.name}.png`
    ),
  });
  await note.fill("Revisit this definition with the companion");
  await page.getByTestId("pdf-reader-anno-save").click();
  await expect(menu).toHaveCount(0);

  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`
      );
      const payload = (await response.json()) as {
        items: Array<{ annotation?: { contents?: string } }>;
      };
      return payload.items[0]?.annotation?.contents ?? "";
    }, { timeout: 10000 })
    .toBe("Revisit this definition with the companion");

  const editFrameBox = await frame.boundingBox();
  expect(editFrameBox).toBeTruthy();
  await page.mouse.click(
    editFrameBox!.x + ((highlightRect.origin.x + highlightRect.size.width / 2) / pdfWidth) * editFrameBox!.width,
    editFrameBox!.y + ((highlightRect.origin.y + highlightRect.size.height / 2) / pdfHeight) * editFrameBox!.height
  );
  await expect(menu).toBeVisible();
  await page.getByTestId("pdf-reader-anno-delete").click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`
      );
      const payload = (await response.json()) as { items: unknown[] };
      return payload.items.length;
    }, { timeout: 10000 })
    .toBe(0);

  // Destructive annotation actions are recoverable.
  const undo = page.getByTestId("pdf-reader-annotation-undo");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`
      );
      const payload = (await response.json()) as { items: unknown[] };
      return payload.items.length;
    }, { timeout: 10000 })
    .toBe(1);

  const redo = page.getByTestId("pdf-reader-annotation-redo");
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`
      );
      const payload = (await response.json()) as { items: unknown[] };
      return payload.items.length;
    }, { timeout: 10000 })
    .toBe(0);
});

test("eraser scrubs ink strokes without select-then-delete (SN-136)", async ({
  page,
}, testInfo) => {
  test.setTimeout(75_000);
  const target = await scaffoldPageWithPdf(page);
  const inkRect = {
    origin: { x: 40, y: 80 },
    size: { width: 120, height: 40 },
  };
  const seed = await page.request.put("/api/pdf-annotations", {
    data: {
      path: target.vaultPath,
      items: [
        {
          annotation: {
            id: "e2e-ink-erase-1",
            type: 15,
            pageIndex: 0,
            rect: inkRect,
            inkList: [
              {
                points: [
                  { x: 40, y: 100 },
                  { x: 80, y: 90 },
                  { x: 120, y: 110 },
                  { x: 160, y: 95 },
                ],
              },
            ],
            color: "#e11d48",
            strokeColor: "#e11d48",
            opacity: 1,
            strokeWidth: 3,
          },
        },
      ],
    },
  });
  expect(seed.ok()).toBe(true);

  await openReader(page);
  await page.getByTestId("pdf-reader-annotate-toggle").click();
  await page.getByTestId("pdf-reader-tool-eraser").click();
  await expect(page.getByTestId("pdf-reader-tool-eraser")).toHaveAttribute(
    "data-active",
    "true"
  );
  await expect(page.getByTestId("pdf-reader-eraser-surface").first()).toBeVisible();
  await expect(page.locator(".pdf-reader__annotate-hint")).toContainText(
    "Scrub over ink"
  );
  // Eraser must not open the highlight comment dish.
  await expect(page.getByTestId("pdf-reader-anno-menu")).toHaveCount(0);

  const frame = page.locator(".pdf-reader__page-frame").first();
  const frameBox = await frame.boundingBox();
  expect(frameBox).toBeTruthy();
  const pdfWidth = 612;
  const pdfHeight = 792;
  const toScreen = (x: number, y: number) => ({
    x: frameBox!.x + (x / pdfWidth) * frameBox!.width,
    y: frameBox!.y + (y / pdfHeight) * frameBox!.height,
  });
  const start = toScreen(50, 100);
  const mid = toScreen(100, 95);
  const end = toScreen(150, 105);

  if (testInfo.project.name === "mobile") {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: start.x, y: start.y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: end.x, y: end.y - 80 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(700);
    const response = await page.request.get(
      `/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`
    );
    const payload = (await response.json()) as { items: unknown[] };
    expect(payload.items).toHaveLength(1);
  }

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/pdf-annotations?path=${encodeURIComponent(target.vaultPath)}`
      );
      const payload = (await response.json()) as { items: unknown[] };
      return payload.items.length;
    }, { timeout: 10000 })
    .toBe(0);
});

test("annotation sidecar persists across reopen (SN-136)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only");
  await scaffoldPageWithPdf(page);
  await openReader(page);

  const annotateToggle = page.getByTestId("pdf-reader-annotate-toggle");
  await expect(annotateToggle).toBeEnabled({ timeout: 30000 });

  // Resolve the vault PDF path from the chip href, then seed a sidecar via API
  // (avoids relying on pointer-path drawing inside EmbedPDF WASM in CI).
  const href = await page.locator('[data-file-type="pdf"]').getAttribute("href");
  expect(href).toBeTruthy();
  const vaultPath = decodeURIComponent(href!.replace(/^\/vault\//, ""));
  expect(vaultPath.toLowerCase().endsWith(".pdf")).toBe(true);

  const seed = await page.request.put("/api/pdf-annotations", {
    data: {
      path: vaultPath,
      items: [
        {
          annotation: {
            id: "e2e-ink-1",
            type: 15,
            pageIndex: 0,
            rect: { origin: { x: 20, y: 40 }, size: { width: 80, height: 24 } },
            inkList: [{ points: [{ x: 20, y: 40 }, { x: 100, y: 60 }] }],
            color: "#e11d48",
            opacity: 1,
            strokeWidth: 2,
          },
        },
      ],
    },
  });
  expect(seed.ok()).toBe(true);

  await page.getByTestId("pdf-reader-close").click();
  await expect(page.getByTestId("pdf-reader")).toBeHidden();

  // Prove PDF bytes were not rewritten by the annotations API.
  const pdfHead = await page.request.get(href!);
  expect(pdfHead.ok()).toBe(true);
  const pdfBytes = Buffer.from(await pdfHead.body());
  expect(pdfBytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");

  await openReader(page);
  await expect(page.getByTestId("pdf-reader-annotate-toggle")).toBeEnabled({
    timeout: 30000,
  });

  const loaded = await page.request.get(
    `/api/pdf-annotations?path=${encodeURIComponent(vaultPath)}`
  );
  expect(loaded.ok()).toBe(true);
  const sidecar = (await loaded.json()) as { items: unknown[] };
  expect(sidecar.items.length).toBeGreaterThanOrEqual(1);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "sn-136-sidecar-reopen.png"),
  });
});
