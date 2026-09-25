import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * SN-168: link a self-contained HTML design in place from the Design page UI
 * (in-app portable HTML browser — not the host WinForms picker).
 * Runs on both desktop and mobile Playwright projects.
 */

const SAFE_FIXTURE = path.resolve(
  "C:/Projects/Safe/docs/design-system/Safe Switchgears Website (offline).html"
);
const SAFE_FILE_NAME = "Safe Switchgears Website (offline).html";
const SAFE_TITLE_MARKER = "Safe Switchgears";

const E2E_STATE_DIR = path.resolve(__dirname, "../.e2e-state");
const PORTABLE_ROOT = path.resolve(__dirname, "../.e2e-portable-vault-sn168");
const PORTABLE_NOTEBOOK_ID = "a168link1";
const SECTION_NAME = "Designs";
const EVIDENCE_DIR = path.resolve(__dirname, "evidence", "SN-168");

test.describe.configure({ mode: "serial" });
test.beforeEach(() => test.setTimeout(300_000));

test.afterAll(() => {
  // Restore empty registry so a full smoke suite does not keep SN-168's portable notebook.
  try {
    fs.mkdirSync(E2E_STATE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(E2E_STATE_DIR, "notebook-registry.json"),
      `${JSON.stringify({ version: 1, notebooks: [] }, null, 2)}\n`,
      "utf8"
    );
  } catch {
    // best-effort cleanup
  }
});

function seedPortableLinkedDesignFixture() {
  const sectionDir = path.join(PORTABLE_ROOT, SECTION_NAME);
  fs.mkdirSync(sectionDir, { recursive: true });
  fs.mkdirSync(E2E_STATE_DIR, { recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  // Wipe prior link sidecars / leftover vault design stubs from earlier runs.
  for (const entry of fs.readdirSync(sectionDir, { withFileTypes: true })) {
    if (
      entry.name.endsWith(".design-link.json") ||
      /^untitled-design/i.test(entry.name) ||
      /^sn168-link-host/i.test(entry.name)
    ) {
      fs.rmSync(path.join(sectionDir, entry.name), { force: true, recursive: true });
    }
  }

  expect(fs.existsSync(SAFE_FIXTURE), `SAFE fixture missing: ${SAFE_FIXTURE}`).toBe(true);
  const destHtml = path.join(sectionDir, SAFE_FILE_NAME);
  fs.copyFileSync(SAFE_FIXTURE, destHtml);

  fs.writeFileSync(
    path.join(E2E_STATE_DIR, "notebook-registry.json"),
    `${JSON.stringify(
      {
        version: 1,
        notebooks: [
          {
            id: PORTABLE_NOTEBOOK_ID,
            name: "SN-168 Link Designs",
            rootPath: PORTABLE_ROOT,
            addedAt: "2026-07-27T00:00:00.000Z",
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return { destHtml, sectionDir };
}

async function createEmptyDesignPage(page: Page): Promise<{ pagePath: string; title: string }> {
  const title = `SN168 Link Host ${Date.now().toString(36).slice(-6)}`;
  const notebookPath = `+${PORTABLE_NOTEBOOK_ID}`;
  const sectionPath = `${notebookPath}/${SECTION_NAME}`;

  const create = await page.request.post("/api/page", {
    data: {
      sectionPath,
      notebookPath,
      title,
      noteType: "design",
    },
  });
  expect(create.ok(), `create design failed: ${await create.text()}`).toBeTruthy();
  const created = (await create.json()) as { page: { path: string } };
  return { pagePath: created.page.path, title };
}

async function openDesignPage(page: Page, pagePath: string) {
  await page.addInitScript((activePagePath) => {
    window.localStorage.setItem("smart-notes-active-page", activePagePath);
  }, pagePath);
  await page.goto("/");
  await expect(page.getByTestId("design-page-view")).toBeVisible({ timeout: 90_000 });
}

test("SN-168: Link from source on design page (desktop + mobile)", async ({ page }, testInfo) => {
  const { destHtml, sectionDir } = seedPortableLinkedDesignFixture();
  const htmlBefore = fs
    .readdirSync(sectionDir)
    .filter((name) => name.toLowerCase().endsWith(".html"));
  expect(htmlBefore).toContain(SAFE_FILE_NAME);

  const { pagePath, title: placeholderTitle } = await createEmptyDesignPage(page);
  await openDesignPage(page, pagePath);

  await expect(page.getByTestId("design-link-from-source-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("design-link-from-source-primary")).toBeVisible();
  await page.getByTestId("design-link-from-source-primary").click();

  await expect(page.getByTestId("link-design-source-dialog")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("link-design-file-list")).toBeVisible();

  // Wait until the portable browser finishes loading (path leaves the placeholder).
  const pathLabel = page.getByTestId("link-design-current-path");
  await expect
    .poll(async () => ((await pathLabel.textContent()) ?? "").trim(), { timeout: 20_000 })
    .not.toBe("…");

  const pathText = ((await pathLabel.textContent()) ?? "").replace(/\//g, "\\");
  if (!/\\designs(?:\\|\/|$)/i.test(pathText)) {
    const folderBtn = page
      .getByTestId("link-design-source-dialog")
      .getByTestId("link-design-folder-btn")
      .filter({ hasText: SECTION_NAME });
    await expect(folderBtn.first()).toBeVisible({ timeout: 15_000 });
    await folderBtn.first().click();
  }

  const fileBtn = page
    .getByTestId("link-design-source-dialog")
    .getByTestId("link-design-file-btn")
    .filter({ hasText: SAFE_FILE_NAME });
  await expect(fileBtn.first()).toBeVisible({ timeout: 30_000 });
  await fileBtn.first().click();
  await page.getByTestId("link-design-confirm-btn").click();

  await expect(page.getByTestId("link-design-source-dialog")).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId("design-linked-source-path")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("design-linked-source-path")).toContainText(SAFE_FILE_NAME);
  await expect(page.getByTestId("design-page-view").locator("h1")).toContainText(SAFE_TITLE_MARKER, {
    timeout: 60_000,
  });
  const designSurfaceFitsViewport = await page
    .getByTestId("design-page-view")
    .evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  expect(designSurfaceFitsViewport).toBe(true);

  // The bundled artifact's JavaScript runs inside an opaque-origin sandbox:
  // no noscript fallback, and the unpacked design replaces the loading shell.
  const frame = page.frameLocator('[data-testid="design-page-frame"]');
  await expect(frame.getByText("This page requires JavaScript to display.")).toBeHidden({
    timeout: 60_000,
  });
  await expect(frame.locator(".page.active")).toBeVisible({ timeout: 60_000 });

  // No second tree/file entry: the current empty design stub is replaced by
  // the already-indexed SAFE HTML, leaving exactly one HTML file.
  const htmlAfter = fs
    .readdirSync(sectionDir)
    .filter((name) => name.toLowerCase().endsWith(".html"));
  expect(htmlAfter).toEqual([SAFE_FILE_NAME]);
  expect(fs.existsSync(path.join(sectionDir, path.basename(pagePath)))).toBe(false);
  expect(fs.existsSync(destHtml)).toBe(true);
  expect(fs.existsSync(destHtml.replace(/\.html$/i, ".design-link.json"))).toBe(true);
  await expect(page.getByText(placeholderTitle, { exact: true })).toHaveCount(0);

  // Source tab exposes the bundled HTML (spot-check inline style / title).
  await page.getByTestId("design-tab-source").click();
  await expect(page.getByTestId("design-source-editor")).toBeVisible({ timeout: 30_000 });
  const sourceText = await page
    .getByTestId("design-source-editor")
    .locator(".cm-content")
    .innerText();
  expect(sourceText).toContain("<style");
  expect(sourceText).toContain(SAFE_TITLE_MARKER);

  // ui_render still works for the linked design (desktop + mobile captures).
  const linkedPath = `+${PORTABLE_NOTEBOOK_ID}/${SECTION_NAME}/${SAFE_FILE_NAME}`;
  for (const viewport of ["desktop", "mobile"] as const) {
    const render = await page.request.post("/api/agent/vault", {
      data: { tool: "ui_render", args: { path: linkedPath, viewport } },
    });
    expect(render.ok(), `ui_render ${viewport}: ${await render.text()}`).toBeTruthy();
    const data = (await render.json()).result.data as { bytes: number; width: number };
    expect(data.bytes).toBeGreaterThan(1000);
    expect(data.width).toBeGreaterThan(0);
  }

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `link-from-source-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
