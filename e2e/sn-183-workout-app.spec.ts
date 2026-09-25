import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore CommonJS migration module is intentionally executable from Node and Playwright.
import migration from "../packages/workout-nutrition-app/migration/migration.cjs";
import { dismissBlockingOverlays } from "./helpers";

const ROOT = path.resolve(__dirname, "..");
const VAULT = path.join(ROOT, ".e2e-vault");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "sn-183-redacted-workout-log");
const PAGE_PATH = "Health/Strength/workout-log.html";
const FOCUSED_PATH = `/app?path=${encodeURIComponent(PAGE_PATH)}`;
const EVIDENCE = path.join(ROOT, "e2e", "evidence", "SN-183");
const OFFLINE_EVIDENCE = path.join(ROOT, "e2e", "evidence", "SN-267");

let backupDir = "";
let rehearsal: Record<string, unknown>;

async function maintainedSource() {
  const appDir = path.join(ROOT, "packages", "workout-nutrition-app", "app");
  const [template, domain] = await Promise.all([
    fs.readFile(path.join(appDir, "source.html"), "utf8"),
    fs.readFile(path.join(appDir, "domain.js"), "utf8"),
  ]);
  return template.replace("/*__WORKOUT_DOMAIN__*/", domain);
}

test.describe("SN-183 Workout & Nutrition App", () => {
  test.beforeAll(async () => {
    const targetNotebook = path.join(VAULT, "Health");
    await fs.rm(targetNotebook, { recursive: true, force: true });
    await fs.cp(path.join(FIXTURE, "Health"), targetNotebook, { recursive: true });
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn183-e2e-backup-"));
    await fs.rm(backupDir, { recursive: true });
    const appSource = await maintainedSource();
    await migration.createBackup({ vaultRoot: VAULT, pagePath: PAGE_PATH, backupDir });
    const first = await migration.migrate({ vaultRoot: VAULT, pagePath: PAGE_PATH, backupDir, appSource, rehearsal: true, expectedCount: 13 });
    const restored = await migration.restoreBackup({ vaultRoot: VAULT, backupDir });
    const final = await migration.migrate({ vaultRoot: VAULT, pagePath: PAGE_PATH, backupDir, appSource, rehearsal: true, expectedCount: 13 });
    rehearsal = {
      ...final,
      firstMigrationVerified: first.countMatches && first.schemaEqual && first.idsEqual && first.timestampsEqual && first.nestedValuesEqual && first.documentEqual,
      restoreVerified: restored.ok,
    };
    await fs.mkdir(EVIDENCE, { recursive: true });
    await fs.mkdir(OFFLINE_EVIDENCE, { recursive: true });
  });

  test.afterAll(async () => {
    if (backupDir) await fs.rm(backupDir, { recursive: true, force: true });
  });

  test("migration and restore preserve the redacted 13-row document", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Migration/restore browser evidence is desktop-scoped.");
    expect(rehearsal).toEqual(expect.objectContaining({
      beforeCount: 13,
      afterCount: 13,
      countMatches: true,
      schemaEqual: true,
      idsEqual: true,
      timestampsEqual: true,
      nestedValuesEqual: true,
      documentEqual: true,
      firstMigrationVerified: true,
      restoreVerified: true,
      warnings: [],
    }));
    await page.goto(FOCUSED_PATH);
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("app-page-view")).toBeVisible();
    const frame = page.frameLocator('[data-testid="app-page-frame"]');
    await expect(frame.getByRole("heading", { name: "Workout & Nutrition" })).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator("#session-date")).toBeVisible();
    await frame.locator("#workout-select").selectOption("A");
    await frame.getByText("Session options", { exact: true }).click();
    await frame.getByRole("button", { name: "Use last session" }).click();
    const workingWeight = frame.locator('[data-set-field="weight"]').nth(1);
    await workingWeight.fill("");
    await frame.getByRole("button", { name: "Copy previous weight" }).nth(1).click();
    await expect(workingWeight).not.toHaveValue("");
    await dismissBlockingOverlays(page);
    await page.screenshot({ path: path.join(EVIDENCE, "redacted-migration-desktop.png"), fullPage: true });

    await frame.getByRole("tab", { name: "Nutrition" }).click();
    await frame.locator("#nutrition").getByLabel("Date").fill("2026-08-04");
    await frame.getByLabel("Meal").fill("Redacted meal");
    await dismissBlockingOverlays(page);
    await page.screenshot({ path: path.join(EVIDENCE, "redacted-nutrition-desktop.png"), fullPage: true });
    await frame.getByRole("button", { name: "Accept entry" }).click();
    const snapshot = await page.request.get(`/api/page/app/data?path=${encodeURIComponent(PAGE_PATH)}`);
    expect(snapshot.ok()).toBe(true);
    const payload = await snapshot.json() as { tables: Array<{ id: string; rows: unknown[] }> };
    expect(payload.tables.find((table) => table.id === "entries")?.rows).toHaveLength(14);

    await frame.getByRole("tab", { name: "History" }).click();
    await expect(frame.locator("#history")).toContainText("Nutrition");
    await dismissBlockingOverlays(page);
    await page.screenshot({ path: path.join(EVIDENCE, "redacted-history-desktop.png"), fullPage: true });
    await frame.getByRole("tab", { name: "Progress" }).click();
    await expect(frame.getByRole("heading", { name: "Progress" })).toBeVisible();
    await dismissBlockingOverlays(page);
    await page.screenshot({ path: path.join(EVIDENCE, "redacted-progress-desktop.png"), fullPage: true });
  });

  test("mobile workout acceptance survives an interrupted RPC and full reload before sync", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Durable mobile entry evidence is mobile-scoped.");
    await page.addInitScript(() => {
      const browserFetch = window.fetch.bind(window);
      let rejectMutationRpc = true;
      window.addEventListener("message", (event) => {
        if (event.data === "sn183-enable-rpc") rejectMutationRpc = false;
      });
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        const body = typeof init?.body === "string" ? init.body : "";
        const isQuery = body.includes('"operation":"query"');
        if (rejectMutationRpc && url.includes("/api/page/app/rpc") && !isQuery) {
          return Promise.reject(new TypeError("SN-183 simulated RPC interruption"));
        }
        return browserFetch(input, init);
      };
    });
    await page.goto(FOCUSED_PATH);
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("app-page-view")).toBeVisible();
    const frame = page.frameLocator('[data-testid="app-page-frame"]');
    await expect(frame.getByRole("heading", { name: "Workout & Nutrition" })).toBeVisible({ timeout: 20_000 });
    await frame.locator("#session-date").fill("2026-08-04");
    await frame.locator("#workout-select").selectOption("A");
    const numeric = frame.locator("[data-set-field]");
    await expect(numeric.first()).toBeVisible();
    for (let index = 0; index < await numeric.count(); index += 1) {
      const field = await numeric.nth(index).getAttribute("data-set-field");
      await numeric.nth(index).fill(field === "weight" ? "50" : field === "seconds" ? "45" : "8");
    }
    await frame.locator("#workout-notes").fill("Redacted browser fixture");
    await frame.locator("body").evaluate(() => document.scrollingElement?.scrollTo(0, 0));
    await page.getByTestId("app-preview").evaluate((element) => element.scrollTo(0, 0));
    await page.evaluate(() => window.scrollTo(0, 0));
    await dismissBlockingOverlays(page);
    await page.screenshot({ path: path.join(EVIDENCE, "redacted-workout-mobile-grid.png"), fullPage: true });
    await frame.getByRole("button", { name: "Accept workout" }).click();
    await expect(page.getByTestId("app-pending-mutations")).toContainText("2 local App changes");
    await page.reload();
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("app-pending-mutations")).toContainText("2 local App changes");
    await page.evaluate(() => {
      window.postMessage("sn183-enable-rpc", "*");
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId("app-pending-mutations")).toBeHidden({ timeout: 20_000 });
    await page.reload();
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("app-page-view")).toBeVisible();
    const reloaded = page.frameLocator('[data-testid="app-page-frame"]');
    await expect(reloaded.getByRole("heading", { name: "Workout & Nutrition" })).toBeVisible({ timeout: 20_000 });
    await reloaded.getByRole("tab", { name: /History|Log/ }).click();
    await expect(reloaded.locator("#history")).toContainText("2026-08-04");
    const snapshot = await page.request.get(`/api/page/app/data?path=${encodeURIComponent(PAGE_PATH)}`);
    expect(snapshot.ok()).toBe(true);
    const payload = await snapshot.json() as { tables: Array<{ id: string; rows: unknown[] }> };
    expect(payload.tables.find((table) => table.id === "entries")?.rows).toHaveLength(14);
    expect(payload.tables.find((table) => table.id === "drafts")?.rows).toEqual([
      expect.objectContaining({ id: "r_u_workout", values: expect.objectContaining({ kind: "retired" }) }),
    ]);
    await dismissBlockingOverlays(page);
    await page.screenshot({ path: path.join(EVIDENCE, "redacted-workout-mobile-reload.png"), fullPage: true });
  });

  test("Workout opens from its kept device package while offline, then syncs again", async ({ page, context }, testInfo) => {
    await page.goto(FOCUSED_PATH);
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("app-package-status")).toHaveAttribute("data-state", "synced", { timeout: 20_000 });
    await expect(page.frameLocator('[data-testid="app-page-frame"]').getByRole("heading", { name: "Workout & Nutrition" })).toBeVisible();

    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) throw new Error("Service workers are required for the offline App harness.");
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
      }
    });
    // Reload once under service-worker control so the exact focused start URL and
    // its hashed assets are present alongside the host-owned App package.
    await page.reload();
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("app-package-status")).toHaveAttribute("data-state", "synced", { timeout: 20_000 });
    await page.getByTestId("app-keep-offline").click();
    await expect(page.getByTestId("app-keep-offline")).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: path.join(OFFLINE_EVIDENCE, `workout-${testInfo.project.name}-synced.png`),
      fullPage: true,
    });

    try {
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await dismissBlockingOverlays(page);
      await expect(page.getByTestId("app-package-status")).toHaveAttribute("data-state", "local", { timeout: 20_000 });
      await expect(page.getByTestId("app-keep-offline")).toHaveAttribute("aria-pressed", "true");
      const localFrame = page.frameLocator('[data-testid="app-page-frame"]');
      await expect(localFrame.getByRole("heading", { name: "Workout & Nutrition" })).toBeVisible({ timeout: 20_000 });
      await localFrame.getByRole("tab", { name: /History|Log/ }).click();
      await expect(localFrame.locator("#history")).toContainText("Workout");
      await page.screenshot({
        path: path.join(OFFLINE_EVIDENCE, `workout-${testInfo.project.name}-local.png`),
        fullPage: true,
      });
    } finally {
      await context.setOffline(false);
    }

    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByTestId("app-package-status")).toHaveAttribute("data-state", "synced", { timeout: 20_000 });
  });
});
