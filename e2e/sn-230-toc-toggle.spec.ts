/**
 * SN-230 / SN-231 — page TOC toggle + back-to-top placement (desktop & mobile).
 *
 * SN-230: the format-bar TOC control inserts when no TOC exists and removes
 * when one does; refresh stays available on the Insert menu.
 * SN-231: the back-to-top chevron is anchored to the end of the heading text
 * (same reading line) with a >= 44px touch target on coarse pointers.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const NOTEBOOK = "Personal Notebook";
const SECTION = "Quick Notes";
const PAGE_SLUG = "sn230-toc-toggle";
const PAGE_PATH = `${NOTEBOOK}/${SECTION}/${PAGE_SLUG}.html`;
const PAGE_FILE = path.join(VAULT, NOTEBOOK, SECTION, `${PAGE_SLUG}.html`);
const EVIDENCE_DIR = path.resolve(__dirname, "..", "evidence", "SN-230");

const SHORT_HEADING = "Alpha";
const LONG_HEADING =
  "Beta section with a deliberately long heading that runs most of the column";

function seedPage() {
  fs.mkdirSync(path.dirname(PAGE_FILE), { recursive: true });
  fs.writeFileSync(
    PAGE_FILE,
    [
      "---",
      "title: SN-230 TOC Toggle",
      "created: 2026-08-20T00:00:00.000Z",
      "updated: 2026-08-20T00:00:00.000Z",
      "---",
      `<h1>${SHORT_HEADING}</h1>`,
      "<p>Alpha body copy.</p>",
      `<h2>${LONG_HEADING}</h2>`,
      "<p>Beta body copy.</p>",
      "<h3>Gamma</h3>",
      "<p>Gamma body copy.</p>",
    ].join("\n"),
    "utf8"
  );
}

async function openSeededPage(page: Page) {
  await page.addInitScript((activePath) => {
    window.localStorage.setItem("smart-notes-active-page", activePath);
  }, PAGE_PATH);
  await page.goto("/");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".editor-content h1")).toContainText(SHORT_HEADING, {
    timeout: 30_000,
  });
}

function tocButton(page: Page) {
  return page.locator('[data-testid^="toolbar-page-toc"]').locator("visible=true").first();
}

const SCROLL_TOC_SLUG = "sn233-toc-tap-drag";
const SCROLL_TOC_PATH = `${NOTEBOOK}/${SECTION}/${SCROLL_TOC_SLUG}.html`;
const SCROLL_TOC_FILE = path.join(VAULT, NOTEBOOK, SECTION, `${SCROLL_TOC_SLUG}.html`);

/** Long page so the TOC's target heading sits far below the fold — a jump and
 * a short scroll land at very different scrollTops, making the two
 * unmistakable. */
function seedScrollableTocPage() {
  const filler = Array.from(
    { length: 60 },
    (_, i) => `<p>Filler paragraph ${i + 1}: ${"lorem ipsum dolor sit amet ".repeat(8)}</p>`
  ).join("\n");
  fs.mkdirSync(path.dirname(SCROLL_TOC_FILE), { recursive: true });
  fs.writeFileSync(
    SCROLL_TOC_FILE,
    [
      "---",
      "title: SN-233 TOC tap-vs-drag",
      "created: 2026-08-21T00:00:00.000Z",
      "updated: 2026-08-21T00:00:00.000Z",
      "---",
      "<h1>Intro</h1>",
      "<p>Intro body.</p>",
      filler,
      "<h2>Far Section</h2>",
      "<p>Far body.</p>",
    ].join("\n"),
    "utf8"
  );
}

/** Single-finger touch sequence via CDP so the real Chromium gesture
 * recognizer, compat-click synthesis, and scroll timing are exercised —
 * jsdom (unit tests) cannot reproduce any of the three (SN-233 review). */
async function touchDragFrom(
  page: Page,
  start: { x: number; y: number },
  dyPerStep: number,
  steps: number
) {
  const session = await page.context().newCDPSession(page);
  const point = (px: number, py: number) => ({ x: Math.round(px), y: Math.round(py) });
  let y = start.y;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(start.x, y)],
  });
  for (let i = 0; i < steps; i++) {
    y += dyPerStep;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(start.x, y)],
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

async function touchTap(page: Page, at: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page);
  const point = { x: Math.round(at.x), y: Math.round(at.y) };
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

/** Right edge + midline of a heading's last rendered line, in viewport px. */
async function headingLineMetrics(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
    const lastBottom = Math.max(...rects.map((r) => r.bottom));
    const lastLine = rects.filter((r) => Math.abs(r.bottom - lastBottom) < 1);
    return {
      right: Math.max(...lastLine.map((r) => r.right)),
      midY: (Math.min(...lastLine.map((r) => r.top)) + lastBottom) / 2,
    };
  });
}

test.describe("SN-230 page TOC toggle + SN-231 back-to-top placement", () => {
  test.beforeAll(() => seedPage());

  test("format-bar control toggles the TOC and back-to-top hugs the heading", async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.name === "mobile";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    await openSeededPage(page);

    const toc = page.locator("nav[data-page-toc]");
    const backToTop = page.locator("[data-heading-back-to-top-control]");
    await expect(toc).toHaveCount(0);
    await expect(backToTop).toHaveCount(0);

    // ── Insert ────────────────────────────────────────────────────────────
    await tocButton(page).click();
    await expect(toc).toHaveCount(1);
    await expect(backToTop.first()).toBeVisible({ timeout: 10_000 });
    await expect(backToTop).toHaveCount(3);

    // ── SN-231: adjacency + touch target on short and long headings ───────
    for (const [label, selector, order] of [
      ["short", ".editor-content h1", 0],
      ["long", ".editor-content h2", 1],
    ] as const) {
      const control = page.getByTestId(`heading-back-to-top-${order}`);
      // Retry while the freshly inserted TOC settles its own layout.
      await expect(async () => {
        const line = await headingLineMetrics(page, selector);
        const box = await control.boundingBox();
        const glyph = await control.locator("svg").boundingBox();
        expect(box, `${label} heading control box`).not.toBeNull();
        expect(glyph, `${label} heading chevron`).not.toBeNull();

        // The visible chevron sits on the heading's reading line, right after
        // the last glyph - never on the words, never out in the gutter.
        const gap = glyph!.x - line.right;
        expect(gap, `${label} chevron gap`).toBeGreaterThanOrEqual(-4);
        expect(gap, `${label} chevron gap`).toBeLessThanOrEqual(26);
        expect(
          Math.abs(glyph!.y + glyph!.height / 2 - line.midY),
          `${label} chevron midline`
        ).toBeLessThanOrEqual(4);

        // Touch target stays a full 44px on coarse pointers.
        if (isMobile) {
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
      }).toPass({ timeout: 10_000 });
    }

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-toc-present.png`),
      fullPage: false,
    });

    // Back-to-top scrolls to the TOC.
    await page.getByTestId("heading-back-to-top-2").click();
    await expect(toc).toBeInViewport({ timeout: 10_000 });

    // ── Refresh (explicit path, keeps the block) ──────────────────────────
    await page.locator(".editor-content h3").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Updated");
    const insertMenu = page
      .locator('[data-testid^="toolbar-insert-menu"]')
      .locator("visible=true")
      .first();
    await insertMenu.click();
    await page
      .locator('[data-testid^="toolbar-page-toc-overflow"]')
      .locator("visible=true")
      .first()
      .click();
    await expect(toc).toHaveCount(1);
    await expect(toc).toContainText("Gamma Updated", { timeout: 10_000 });

    // ── Toggle off ────────────────────────────────────────────────────────
    await tocButton(page).click();
    await expect(toc).toHaveCount(0);
    await expect(backToTop).toHaveCount(0);
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-toc-removed.png`),
      fullPage: false,
    });

    // ── Toggle back on ────────────────────────────────────────────────────
    await tocButton(page).click();
    await expect(toc).toHaveCount(1);
    await expect(backToTop.first()).toBeVisible({ timeout: 10_000 });
  });
  test("SN-233 mobile: a touch drag over a TOC entry scrolls without jumping; a stationary tap still jumps", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Touch tap-vs-drag guard is mobile-only");
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    seedScrollableTocPage();

    await page.addInitScript((activePath) => {
      window.localStorage.setItem("smart-notes-active-page", activePath);
    }, SCROLL_TOC_PATH);
    await page.goto("/");
    await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".editor-content h1")).toContainText("Intro", { timeout: 30_000 });

    await tocButton(page).click();
    const toc = page.locator("nav[data-page-toc]");
    await expect(toc).toHaveCount(1);
    const farLink = page.locator('[data-toc-target]', { hasText: "Far Section" });
    await expect(farLink).toBeVisible();
    const farHeading = page.locator(".editor-content h2", { hasText: "Far Section" });

    const readScrollTop = () =>
      page.evaluate(
        () => (document.querySelector(".editor-scroll-area") as HTMLElement | null)?.scrollTop ?? 0
      );

    // ── Drag: finger lands on the TOC entry, then moves — must scroll, not jump.
    const scrollTopBeforeDrag = await readScrollTop();
    const linkBox = await farLink.boundingBox();
    expect(linkBox).not.toBeNull();
    await touchDragFrom(
      page,
      { x: linkBox!.x + linkBox!.width / 2, y: linkBox!.y + linkBox!.height / 2 },
      -20,
      6
    );

    const scrollTopAfterDrag = await readScrollTop();
    expect(scrollTopAfterDrag, "drag should scroll the page").toBeGreaterThan(scrollTopBeforeDrag);
    // "Far Section" sits thousands of px down (60 filler paragraphs); a real
    // jump would land its heading at the top of the viewport. A short drag
    // must not get anywhere close to that.
    expect(scrollTopAfterDrag - scrollTopBeforeDrag, "drag must not jump to the section").toBeLessThan(
      500
    );
    await expect(farHeading, "drag must not navigate to the section").not.toBeInViewport();
    await expect(toc, "still on the same page, TOC still present").toHaveCount(1);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-toc-drag-scrolls-no-jump.png`),
      fullPage: false,
    });

    // ── Tap: stationary press-and-release on the same entry must still jump.
    await page.evaluate(() => {
      const area = document.querySelector(".editor-scroll-area") as HTMLElement | null;
      if (area) area.scrollTop = 0;
    });
    await expect.poll(readScrollTop).toBe(0);
    const linkBoxForTap = await farLink.boundingBox();
    expect(linkBoxForTap).not.toBeNull();
    await touchTap(page, {
      x: linkBoxForTap!.x + linkBoxForTap!.width / 2,
      y: linkBoxForTap!.y + linkBoxForTap!.height / 2,
    });

    await expect(farHeading, "a clean tap still jumps to its section").toBeInViewport({
      timeout: 10_000,
    });

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-toc-tap-jumps.png`),
      fullPage: false,
    });
  });

  test("toggle-off remaps ink back with the TOC height (SN-230 ink safety)", async ({
    page,
  }, testInfo) => {
    // Ink remap is viewport-independent; the mouse path keeps this deterministic.
    test.skip(testInfo.project.name === "mobile", "desktop covers the ink remap path");

    await openSeededPage(page);

    // Draw one stroke over the top of the page, where a TOC insert shifts prose.
    await page.getByTestId("toolbar-annotate").click();
    const layer = page.getByTestId("annotation-layer");
    await expect(layer).toHaveAttribute("data-annotation-ready", "true", { timeout: 20_000 });
    const layerBox = await layer.boundingBox();
    expect(layerBox).not.toBeNull();
    const startX = Math.round(layerBox!.x + layerBox!.width * 0.25);
    const startY = Math.round(layerBox!.y + layerBox!.height * 0.2);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 140, startY + 30, { steps: 14 });
    await page.mouse.up();

    const stroke = layer.locator('.tl-shape[data-shape-type="draw"]');
    await expect(stroke).toHaveCount(1, { timeout: 10_000 });
    await page.getByTestId("ink-exit-draw").click();
    // Let the debounced sidecar save land so the editor holds the live scene.
    await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 20_000 });
    await page.waitForTimeout(1_500);

    const strokeTop = async () => (await stroke.boundingBox())!.y;
    const before = await strokeTop();

    const toc = page.locator("nav[data-page-toc]");
    await tocButton(page).click();
    await expect(toc).toHaveCount(1);
    const tocHeight = (await toc.boundingBox())!.height;
    expect(tocHeight).toBeGreaterThan(20);

    // Insert pushed the prose down; ink follows by the same delta.
    await expect.poll(strokeTop, { timeout: 10_000 }).toBeGreaterThan(before + tocHeight / 2);

    // Toggle off returns the ink to where it started - no silent desync.
    await tocButton(page).click();
    await expect(toc).toHaveCount(0);
    await expect(page.locator("[data-heading-back-to-top-control]")).toHaveCount(0);
    await expect.poll(strokeTop, { timeout: 10_000 }).toBeLessThanOrEqual(before + 4);
    expect(await strokeTop()).toBeGreaterThanOrEqual(before - 4);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-ink-after-toggle-off.png`),
      fullPage: false,
    });
  });
});
