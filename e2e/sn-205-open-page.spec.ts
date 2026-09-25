import { expect, request as playwrightRequest, test } from "@playwright/test";
import { dismissBlockingOverlays } from "./helpers";

const PORT = Number(process.env.PORT || 3199);
const BASE_URL = `http://localhost:${PORT}`;
const SECTION = "Personal Notebook/Quick Notes";
const TARGET_MARKER = "SN-205 target page reached OK.";

let appPath = "";
let targetPath = "";

async function callVaultTool(
  ctx: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  tool: string,
  args: Record<string, unknown>
) {
  const res = await ctx.post("/api/agent/vault", { data: { tool, args } });
  expect(res.ok(), `${tool} failed: ${res.status()} ${await res.text()}`).toBe(true);
  const json = (await res.json()) as { result?: { data?: { page?: { path?: string } } } };
  return json.result?.data?.page?.path ?? "";
}

test.describe("SN-205 mini-app openPage across notebook and focused surfaces", () => {
  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      targetPath = await callVaultTool(ctx, "page_create", {
        sectionPath: SECTION,
        title: "SN-205 Target",
        content: `<p>${TARGET_MARKER}</p>`,
      });
      appPath = await callVaultTool(ctx, "app_create_from_template", {
        sectionPath: SECTION,
        templateId: "blank-app",
        title: "SN-205 Launcher",
      });
      const source = `<main style="padding:16px;font-family:system-ui">
  <h1>SN-205 Launcher</h1>
  <button id="go" type="button">Open target page</button>
  <p id="status"></p>
  <script>
    document.getElementById('go').addEventListener('click', function () {
      window.smartNotesApp.openPage(${JSON.stringify(targetPath)}).then(
        function () { document.getElementById('status').textContent = 'opened'; },
        function (err) { document.getElementById('status').textContent = 'error:' + err.message; }
      );
    });
  </script>
</main>`;
      await callVaultTool(ctx, "app_update", { path: appPath, source });
    } finally {
      await ctx.dispose();
    }
  });

  test("notebook-hosted app opens the target page, and a focused app exits to it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Owner-critical openPage flow is desktop-scoped.");

    // Notebook surface: the deep-link opens the app page in the main notebook.
    await page.goto(`/?page=${encodeURIComponent(appPath)}`);
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("app-page-view")).toBeVisible({ timeout: 20_000 });
    const frame = page.frameLocator('[data-testid="app-page-frame"]');
    await expect(frame.getByRole("button", { name: "Open target page" })).toBeVisible({ timeout: 20_000 });
    await frame.getByRole("button", { name: "Open target page" }).click();
    // Host navigation lands the notebook on the validated target page.
    await expect(page.getByText(TARGET_MARKER)).toBeVisible({ timeout: 20_000 });

    // Focused surface: openPage leaves focus mode and deep-links into the notebook.
    await page.goto(`/app?path=${encodeURIComponent(appPath)}`);
    await dismissBlockingOverlays(page);
    await expect(page.getByTestId("app-page-view")).toBeVisible({ timeout: 20_000 });
    const focusedFrame = page.frameLocator('[data-testid="app-page-frame"]');
    await expect(focusedFrame.getByRole("button", { name: "Open target page" })).toBeVisible({ timeout: 20_000 });
    await focusedFrame.getByRole("button", { name: "Open target page" }).click();
    await page.waitForURL(/\/\?page=/, { timeout: 20_000 });
    await dismissBlockingOverlays(page);
    await expect(page.getByText(TARGET_MARKER)).toBeVisible({ timeout: 20_000 });
  });
});
