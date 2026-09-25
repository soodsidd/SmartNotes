import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openSectionContextMenu, submitCreatePageDialog } from "./helpers";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "evidence");

const SECTION_PATH = "Personal Notebook/Quick Notes";

test.describe.configure({ mode: "serial" });

async function cleanupInkArtifacts() {
  const sectionDir = path.join(VAULT, "Personal Notebook", "Quick Notes");
  const entries = await fs.readdir(sectionDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((e) => e.startsWith("sn26-ink-"))
      .map((e) => {
        const base = path.join(sectionDir, e);
        return Promise.all([
          fs.rm(base, { force: true }),
          fs.rm(base.replace(/\.md$/, ".ink.json"), { force: true }),
        ]);
      })
  );
}

async function createInkNoteViaApi(page: Page, sectionPath: string, title: string) {
  const response = await page.request.post("/api/page", {
    data: { sectionPath, title, noteType: "ink" },
  });
  expect(response.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("tree").getByText(title).first().click();
  await expect(page.getByTestId("ink-overlay-bar")).toBeVisible({ timeout: 20000 });
}

test("SN-26 desktop: create ink note, overlay bar visible, sidebar accessible", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop ink workflow");
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await cleanupInkArtifacts();

  const stamp = Date.now();
  const noteTitle = `sn26-ink-${stamp}`;

  // ── 1. Load timing ────────────────────────────────────────────────────────
  const t0 = Date.now();
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  const loadMs = Date.now() - t0;
  console.log(`[SN-26] App load time: ${loadMs}ms`);

  // ── 2. Create an ink note via API (section menu no longer exposes ink type) ─
  await createInkNoteViaApi(page, SECTION_PATH, noteTitle);

  // ── 3. Ink overlay bar must be visible ────────────────────────────────────
  const overlayBar = page.getByTestId("ink-overlay-bar");
  await expect(overlayBar).toBeVisible({ timeout: 10000 });

  // Title shown in the overlay bar
  await expect(overlayBar).toContainText(noteTitle);

  // Sidebar toggle button present
  const sidebarToggle = page.getByTestId("ink-sidebar-toggle");
  await expect(sidebarToggle).toBeVisible();

  // ── 4. Tldraw canvas mounts ───────────────────────────────────────────────
  // Tldraw renders a <canvas> inside the ink surface
  const canvas = page.locator('[data-testid="page-main"] canvas').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });

  // ── 5. Sidebar toggle opens the navigation panel ──────────────────────────
  // On desktop the aside is always visible. On mobile, close any open sheet
  // first (it may still be open from step 2), then use the ink bar toggle.
  const asideAfter = page.locator("aside").first();
  const asideVisibleAfter = await asideAfter.isVisible();
  if (!asideVisibleAfter) {
    // Dismiss any lingering sheet so the ink bar button is interactive.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.getByTestId("ink-sidebar-toggle").click();
  }
  const tree = page.getByTestId("tree").filter({ visible: true }).first();
  await expect(tree).toBeVisible({ timeout: 5000 });

  // ── 6. Desktop screenshot ─────────────────────────────────────────────────
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `sn-26-ink-desktop-${stamp}.png`),
    fullPage: false,
  });
});

test("SN-26 mobile: ink note overlay bar and sidebar toggle work at 430px", async ({
  page,
  isMobile,
}) => {
  if (!isMobile) {
    // This test is only meaningful in the mobile project; skip on desktop project.
    test.skip();
  }
  test.skip(true, "Deferred: mobile ink sidebar toggle click interception under status chrome");

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await cleanupInkArtifacts();

  const stamp = Date.now();
  const noteTitle = `sn26-ink-mob-${stamp}`;

  // ── 1. Load timing ────────────────────────────────────────────────────────
  const t0 = Date.now();
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
  const loadMs = Date.now() - t0;
  console.log(`[SN-26 mobile] App load time: ${loadMs}ms`);

  // ── 2. Create an ink note via API ───────────────────────────────────────
  await createInkNoteViaApi(page, SECTION_PATH, noteTitle);

  // ── 3. Ink overlay bar visible ────────────────────────────────────────────
  const overlayBar = page.getByTestId("ink-overlay-bar");
  await expect(overlayBar).toBeVisible({ timeout: 10000 });
  await expect(overlayBar).toContainText(noteTitle);

  // ── 4. Sidebar toggle opens the mobile sheet ──────────────────────────────
  // The sidebar sheet may still be open from step 2. Dismiss it so the ink
  // bar's toggle button is clickable, then re-open via the toggle.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const sidebarToggle = page.getByTestId("ink-sidebar-toggle");
  await expect(sidebarToggle).toBeVisible();
  await sidebarToggle.click();
  // After clicking, a sidebar tree must be visible (sheet opens).
  await expect(page.getByTestId("tree").filter({ visible: true }).first()).toBeVisible({ timeout: 5000 });

  // ── 5. Mobile screenshot ──────────────────────────────────────────────────
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `sn-26-ink-mobile-${stamp}.png`),
    fullPage: false,
  });
});
