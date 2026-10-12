import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("Quick Capture starts in content and saves without opening the new page", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.getByTestId("capture-btn").click();

  const content = page.getByTestId("capture-content-input");
  await expect(content).toBeVisible({ timeout: 2000 }).catch(async () => {
    // The shell can paint before its client handler is attached on a cold start.
    await page.getByTestId("capture-btn").click();
    await expect(content).toBeVisible();
  });
  await expect(content).toBeFocused();
  const notebook = page.getByTestId("capture-notebook-select");
  const notebookName = await notebook.locator("option:checked").textContent();
  await expect(page.getByTestId("capture-destination-summary"))
    .toContainText(`${notebookName?.trim()} / Inbox`);
  await expect(page.getByTestId("capture-destination-select")).toBeVisible();

  const evidenceDir = path.join(process.cwd(), "evidence", "sn-290");
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, `${test.info().project.name}-entry.png`) });

  await page.getByTestId("capture-destination-select").selectOption("page");
  const section = page.getByTestId("capture-section-select");
  const selectedSection = await section.locator("option:checked").textContent();
  await expect(page.getByTestId("capture-destination-summary"))
    .toContainText(selectedSection?.trim() ?? "");
  await page.getByTestId("capture-destination-select").selectOption("inbox");

  await content.fill("A text-first capture");
  await page.route("**/api/capture", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ page: { path: "Notebook/Inbox/sn290-mock.html", title: "Quick Capture", body: "" } }),
    });
  });
  await page.getByTestId("capture-submit-btn").click();
  await expect(page.getByTestId("capture-saved")).toContainText("Saved");
  await expect(page.getByTestId("capture-open-btn")).toBeVisible();
  await expect(page.getByTestId("capture-done-btn")).toBeFocused();
  await page.screenshot({ path: path.join(evidenceDir, `${test.info().project.name}-saved.png`) });
  await page.getByTestId("capture-done-btn").click();
  await expect(page.getByTestId("capture-saved")).toBeHidden();
  await page.getByTestId("capture-btn").click();
  await expect(page.getByTestId("capture-content-input")).toHaveValue("");
  expect(pageErrors).toEqual([]);
});
