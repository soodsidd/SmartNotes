import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { dismissBlockingOverlays } from "./helpers";

function evidencePath(projectName: string) {
  return path.resolve(__dirname, "evidence", `sn-235-ingest-destinations-settings-${projectName}.png`);
}

test.describe.configure({ mode: "serial" });

async function openIngestSettingsTab(page: Page) {
  await page.goto("/");
  await dismissBlockingOverlays(page);
  await page.getByTestId("app-settings-trigger").click();
  await expect(page.getByTestId("app-settings-dialog")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("settings-tab-ingest").click();
  await expect(page.getByTestId("ingest-destinations-settings-panel")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("ingest-destinations-loading")).toHaveCount(0);
}

function rows(page: Page) {
  return page.locator('[data-testid^="ingest-destination-row-"]');
}

test.describe("SN-235 ingest destinations settings (notebook picker, no env editing)", () => {
  test("add, edit, remove, reorder, and client-side validation reject an invalid entry", async ({ page }, testInfo) => {
    await openIngestSettingsTab(page);

    // Start from a clean slate: remove any pre-existing rows from a prior run.
    while ((await rows(page).count()) > 0) {
      await rows(page).first().getByRole("button", { name: "Remove destination" }).click();
    }
    await page.getByTestId("ingest-destination-add").click();
    await expect(rows(page)).toHaveCount(1);

    // Add: fill id/label, pick the notebook from the picker (never free-typed).
    const firstRow = rows(page).first();
    await firstRow.getByLabel("Id").fill("reading");
    await firstRow.getByLabel("Label").fill("Reading Queue");
    await firstRow.getByLabel("Notebook").selectOption({ label: "Personal Notebook" });
    await firstRow.getByLabel("Default").check();

    await page.getByTestId("ingest-destinations-save").click();
    await expect(page.getByTestId("ingest-destinations-status-message")).toHaveText(
      "Ingest destinations saved.",
      { timeout: 10000 }
    );
    await expect(page.getByTestId("ingest-destinations-error")).toHaveCount(0);

    await page.screenshot({ path: evidencePath(testInfo.project.name), fullPage: false });

    // Add a second destination, then reorder it above the first.
    await page.getByTestId("ingest-destination-add").click();
    await expect(rows(page)).toHaveCount(2);
    const secondRow = rows(page).nth(1);
    await secondRow.getByLabel("Id").fill("research");
    await secondRow.getByLabel("Label").fill("Research Library");
    await secondRow.getByLabel("Notebook").selectOption({ label: "Rich Vault Notebook" });
    await secondRow.getByRole("button", { name: "Move up" }).click();
    await expect(rows(page).first().getByLabel("Id")).toHaveValue("research");

    await page.getByTestId("ingest-destinations-save").click();
    await expect(page.getByTestId("ingest-destinations-status-message")).toHaveText(
      "Ingest destinations saved.",
      { timeout: 10000 }
    );

    // Edit: rename the "reading" destination (now second row after reorder).
    const readingRow = rows(page).nth(1);
    await readingRow.getByLabel("Label").fill("Reading Queue Renamed");
    await page.getByTestId("ingest-destinations-save").click();
    await expect(page.getByTestId("ingest-destinations-status-message")).toHaveText(
      "Ingest destinations saved.",
      { timeout: 10000 }
    );

    // Invalid entry: clear a required field and confirm client-side rejection
    // (error shown, no silent save, saved rows untouched).
    await readingRow.getByLabel("Label").fill("");
    await page.getByTestId("ingest-destinations-save").click();
    await expect(page.getByTestId("ingest-destinations-error")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("ingest-destinations-error")).toContainText("missing a label");

    // Restore the label and remove the "research" destination.
    await readingRow.getByLabel("Label").fill("Reading Queue Renamed");
    await rows(page).first().getByRole("button", { name: "Remove destination" }).click();
    await expect(rows(page)).toHaveCount(1);
    await page.getByTestId("ingest-destinations-save").click();
    await expect(page.getByTestId("ingest-destinations-status-message")).toHaveText(
      "Ingest destinations saved.",
      { timeout: 10000 }
    );
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByLabel("Id")).toHaveValue("reading");
  });
});
