import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * SN-136 visual walkthrough: drives the full researcher journey with real
 * gestures (drag-created highlight over document text, comment, read-mode
 * comment, ink stroke, eraser scrub) and captures a screenshot at every step
 * so the annotation UX can be reviewed frame by frame. The assertions are
 * real, so this doubles as an end-to-end regression of the whole journey.
 */

const PDF_FIXTURE = path.resolve(__dirname, "fixtures/catalogue-final.pdf");
const SHOT_DIR = path.resolve(__dirname, "../evidence/sn-136-walkthrough");

fs.mkdirSync(SHOT_DIR, { recursive: true });

test.beforeEach(() => test.setTimeout(300_000));

interface SeededPdfTarget {
  pageTitle: string;
  pagePath: string;
  href: string;
  vaultPath: string;
}

async function scaffoldPageWithPdf(page: Page): Promise<SeededPdfTarget> {
  const pageTitle = `SN136 Walkthrough ${Date.now().toString(36).slice(-6)}`;

  const vaultRes = await page.request.get("/api/vault");
  expect(vaultRes.ok()).toBe(true);
  const tree = (await vaultRes.json()).tree as Array<{
    path: string;
    sections: Array<{ path: string }>;
  }>;
  const notebook = tree.find((n) => n.sections?.length > 0);
  expect(notebook, "a notebook with a section must exist in the e2e vault").toBeTruthy();

  const create = await page.request.post("/api/page", {
    data: {
      sectionPath: notebook!.sections[0].path,
      notebookPath: notebook!.path,
      title: pageTitle,
      noteType: "text",
    },
  });
  expect(create.ok()).toBe(true);
  const created = (await create.json()) as { page: { path: string } };
  const pagePath = created.page.path;

  const upload = await page.request.post(
    `/api/assets?path=${encodeURIComponent(pagePath)}`,
    {
      multipart: {
        file: {
          name: "Catalogue(Final).pdf",
          mimeType: "application/pdf",
          buffer: fs.readFileSync(PDF_FIXTURE),
        },
      },
    }
  );
  expect(upload.ok()).toBe(true);
  const href = ((await upload.json()) as { asset: { url: string } }).asset.url;

  const content = `<h1>${pageTitle}</h1><p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false" href="${href}" fileName="Catalogue(Final).pdf"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${href}">Catalogue(Final).pdf</span></span></p>`;
  const save = await page.request.put("/api/page", {
    data: { path: pagePath, title: pageTitle, content },
  });
  expect(save.ok()).toBe(true);

  await page.addInitScript((activePagePath) => {
    window.localStorage.setItem("smart-notes-active-page", activePagePath);
  }, pagePath);

  await page.goto("/");
  await expect(page.getByTestId("rich-text-editor")).toBeVisible({ timeout: 90000 });
  await expect(page.locator('[data-file-type="pdf"]')).toBeVisible({ timeout: 15000 });

  return {
    pageTitle,
    pagePath,
    href,
    vaultPath: decodeURIComponent(href.replace(/^\/vault\//, "")),
  };
}

async function openReader(page: Page) {
  await page.locator('[data-file-type="pdf"]').click();
  await expect(page.getByTestId("pdf-reader")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".pdf-reader__page-frame").first()).toBeVisible({
    timeout: 30000,
  });
  const frame = page.locator(".pdf-reader__page-frame").first();
  await expect
    .poll(async () => frame.locator("img").count(), { timeout: 45000 })
    .toBeGreaterThan(0);
}

async function sidecarItems(page: Page, vaultPath: string): Promise<
  Array<{
    annotation?: {
      id?: string;
      type?: number;
      contents?: string;
      rect?: { origin: { x: number; y: number }; size: { width: number; height: number } };
    };
  }>
> {
  const response = await page.request.get(
    `/api/pdf-annotations?path=${encodeURIComponent(vaultPath)}`
  );
  return ((await response.json()) as { items: never[] }).items;
}

test("full annotation journey with step screenshots (SN-136)", async ({ page }, testInfo) => {
  const proj = testInfo.project.name;
  let step = 0;
  const shot = async (name: string) => {
    step += 1;
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOT_DIR, `${String(step).padStart(2, "0")}-${name}-${proj}.png`),
    });
  };

  const target = await scaffoldPageWithPdf(page);
  await openReader(page);
  await shot("read-mode");

  // 2. Enter Annotate: must open on Pan (safe, non-authoring).
  const annotateToggle = page.getByTestId("pdf-reader-annotate-toggle");
  await expect(annotateToggle).toBeEnabled({ timeout: 30000 });
  await annotateToggle.click();
  await expect(page.getByTestId("pdf-reader-tool-pan")).toHaveAttribute(
    "data-active",
    "true"
  );
  await shot("annotate-opens-on-pan");

  // 3. Drag-create a highlight over real document text (no API seeding).
  await page.getByTestId("pdf-reader-tool-highlight").click();
  const frame = page.locator(".pdf-reader__page-frame").first();
  const frameBox = await frame.boundingBox();
  expect(frameBox).toBeTruthy();
  const lineFractions = [0.14, 0.2, 0.27, 0.34, 0.42, 0.5];
  let created = false;
  for (const fy of lineFractions) {
    const y = frameBox!.y + frameBox!.height * fy;
    await page.mouse.move(frameBox!.x + frameBox!.width * 0.12, y);
    await page.mouse.down();
    await page.mouse.move(frameBox!.x + frameBox!.width * 0.82, y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const items = await sidecarItems(page, target.vaultPath);
    if (items.length > 0) {
      created = true;
      break;
    }
  }
  expect(created, "dragging across document text must create a highlight").toBe(true);
  // Creation stays quiet: no popup dish on the fresh highlight.
  await expect(page.getByTestId("pdf-reader-anno-menu")).toHaveCount(0);
  await shot("highlight-created-quiet");

  // 4. Tap the highlight to open the comment/delete dish.
  const [item] = await sidecarItems(page, target.vaultPath);
  const rect = item.annotation?.rect;
  expect(rect).toBeTruthy();
  const pdfWidth = 612;
  const pdfHeight = 792;
  // Leaving/entering Annotate removes/adds the tool bar, which shifts the
  // page frame — recompute the highlight's screen position at each tap.
  const highlightPoint = async () => {
    const box = await frame.boundingBox();
    expect(box).toBeTruthy();
    return {
      x: box!.x + ((rect!.origin.x + rect!.size.width / 2) / pdfWidth) * box!.width,
      y: box!.y + ((rect!.origin.y + rect!.size.height / 2) / pdfHeight) * box!.height,
    };
  };
  const tapAt = await highlightPoint();
  await page.mouse.click(tapAt.x, tapAt.y);
  const menu = page.getByTestId("pdf-reader-anno-menu");
  await expect(menu).toBeVisible({ timeout: 10000 });
  const noteInput = page.getByTestId("pdf-reader-highlight-note-input");
  await expect(noteInput).toBeVisible();
  await shot("highlight-tapped-dish");

  // 5. Add a comment and save.
  await noteInput.fill("Key passage — compare against chapter 3 results");
  await shot("comment-typed");
  await page.getByTestId("pdf-reader-anno-save").click();
  await expect(menu).toHaveCount(0);
  await expect
    .poll(async () =>
      (await sidecarItems(page, target.vaultPath))[0]?.annotation?.contents ?? ""
    , { timeout: 10000 })
    .toBe("Key passage — compare against chapter 3 results");

  // 6. Done → read mode; the commented highlight opens read-only while reading.
  await page.getByTestId("pdf-reader-annotate-done").click();
  await expect(annotateToggle).toHaveAttribute("aria-pressed", "false");
  const readTap = await highlightPoint();
  await page.mouse.click(readTap.x, readTap.y);
  await expect(page.getByTestId("pdf-reader-highlight-comment")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByTestId("pdf-reader-highlight-comment")).toContainText(
    "Key passage"
  );
  // Opening a comment must not double as the chrome show/hide tap.
  await expect(page.getByTestId("pdf-reader-bar")).toHaveAttribute(
    "data-hidden",
    "false"
  );
  await shot("read-mode-comment");
  await page.getByTestId("pdf-reader-anno-close").click();
  await expect(page.getByTestId("pdf-reader-anno-menu")).toHaveCount(0);
  // Dismissing the comment by tapping elsewhere also keeps chrome stable.
  const dismissTap = await highlightPoint();
  await page.mouse.click(dismissTap.x, dismissTap.y);
  await expect(page.getByTestId("pdf-reader-highlight-comment")).toBeVisible({
    timeout: 10000,
  });
  const awayBox = await frame.boundingBox();
  await page.mouse.click(
    awayBox!.x + awayBox!.width * 0.5,
    awayBox!.y + awayBox!.height * 0.9
  );
  await expect(page.getByTestId("pdf-reader-anno-menu")).toHaveCount(0);
  await expect(page.getByTestId("pdf-reader-bar")).toHaveAttribute(
    "data-hidden",
    "false"
  );

  // 7. Ink: draw a stroke with pen/mouse input.
  await annotateToggle.click();
  await page.getByTestId("pdf-reader-tool-ink").click();
  const inkBox = await frame.boundingBox();
  const inkStart = {
    x: inkBox!.x + inkBox!.width * 0.25,
    y: inkBox!.y + inkBox!.height * 0.62,
  };
  await page.mouse.move(inkStart.x, inkStart.y);
  await page.mouse.down();
  await page.mouse.move(inkStart.x + 120, inkStart.y - 30, { steps: 10 });
  await page.mouse.move(inkStart.x + 220, inkStart.y + 20, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await sidecarItems(page, target.vaultPath)).length, {
      timeout: 10000,
    })
    .toBe(2);
  await shot("ink-stroke-drawn");

  // 8. Eraser scrubs the stroke away directly.
  await page.getByTestId("pdf-reader-tool-eraser").click();
  await expect(page.getByTestId("pdf-reader-eraser-surface").first()).toBeVisible();
  await page.mouse.move(inkStart.x, inkStart.y);
  await page.mouse.down();
  await page.mouse.move(inkStart.x + 120, inkStart.y - 30, { steps: 14 });
  await page.mouse.move(inkStart.x + 220, inkStart.y + 20, { steps: 14 });
  await page.mouse.up();
  await expect
    .poll(async () => (await sidecarItems(page, target.vaultPath)).length, {
      timeout: 10000,
    })
    .toBe(1);
  await shot("ink-erased");

  // 9. Done → back to reading; highlight (with comment) survives.
  await page.getByTestId("pdf-reader-annotate-done").click();
  await expect(page.getByTestId("pdf-reader-annotate-bar")).toHaveCount(0);
  await shot("back-to-read");
});
