import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { dismissBlockingOverlays } from "./helpers";

/**
 * SN-365: in desktop dual-pane nav (notebook rail + page pane) the page-row paper count opens
 * the central Bibliography, filtered to that page's papers — even when the rail was collapsed.
 */
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-365");
const SLOW = { timeout: 30_000 };

async function createPaper(page: Page, title: string) {
  const response = await page.request.post("/api/papers", { data: { title, homeNotebookPath: "Personal Notebook" } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()).page as { path: string; metadata: { paper_id: string } };
  return { id: String(created.metadata.paper_id), path: created.path };
}

test("SN-365: dual-pane page paper count opens the filtered Bibliography in the rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "dual-pane nav is the desktop (xl) layout");
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const stamp = Date.now().toString(36);
  const referenced = await createPaper(page, `SN365 Referenced ${stamp}`);
  const other = await createPaper(page, `SN365 Other ${stamp}`);
  const title = `SN365 Topic ${stamp}`;
  const created = await page.request.post("/api/page", { data: { sectionPath: "Personal Notebook/Quick Notes", title } });
  expect(created.ok()).toBe(true);
  const topic = (await created.json()).page as { path: string };
  const content = `<h1>${title}</h1><p>Reads one paper.</p><div data-type="paper-reference" data-paper-id="${referenced.id}"></div>`;
  expect((await page.request.put("/api/page", { data: { path: topic.path, title, content } })).ok()).toBe(true);

  await page.goto(`/?page=${encodeURIComponent(topic.path)}`);
  await dismissBlockingOverlays(page);
  const rail = page.getByTestId("notebook-rail-sidebar");
  const pagePane = page.getByTestId("tree-sidebar-rail");
  await expect(rail).toBeVisible(SLOW);
  await expect(pagePane).toBeVisible(SLOW);

  // Start with the rail collapsed: the count must still reveal the Bibliography.
  if ((await rail.getAttribute("data-collapsed")) !== "true") await page.getByTestId("notebook-rail-collapse").click();
  await expect(rail).toHaveAttribute("data-collapsed", "true");

  const count = pagePane.getByTestId(`page-paper-count-${topic.path}`);
  await expect(count).toBeVisible(SLOW);
  await expect(count).toContainText("1");
  const urlBefore = page.url();
  await count.click();

  await expect(rail).toHaveAttribute("data-collapsed", "false");
  const library = rail.getByTestId("bibliography-library");
  await expect(library).toBeVisible();
  await expect(library).toBeInViewport();
  await expect(rail.getByTestId("bibliography-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(rail.getByTestId("bibliography-page-filter")).toContainText(`Papers referenced by ${title}`);
  await expect(library.getByTestId(`bibliography-paper-${referenced.id}`)).toBeVisible();
  await expect(library.getByTestId(`bibliography-paper-${other.id}`)).toHaveCount(0);
  // The control stops propagation: the page stays the active page (no navigation).
  expect(page.url()).toBe(urlBefore);
  await expect(page.getByTestId("rich-text-editor")).toContainText("Reads one paper.");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-dual-pane-filtered.png") });

  // Clear filter restores the full A–Z list.
  await rail.getByRole("button", { name: "Clear filter" }).click();
  await expect(rail.getByTestId("bibliography-page-filter")).toHaveCount(0);
  await expect(library.getByTestId(`bibliography-paper-${other.id}`)).toBeVisible();
  await expect(library.getByTestId(`bibliography-paper-${referenced.id}`)).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "desktop-dual-pane-cleared.png") });

  // Re-filter, then the Bibliography toggle drops the filter and keeps the full list open.
  await count.click();
  await expect(rail.getByTestId("bibliography-page-filter")).toBeVisible();
  await rail.getByTestId("bibliography-toggle").click();
  await expect(rail.getByTestId("bibliography-page-filter")).toHaveCount(0);
  await expect(library.getByTestId(`bibliography-paper-${other.id}`)).toBeVisible();
  // A second toggle closes it.
  await rail.getByTestId("bibliography-toggle").click();
  await expect(library).toHaveCount(0);
});
