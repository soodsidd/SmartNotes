import { test, expect, type Page } from "@playwright/test";
import { clickShellMoreItem, dismissBlockingOverlays } from "./helpers";

const running = {
  status: "running",
  address: "http://localhost:3002",
  reachable: true,
  pid: 34304,
  uptimeSeconds: 3170,
  build: "DhATPDCX0G7dBb4zsyPLY",
  log: "> Ready on http://localhost:3002\n",
  supervised: true,
};

async function openServerTab(page: Page) {
  await page.goto("/");
  await dismissBlockingOverlays(page);
  await clickShellMoreItem(page, "app-settings-trigger");
  const dialog = page.getByTestId("app-settings-dialog");
  await dialog.getByTestId("settings-tab-server").click();
  return dialog;
}

test("Settings Server tab shows status, offline copy, and a collapsible log", async ({ page }) => {
  await page.route("**/api/server/status", (route) => route.fulfill({ json: { ...running, supervised: false, log: "" } }));
  const dialog = await openServerTab(page);
  await expect(dialog).toContainText("Status and start/stop controls for the local Smart Notes server.");
  await expect(dialog.getByTestId("server-status-pill")).toHaveText("Running");
  await expect(dialog).toContainText("52m 50s");
  await expect(dialog).toContainText("All edits are synced to the vault on disk.");
  await expect(dialog.getByTestId("server-notice")).toContainText("supervisor");
  await expect(dialog.getByTestId("server-log")).toHaveCount(0);
  await dialog.getByTestId("server-log-toggle").click();
  await expect(dialog.getByTestId("server-log")).toBeVisible();
  const tabs = await dialog.locator('[data-testid^="settings-tab-"]').allInnerTexts();
  expect(tabs.map((label) => label.trim())).toEqual(["General", "Notebooks", "Backups", "Ingest", "Server"]);
});

test("Settings Server tab drives the supervisor through stop, start, and restart", async ({ page, baseURL }) => {
  const appPort = Number(new URL(baseURL!).port);
  let state: Record<string, unknown> = { ...running };
  const posts: string[] = [];
  await page.route(`http://localhost:${appPort + 8}/**`, async (route) => {
    const action = new URL(route.request().url()).pathname.slice(1);
    const headers = { "Access-Control-Allow-Origin": `http://localhost:${appPort}` };
    if (route.request().method() === "POST") {
      posts.push(action);
      if (action === "stop") state = { ...state, status: "stopped", reachable: false, pid: null, uptimeSeconds: null };
      else state = { ...state, status: "running", reachable: true, pid: (state.pid as number | null ?? 40000) + 1, uptimeSeconds: 0 };
    }
    await route.fulfill({ json: state, headers });
  });
  const dialog = await openServerTab(page);
  await expect(dialog.getByTestId("server-stop")).toBeEnabled();
  await expect(dialog.getByTestId("server-start")).toBeDisabled();

  await dialog.getByTestId("server-stop").click();
  await expect(dialog.getByTestId("server-status-pill")).toHaveText("Stopped");
  await expect(dialog.getByTestId("server-start")).toBeEnabled();

  await dialog.getByTestId("server-start").click();
  await expect(dialog.getByTestId("server-status-pill")).toHaveText("Running");
  await expect(dialog).toContainText("40001");

  await dialog.getByTestId("server-restart").click();
  await expect(dialog).toContainText("40002");
  expect(posts).toEqual(["stop", "start", "restart"]);
});
