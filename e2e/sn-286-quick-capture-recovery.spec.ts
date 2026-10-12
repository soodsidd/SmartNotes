import { expect, test } from "@playwright/test";

test("Quick Capture retains drafts, retries a failed save, and discards explicitly", async ({ page }) => {
  const title = `SN286 capture ${Date.now()}`;
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.getByTestId("capture-btn").click();
  await page.getByTestId("capture-title-input").fill(title);
  await page.getByTestId("capture-content-input").fill("Keep this unfinished capture");
  await page.getByTestId("capture-cancel-btn").click();

  await page.getByTestId("capture-btn").click();
  await expect(page.getByTestId("capture-title-input")).toHaveValue(title);
  await expect(page.getByTestId("capture-content-input")).toHaveValue("Keep this unfinished capture");
  await page.reload();
  await page.getByTestId("capture-btn").click();
  await expect(page.getByTestId("capture-title-input")).toHaveValue(title);
  await expect(page.getByTestId("capture-content-input")).toHaveValue("Keep this unfinished capture");

  let requestCount = 0;
  const captureIds: string[] = [];
  await page.route("**/api/capture", async (route) => {
    captureIds.push(route.request().postDataJSON().captureId);
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary vault outage" }) });
    } else {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ page: { path: "Notebook/Inbox/sn286-mock.html", title, body: "" } }),
      });
    }
  });
  await page.getByTestId("capture-submit-btn").click();
  await expect(page.getByTestId("capture-error")).toContainText("Temporary vault outage");
  await expect(page.getByTestId("capture-content-input")).toHaveValue("Keep this unfinished capture");
  await page.getByTestId("capture-submit-btn").click();
  await expect(page.getByTestId("capture-error")).toBeHidden();
  await expect(page.getByTestId("capture-title-input")).toBeHidden();
  expect(captureIds).toHaveLength(2);
  expect(captureIds[1]).toBe(captureIds[0]);

  await page.getByTestId("capture-btn").click();
  await expect(page.getByTestId("capture-content-input")).toHaveValue("");
  await page.getByTestId("capture-content-input").fill("Discard this instead");
  await page.getByTestId("capture-discard-btn").click();
  await page.getByTestId("capture-btn").click();
  await expect(page.getByTestId("capture-content-input")).toHaveValue("");
});
