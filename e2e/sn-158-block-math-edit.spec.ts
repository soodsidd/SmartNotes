import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const SECTION_PATH = "Personal Notebook/Quick Notes";

async function cleanupArtifacts(stamp: string) {
  const sectionDir = path.join(VAULT, "Personal Notebook", "Quick Notes");
  const entries = await fs.readdir(sectionDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((e) => e.includes(`sn158-${stamp}`))
      .map((e) => fs.rm(path.join(sectionDir, e), { force: true }))
  );
}

async function seedMathPage(
  request: import("@playwright/test").APIRequestContext,
  title: string
) {
  const html =
    '<p>Prefix text </p>' +
    '<p><span data-type="inline-math" data-latex="a+b"></span> inline tail</p>' +
    '<div data-type="block-math" data-latex="E=mc^2"></div>' +
    '<p>Suffix text</p>';
  const create = await request.post("/api/page", {
    data: { notebookPath: "Personal Notebook", sectionPath: SECTION_PATH, title },
  });
  expect(create.ok()).toBeTruthy();
  const created = (await create.json()) as { page: { path: string } };
  const put = await request.put("/api/page", {
    data: { path: created.page.path, title, content: html },
  });
  expect(put.ok()).toBeTruthy();
  return created.page.path;
}

async function openSeededPage(page: Page, title: string) {
  const asideVisible = await page.locator("aside").first().isVisible();
  if (!asideVisible) await page.getByTestId("open-sidebar-btn").click();
  await page.getByTestId("tree").getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId("annotated-editor-panel")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".ProseMirror")).toContainText("Suffix text", { timeout: 15000 });
}

async function readPageHtml(pagePath: string): Promise<string> {
  const abs = path.join(VAULT, ...pagePath.split("/"));
  return fs.readFile(abs, "utf8").catch(() => "");
}

function countMatches(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("SN-158 desktop: editing inline and block equations uses the anchored editor, not the dialog", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow only");
  const stamp = String(Date.now());
  const noteTitle = `sn158-${stamp}-math`;
  await cleanupArtifacts(stamp);

  const pagePath = await seedMathPage(request, noteTitle);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  await openSeededPage(page, noteTitle);

  const compose = page.getByTestId("inline-math-compose");
  const dialog = page.getByTestId("math-dialog");
  const composeInput = page.getByTestId("inline-math-compose-input");

  // ── Block equation: click opens the anchored editor, never the top dialog ──
  const blockMath = page.locator('[data-type="block-math"]').first();
  await expect(blockMath).toBeVisible();
  await blockMath.click();

  await expect(compose).toBeVisible();
  await expect(compose).toHaveAttribute("data-math-kind", "block");
  await expect(dialog).toHaveCount(0); // AC: legacy dialog stays closed
  await expect(composeInput).toHaveValue("E=mc^2");

  // Escape cancels without changing the node.
  await composeInput.press("Escape");
  await expect(compose).toHaveCount(0);

  // Re-open and commit an edit with Enter — update in place, still a block node.
  await blockMath.click();
  await expect(compose).toHaveAttribute("data-math-kind", "block");
  await composeInput.fill("\\frac{a}{b}");
  await composeInput.press("Enter");
  await expect(compose).toHaveCount(0);

  await page.waitForResponse(
    (r) => r.url().includes("/api/page") && r.request().method() === "PUT" && r.status() === 200
  );
  await expect
    .poll(async () => {
      const html = await readPageHtml(pagePath);
      return {
        block: countMatches(html, 'data-type="block-math"'),
        latex: html.includes('data-latex="\\frac{a}{b}"') || html.includes("\\frac{a}{b}"),
        stillInline: countMatches(html, 'data-type="inline-math"'),
      };
    }, { timeout: 10000 })
    .toEqual({ block: 1, latex: true, stillInline: 1 });

  // ── Inline equation: click also opens the anchored editor, not the dialog ──
  const inlineMath = page.locator('[data-type="inline-math"]').first();
  await inlineMath.click();
  await expect(compose).toBeVisible();
  await expect(compose).toHaveAttribute("data-math-kind", "inline");
  await expect(dialog).toHaveCount(0);
  await composeInput.press("Escape");
  await expect(compose).toHaveCount(0);

  await cleanupArtifacts(stamp);
});
