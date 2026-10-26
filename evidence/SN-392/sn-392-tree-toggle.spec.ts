import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureNotebookTreeVisible } from "../../e2e/helpers";

// SN-392 evidence harness (not a catalog regression): real mouse clicks / touch taps on the
// tree expand/collapse chevrons at desktop and phone viewports.
const NOTEBOOK = "Personal Notebook";
const SECTION = "Personal Notebook/Quick Notes";
const OUT = __dirname;

function visible(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId.replace(/"/g, '\\"')}"]`).filter({ visible: true }).first();
}

async function shot(page: Page, file: string) {
  // page.screenshot() stalls on "waiting for fonts" against the dev server; CDP capture does not.
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(data, "base64"));
  await cdp.detach();
}

async function hit(page: Page, target: Locator, mobile: boolean, dx = 0, dy = 0) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2 + dx;
  const y = box.y + box.height / 2 + dy;
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function toggleRepeatedly(page: Page, toggle: Locator, mobile: boolean, times: number, revealed: () => Locator) {
  const box = (await toggle.boundingBox())!;
  // A finger lands near, not on, the glyph: center, +/-8px horizontally, and 4px inside the top/bottom edges.
  const offsets = [[0, 0], [-8, 0], [8, 0], [0, -box.height / 2 + 4], [0, box.height / 2 - 4]];
  let expanded = (await toggle.getAttribute("aria-expanded")) === "true";
  let misses = 0;
  for (let i = 0; i < times; i += 1) {
    const [dx, dy] = offsets[i % offsets.length];
    await hit(page, toggle, mobile, dx, dy);
    expanded = !expanded;
    const ok = await expect(toggle).toHaveAttribute("aria-expanded", String(expanded), { timeout: 2000 }).then(() => true, () => false);
    if (!ok) {
      console.log(`MISS i=${i} offset=${dx},${dy} label=${await toggle.getAttribute("aria-label")}`);
      misses += 1;
      expanded = !expanded;
    }
    if (expanded) await expect(revealed()).toBeVisible();
    else await expect(revealed()).toBeHidden();
  }
  return { box: { width: Math.round(box.width), height: Math.round(box.height) }, misses };
}

test("SN-392 rail + nested page chevrons hit reliably and stay collapsed across live refresh", async ({ page, request }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  const stamp = Date.now();
  const parentRes = await request.post("/api/page", { data: { notebookPath: NOTEBOOK, sectionPath: SECTION, title: `SN392 Parent ${stamp}` } });
  expect(parentRes.ok()).toBe(true);
  const parent = (await parentRes.json()).page as { path: string };
  const childRes = await request.post("/api/page", { data: { notebookPath: NOTEBOOK, sectionPath: SECTION, title: `SN392 Child ${stamp}`, parentId: parent.path } });
  expect(childRes.ok()).toBe(true);
  const child = (await childRes.json()).page as { path: string };

  // Startup hydration re-fetches the tree (skipCache) and reveals the deep-linked page; on a cold dev
  // server that fetch can land many seconds later, so wait for it before exercising the toggles.
  const hydrated = page.waitForResponse((r) => r.url().includes("/api/vault?") && r.url().includes("skipCache=1") && r.request().method() === "GET", { timeout: 60000 });
  await page.goto(`/?page=${encodeURIComponent(child.path)}`);
  await hydrated;
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30000 });
  await ensureNotebookTreeVisible(page);

  const notebookToggle = visible(page, `rail-notebook-toggle-${NOTEBOOK}`);
  await expect(notebookToggle).toBeVisible({ timeout: 15000 });
  // Collapse state persists across runs (e.g. desktop then mobile); start from expanded.
  if ((await notebookToggle.getAttribute("aria-expanded")) !== "true") await hit(page, notebookToggle, mobile);
  await expect(notebookToggle).toHaveAttribute("aria-expanded", "true");
  const sectionRow = () => visible(page, `rail-section-row-${SECTION}`);
  await shot(page, `${testInfo.project.name}-expanded.png`);

  const activeBefore = await page.locator("[aria-current='page']").filter({ visible: true }).allTextContents();
  const rail = await toggleRepeatedly(page, notebookToggle, mobile, 11, sectionRow);
  await shot(page, `${testInfo.project.name}-sections-collapsed.png`);
  expect(rail.misses).toBe(0);

  // Collapse the active notebook's sections, then force a live vault refresh (window focus ->
  // refreshVaultTreeFromLive, which previously re-expanded the active page's ancestors): it must stay collapsed.
  await expect(notebookToggle).toHaveAttribute("aria-expanded", "false");
  await request.post("/api/page", { data: { notebookPath: NOTEBOOK, sectionPath: SECTION, title: `SN392 Refresh ${stamp}` } });
  const refreshed = page.waitForResponse((r) => r.url().includes("/api/vault") && r.request().method() === "GET", { timeout: 15000 }).then(() => true, () => false);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const liveRefreshObserved = await refreshed;
  await page.waitForTimeout(1500);
  await expect(notebookToggle).toHaveAttribute("aria-expanded", "false");
  await expect(sectionRow()).toBeHidden();
  await shot(page, `${testInfo.project.name}-collapsed-after-live-refresh.png`);

  await hit(page, notebookToggle, mobile);
  await expect(notebookToggle).toHaveAttribute("aria-expanded", "true");
  // Phones drill from the rail into the section's page list.
  if (mobile) await sectionRow().tap();

  const pageToggle = visible(page, `page-toggle-${parent.path}`);
  await expect(pageToggle).toBeVisible();
  if ((await pageToggle.getAttribute("aria-expanded")) !== "true") await hit(page, pageToggle, mobile);
  await shot(page, `${testInfo.project.name}-nested-expanded.png`);
  const nested = await toggleRepeatedly(page, pageToggle, mobile, 11, () => visible(page, `page-${child.path}`));
  await shot(page, `${testInfo.project.name}-nested-collapsed.png`);
  expect(nested.misses).toBe(0);
  // No toggle hit selected a row or opened the parent page.
  await expect(visible(page, `page-${parent.path}`)).toHaveAttribute("data-selected", "false");
  await hit(page, pageToggle, mobile);
  await expect(visible(page, `page-${child.path}`)).toBeVisible();
  await expect(visible(page, `page-${child.path}`)).toHaveAttribute("data-selected", "true");
  const activeAfter = await page.locator("[aria-current='page']").filter({ visible: true }).allTextContents();
  if (!mobile) for (const label of activeBefore) expect(activeAfter).toContain(label);

  const result = {
    project: testInfo.project.name,
    railNotebookToggle: { hitBox: rail.box, toggles: 11, misses: rail.misses },
    nestedPageToggle: { hitBox: nested.box, toggles: 11, misses: nested.misses },
    activeBeforeToggles: activeBefore,
    activeAfterToggles: activeAfter,
    childStillSelectedAfterToggles: true,
    liveRefreshObserved,
    stayedCollapsedAfterLiveRefresh: true,
  };
  fs.writeFileSync(path.join(OUT, `${testInfo.project.name}-results.json`), JSON.stringify(result, null, 2));
});
