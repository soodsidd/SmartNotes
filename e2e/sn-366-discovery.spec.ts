import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { dismissBlockingOverlays } from "./helpers";

// SN-366 discovery pass: observe (do not assert) every promote-to-paper entry point
// and the paper reading shell chrome. Findings are written to evidence/SN-366/discovery.
const PDF_FIXTURE = path.resolve(__dirname, "fixtures/catalogue-final.pdf");
const OUT = path.resolve(__dirname, "../evidence/SN-366/discovery");
const SLOW = { timeout: 60_000 };

type Finding = { step: string; observed: unknown };

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
  const save = await page.request.put("/api/page", { data: { path: article.path, title, content } });
  expect(save.ok()).toBe(true);
  return { path: article.path, href };
}

async function pageContent(page: Page, pagePath: string) {
  return (await (await page.request.get(`/api/page?path=${encodeURIComponent(pagePath)}`)).json()).page.content as string;
}

async function optionalText(locator: import("@playwright/test").Locator) {
  return (await locator.count()) ? locator.first().textContent({ timeout: 2000 }).catch(() => null) : null;
}

async function topmostIs(page: Page, testId: string) {
  return page.evaluate((id) => {
    const target = document.querySelector(`[data-testid="${id}"]`);
    if (!target) return "missing";
    const rect = target.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + Math.min(20, rect.height / 2));
    return hit && target.contains(hit) ? "topmost" : `covered-by:${hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? hit?.tagName}`;
  }, testId);
}

for (const width of (process.env.SN366_WIDTHS ?? "1280,900").split(",").map(Number)) {
  test(`SN-366 discovery @${width}`, async ({ page }, testInfo) => {
    // Exploratory pass (observes, does not assert). Opt-in: SN366_DISCOVERY=1 [SN366_WIDTHS=1280,900].
    test.skip(testInfo.project.name !== "desktop" || !process.env.SN366_DISCOVERY);
    test.setTimeout(420_000);
    await page.setViewportSize({ width, height: 800 });
    fs.mkdirSync(OUT, { recursive: true });
    const findings: Finding[] = [];
    const note = (step: string, observed: unknown) => findings.push({ step, observed });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 300)}`); });
    const stamp = `${width}-${Date.now().toString(36)}`;
    const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${width}-${name}.png`) });

    try {
      // A. Chip context menu → Promote to paper.
      const a = await seedPageWithPdf(page, `SN366 A ${stamp}`, `alpha-${stamp}.pdf`);
      await page.goto(`/?page=${encodeURIComponent(a.path)}`);
      await dismissBlockingOverlays(page);
      const chipA = page.locator('.tiptap [data-file-type="pdf"]').first();
      await expect(chipA).toBeVisible(SLOW);
      await chipA.click({ button: "right" });
      const promoteItem = page.getByTestId("ctx-promote-pdf");
      note("A.context-menu promote item visible", await promoteItem.isVisible().catch(() => false));
      await shot("A1-context-menu");
      if (await promoteItem.isVisible().catch(() => false)) {
        await promoteItem.click();
        await page.waitForTimeout(1500);
        note("A.reader opened after Promote click", await page.getByTestId("pdf-reader").isVisible().catch(() => false));
        const dialog = page.getByTestId("promote-pdf-dialog");
        note("A.dialog visible", await dialog.isVisible({ timeout: 5000 }).catch(() => false));
        note("A.dialog title default", await page.getByTestId("promote-pdf-title").inputValue().catch(() => null));
        note("A.dialog home default", await page.getByTestId("promote-pdf-home").inputValue().catch(() => null));
        // Type a custom title, then wait to see whether a tree refresh resets it.
        await page.getByTestId("promote-pdf-title").fill(`Promoted A ${stamp}`);
        await page.waitForTimeout(4000);
        note("A.title after 4s idle", await page.getByTestId("promote-pdf-title").inputValue().catch(() => null));
        await shot("A2-dialog");
        await page.getByTestId("promote-pdf-submit").click();
        await page.waitForTimeout(6000);
        note("A.dialog still open after submit", await dialog.isVisible().catch(() => false));
        note("A.dialog error", await optionalText(dialog.getByRole("alert")));
        const content = await pageContent(page, a.path);
        note("A.server page has paper-reference", content.includes('data-type="paper-reference"'));
        note("A.server reference before pdf chip", content.indexOf("paper-reference") > -1 && content.indexOf("paper-reference") < content.indexOf('data-file-type="pdf"'));
        note("A.editor shows paper chip", await page.locator(".tiptap [data-paper-reference]").count());
        note("A.toasts", await page.locator("[data-sonner-toast]").allTextContents());
        await shot("A3-after-submit");
        await page.waitForTimeout(3000);
        note("A.server content after 3s settle still has reference", (await pageContent(page, a.path)).includes('data-type="paper-reference"'));
        note("A.editor chip count after settle", await page.locator(".tiptap [data-paper-reference]").count());
        // Promote the same PDF again → should reuse paper, not duplicate.
        const papersBefore = (await (await page.request.get("/api/papers")).json()).papers.length;
        await chipA.click({ button: "right" });
        if (await promoteItem.isVisible().catch(() => false)) {
          await promoteItem.click();
          await page.getByTestId("promote-pdf-submit").click();
          await page.waitForTimeout(5000);
          note("A.repromote papers delta", (await (await page.request.get("/api/papers")).json()).papers.length - papersBefore);
          note("A.repromote reference count", ((await pageContent(page, a.path)).match(/data-type="paper-reference"/g) ?? []).length);
          note("A.repromote toasts", await page.locator("[data-sonner-toast]").allTextContents());
        }
      }

      // B. Immersive reader → Save as paper.
      const b = await seedPageWithPdf(page, `SN366 B ${stamp}`, `beta-${stamp}.pdf`);
      await page.goto(`/?page=${encodeURIComponent(b.path)}`);
      await dismissBlockingOverlays(page);
      const chipB = page.locator('.tiptap [data-file-type="pdf"]').first();
      await expect(chipB).toBeVisible(SLOW);
      await chipB.click();
      await expect(page.getByTestId("pdf-reader")).toBeVisible(SLOW);
      const save = page.getByTestId("pdf-reader-save-as-paper");
      await save.waitFor({ state: "visible", timeout: 60_000 }).catch(() => undefined);
      note("B.save-as-paper visible", await save.isVisible().catch(() => false));
      if (await save.isVisible().catch(() => false)) {
        await save.click();
        const dialog = page.getByTestId("promote-pdf-dialog");
        await page.waitForTimeout(1000);
        note("B.dialog in DOM", await dialog.count());
        note("B.dialog topmost", await topmostIs(page, "promote-pdf-dialog"));
        await shot("B1-save-as-paper-dialog");
        const submit = page.getByTestId("promote-pdf-submit");
        const clicked = await submit.click({ timeout: 5000 }).then(() => true).catch((error) => `click failed: ${String(error).split("\n")[0]}`);
        note("B.submit click", clicked);
        await page.waitForTimeout(6000);
        note("B.reader open after submit", await page.getByTestId("pdf-reader").isVisible().catch(() => false));
        note("B.server page has paper-reference", (await pageContent(page, b.path)).includes('data-type="paper-reference"'));
        note("B.toasts", await page.locator("[data-sonner-toast]").allTextContents());
        await shot("B2-after-submit");
      }
      if (await page.getByTestId("pdf-reader").isVisible().catch(() => false)) {
        await page.keyboard.press("Escape");
        await page.getByTestId("pdf-reader-close").click({ timeout: 10_000 }).catch(() => undefined);
        await expect(page.getByTestId("pdf-reader")).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
      }

      // C. Attach paper → Create → Choose from this page.
      const c = await seedPageWithPdf(page, `SN366 C ${stamp}`, `gamma-${stamp}.pdf`);
      await page.goto(`/?page=${encodeURIComponent(c.path)}`);
      await dismissBlockingOverlays(page);
      await expect(page.locator('.tiptap [data-file-type="pdf"]').first()).toBeVisible(SLOW);
      const insertTrigger = page.getByTestId("toolbar-insert-menu");
      note("C.insert trigger visible", await insertTrigger.isVisible().catch(() => false));
      await insertTrigger.click().catch(() => undefined);
      const attach = page.getByTestId("toolbar-attach-paper");
      note("C.attach paper item visible", await attach.isVisible({ timeout: 3000 }).catch(() => false));
      if (await attach.isVisible().catch(() => false)) {
        await attach.click();
        const dialog = page.getByTestId("attach-paper-dialog");
        await expect(dialog).toBeVisible(SLOW);
        await dialog.getByRole("button", { name: "Create a paper" }).click();
        const pdfSelect = page.getByTestId("attach-paper-page-pdf");
        note("C.page pdf select visible", await pdfSelect.isVisible().catch(() => false));
        note("C.page pdf options", await pdfSelect.locator("option").allTextContents().catch(() => []));
        const options = await pdfSelect.locator("option").evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value)).catch(() => [] as string[]);
        const value = options.find(Boolean);
        if (value) await pdfSelect.selectOption(value);
        const titleInput = dialog.getByLabel("Title", { exact: true });
        note("C.title after choosing pdf", await titleInput.inputValue().catch(() => null));
        await shot("C1-choose-from-page");
        await dialog.getByRole("button", { name: "Create and attach" }).click();
        await page.waitForTimeout(6000);
        note("C.dialog still open", await dialog.isVisible().catch(() => false));
        note("C.dialog error", await optionalText(dialog.getByRole("alert")));
        const content = await pageContent(page, c.path);
        note("C.server reference count", (content.match(/data-type="paper-reference"/g) ?? []).length);
        note("C.reference before pdf chip", content.indexOf("paper-reference") > -1 && content.indexOf("paper-reference") < content.indexOf('data-file-type="pdf"'));
        note("C.toasts", await page.locator("[data-sonner-toast]").allTextContents());
        await shot("C2-after-create");
      }

      // D. Paper reading shell chrome: open the promoted paper (from A), then its PDF.
      const papers = (await (await page.request.get("/api/papers")).json()).papers as Array<{ id: string; page: { path: string; title: string; content: string } }>;
      const paperA = papers.find((entry) => entry.page.title === `Promoted A ${stamp}`);
      note("D.paper A found with title", Boolean(paperA));
      const paperAny = paperA ?? papers.find((entry) => entry.page.title.includes(stamp));
      if (paperAny) {
        note("D.paper body has pdf chip", (await pageContent(page, paperAny.page.path)).includes('data-file-type="pdf"'));
        // Open from the referring page via the chip so paperBackTarget has a referrer.
        await page.goto(`/?page=${encodeURIComponent(a.path)}`);
        await dismissBlockingOverlays(page);
        const refChip = page.locator(`[data-paper-reference="${paperAny.id}"]`).first();
        note("D.ref chip visible on referring page", await refChip.isVisible({ timeout: 15000 }).catch(() => false));
        await page.goto(`/?page=${encodeURIComponent(paperAny.page.path)}`);
        await dismissBlockingOverlays(page);
        await expect(page.getByTestId("paper-ownership")).toBeVisible(SLOW);
        await page.locator('.tiptap [data-file-type="pdf"]').first().click();
        await expect(page.getByTestId("pdf-reader")).toBeVisible(SLOW);
        await page.waitForTimeout(1500);
        note("D.topbar buttons", await page.getByTestId("paper-reading-topbar").locator("button").allTextContents().catch(() => []));
        note("D.reader close visible", await page.getByTestId("pdf-reader-close").isVisible().catch(() => false));
        note("D.notes dock visible", await page.getByTestId("paper-notes-dock").isVisible().catch(() => false));
        note("D.notes toggle visible", await page.getByTestId("pdf-reader-paper-notes-toggle").isVisible().catch(() => false));
        await shot("D1-paper-shell");
        await page.getByTestId("paper-reading-back").click();
        await page.waitForTimeout(4000);
        note("D.after back-to-topic url", page.url());
        note("D.reader closed", !(await page.getByTestId("pdf-reader").isVisible().catch(() => false)));
        await shot("D2-after-back-to-topic");
      }
    } finally {
      note("errors", errors.slice(0, 40));
      fs.writeFileSync(path.join(OUT, `findings-${width}.json`), JSON.stringify(findings, null, 2));
    }
  });
}
