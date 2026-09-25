import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const VAULT = path.resolve(__dirname, "..", ".e2e-vault");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "evidence", "SN-63");
const SEED_PREFIX = "SN63-Perf";
const NOTEBOOK_COUNT = 3;
const SECTIONS_PER_NOTEBOOK = 3;
const PAGES_PER_SECTION = 10;

function syntheticNotebookName(index: number) {
  return `${SEED_PREFIX}-Notebook-${index}`;
}

function syntheticSectionName(index: number) {
  return `${SEED_PREFIX}-Section-${index}`;
}

function syntheticPageFileName(notebookIndex: number, sectionIndex: number, pageIndex: number) {
  return `${SEED_PREFIX}-nb${notebookIndex}-sec${sectionIndex}-p${pageIndex}.html`;
}

function syntheticPageHtml(title: string) {
  return `---
title: ${title}
created: 2026-06-17T00:00:00Z
updated: 2026-06-17T00:00:00Z
---
<p>${title} body for startup performance seeding.</p>
`;
}

async function seedSyntheticVault() {
  for (let notebookIndex = 0; notebookIndex < NOTEBOOK_COUNT; notebookIndex += 1) {
    const notebookName = syntheticNotebookName(notebookIndex);
    for (let sectionIndex = 0; sectionIndex < SECTIONS_PER_NOTEBOOK; sectionIndex += 1) {
      const sectionName = syntheticSectionName(sectionIndex);
      const sectionDir = path.join(VAULT, notebookName, sectionName);
      await fs.mkdir(sectionDir, { recursive: true });

      for (let pageIndex = 0; pageIndex < PAGES_PER_SECTION; pageIndex += 1) {
        const fileName = syntheticPageFileName(notebookIndex, sectionIndex, pageIndex);
        const title = fileName.replace(/\.html$/, "");
        await fs.writeFile(path.join(sectionDir, fileName), syntheticPageHtml(title), "utf8");
      }
    }
  }
}

async function removeSyntheticVault() {
  const entries = await fs.readdir(VAULT, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${SEED_PREFIX}-`))
      .map((entry) => fs.rm(path.join(VAULT, entry.name), { recursive: true, force: true }))
  );
}

async function invalidateVaultCache(request: APIRequestContext) {
  const response = await request.post("/api/vault?action=invalidate-cache");
  expect(response.ok()).toBeTruthy();
}

async function warmUpDevServer(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 60000 });
}

async function measureTimeToAppShell(page: Page, url: string) {
  const startedAt = Date.now();
  const isBaseline = url.includes("startupBaseline=1");
  await page.goto(url, { waitUntil: "commit" });
  await expect(page.getByTestId("app-shell")).toBeVisible({
    timeout: isBaseline ? 120_000 : 15_000,
  });
  return Date.now() - startedAt;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await removeSyntheticVault();
  await seedSyntheticVault();
});

test.afterAll(async () => {
  await removeSyntheticVault();
});

test("SN-63 desktop cold start is at least 50% faster than sequential baseline", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop project only");

  await warmUpDevServer(page);
  await invalidateVaultCache(request);
  const baselineTti = await measureTimeToAppShell(page, "/?startupBaseline=1");

  await invalidateVaultCache(request);
  const fixedTti = await measureTimeToAppShell(page, "/");

  expect(fixedTti).toBeLessThan(baselineTti * 0.5);
  expect(fixedTti).toBeLessThan(2000);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "sn-63-desktop-cold-start.png"),
    fullPage: true,
  });
});

test("SN-63 desktop vault loading indicator clears within 1s of shell render", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop project only");

  await warmUpDevServer(page);
  await invalidateVaultCache(request);
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 5000 });
  const shellVisibleAt = Date.now();

  await expect(page.getByTestId("vault-loading")).toBeHidden({ timeout: 1000 });
  await expect(page.getByTestId("tree")).toHaveAttribute("data-vault-ready", "true", { timeout: 1000 });

  const vaultReadyMs = Date.now() - shellVisibleAt;
  expect(vaultReadyMs).toBeLessThan(1000);
});

test("SN-63 mobile shell renders before vault hydration completes", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile project only");

  await warmUpDevServer(page);
  await invalidateVaultCache(request);
  const startedAt = Date.now();
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 5000 });
  const shellTti = Date.now() - startedAt;

  expect(shellTti).toBeLessThan(1500);
  await expect(page.getByTestId("open-sidebar-btn")).toBeVisible();

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "sn-63-mobile-shell-visible.png"),
    fullPage: true,
  });
});
