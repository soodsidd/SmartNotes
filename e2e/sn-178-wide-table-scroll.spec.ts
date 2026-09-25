import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureNotebookTreeVisible } from "./helpers";

const SECTION_PATH = "Personal Notebook/Quick Notes";
const EVIDENCE_DIR = path.resolve(__dirname, "../evidence/SN-178");

function tableRows(columns: string[], cellWidth?: number) {
  const width = cellWidth ? ` colwidth="${cellWidth}"` : "";
  return [
    "<table><tbody><tr>",
    ...columns.map((column) => `<th${width}><p>${column}</p></th>`),
    "</tr><tr>",
    ...columns.map((_, index) => `<td${width}><p>Value ${index + 1}</p></td>`),
    "</tr></tbody></table>",
  ].join("");
}

function sensorMatrixHtml() {
  const wideColumns = [
    "Sensor",
    "Location",
    "Range",
    "Accuracy",
    "Resolution",
    "Frequency",
    "Status",
    "Speed",
  ];
  return [
    "<h2>Sensor matrix</h2>",
    "<p>Owner-reported clipping reproduction.</p>",
    tableRows(wideColumns, 180),
    "<h2>Narrow reference</h2>",
    tableRows(["Sensor", "Status"]),
    ...Array.from(
      { length: 40 },
      (_, index) => `<p>Long-page trailing paragraph ${index + 1}.</p>`
    ),
  ].join("");
}

async function seedPage(request: APIRequestContext, title: string) {
  const create = await request.post("/api/page", {
    data: {
      notebookPath: "Personal Notebook",
      sectionPath: SECTION_PATH,
      title,
    },
  });
  expect(create.ok()).toBeTruthy();
  const created = (await create.json()) as { page: { path: string } };
  const content = sensorMatrixHtml();
  const update = await request.put("/api/page", {
    data: { path: created.page.path, title, content },
  });
  expect(update.ok()).toBeTruthy();
  return { path: created.page.path, content };
}

async function openSeededPage(page: Page, title: string) {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20_000 });
  const tree = await ensureNotebookTreeVisible(page);
  await tree.getByText(title, { exact: true }).first().click();
  await expect(
    page.locator('header[data-print-chrome="true"]').getByText(title, { exact: true })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Table scroll area" }).first()).toBeVisible({
    timeout: 20_000,
  });
}

test("SN-178: an eight-column table scrolls locally under a collapsible heading", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const title = `sn178-${testInfo.project.name}-${Date.now()}-sensor-matrix`;
  const seeded = await seedPage(request, title);

  try {
    await openSeededPage(page, title);

    const tables = page.locator('[data-table-scroll="true"]');
    await expect(tables).toHaveCount(2);
    const wideTable = tables.first();
    const narrowTable = tables.nth(1);
    await expect(wideTable).toHaveAttribute("role", "region");
    await expect(wideTable).toHaveAttribute("aria-label", "Table scroll area");
    const finalColumn = wideTable.getByRole("columnheader", { name: "Speed" });
    const editorScrollArea = page.locator(".editor-scroll-area");
    const pageScrollTopBefore = await editorScrollArea.evaluate((element) => element.scrollTop);

    const initial = await wideTable.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
    }));
    expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
    expect(initial.scrollLeft).toBe(0);

    const initialRects = await Promise.all([wideTable.boundingBox(), finalColumn.boundingBox()]);
    expect(initialRects[0]).not.toBeNull();
    expect(initialRects[1]).not.toBeNull();
    expect(initialRects[1]!.x + initialRects[1]!.width).toBeGreaterThan(
      initialRects[0]!.x + initialRects[0]!.width
    );

    await wideTable.hover();
    await page.mouse.wheel(initial.scrollWidth, 0);
    await expect
      .poll(() => wideTable.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);

    const scrolledRects = await Promise.all([wideTable.boundingBox(), finalColumn.boundingBox()]);
    expect(scrolledRects[0]).not.toBeNull();
    expect(scrolledRects[1]).not.toBeNull();
    expect(scrolledRects[1]!.x + scrolledRects[1]!.width).toBeLessThanOrEqual(
      scrolledRects[0]!.x + scrolledRects[0]!.width + 1
    );
    expect(await editorScrollArea.evaluate((element) => element.scrollTop)).toBe(pageScrollTopBefore);

    const narrowMetrics = await narrowTable.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(narrowMetrics.scrollWidth).toBeLessThanOrEqual(narrowMetrics.clientWidth + 1);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-wide-table-scrolled.png`),
      fullPage: false,
    });

    const collapse = page.getByTestId("heading-collapse-toggle-0");
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-pressed", "true");
    await expect(wideTable).toBeHidden();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-table-collapsed.png`),
      fullPage: false,
    });

    await collapse.click();
    await expect(wideTable).toBeVisible();
    await wideTable.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect(finalColumn).toBeInViewport();

    const stored = await request.get(`/api/page?path=${encodeURIComponent(seeded.path)}`);
    expect(stored.ok()).toBeTruthy();
    const payload = (await stored.json()) as { page: { content: string } };
    expect(payload.page.content).toContain("Speed");
    expect(payload.page.content).not.toContain("tableWrapper");
    expect(payload.page.content).not.toContain("Table scroll area");
  } finally {
    await request.delete(`/api/page?path=${encodeURIComponent(seeded.path)}`).catch(() => undefined);
  }
});
