import { expect, test } from "@playwright/test";
import path from "node:path";

const EVIDENCE_DIR = path.resolve(__dirname, "evidence");

async function stubChatModelRoutes(page: import("@playwright/test").Page) {
  await page.route("**/api/chat/providers", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        default: "codex",
        providers: [
          {
            id: "codex",
            name: "Codex CLI",
            models: ["gpt-5.4", "gpt-5.4-mini"],
          },
        ],
      }),
    });
  });

  await page.route("**/api/chat/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ model: "gpt-5.4", verbose: true }),
    });
  });
}

async function resetClientState(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("theme", "dark");
    window.localStorage.setItem(
      "smart-notes-active-page",
      "Personal Notebook/Quick Notes/AssetTarget.md"
    );
  });
}

async function openActiveNote(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForSelector('[data-testid="tree"]', { timeout: 15_000 });
  await expect(page.locator(".ProseMirror").first()).toBeVisible({ timeout: 10_000 });
}

test.describe("SN-35 system prompt settings UI", () => {
  test("desktop settings dialog shows redesigned system prompt section", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop only");

    await stubChatModelRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    await openActiveNote(page);
    await page.getByTestId("ai-toggle-btn").click();
    await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible();

    await page.getByRole("button", { name: "AI settings" }).click();
    const dialog = page.getByTestId("ai-settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Choose the provider and model")).toBeVisible();

    const textarea = dialog.getByTestId("ai-system-prompt");
    await expect(textarea).toBeVisible();
    await expect(textarea).toContainText("Smart Notes companion");
    await expect(dialog.getByTestId("ai-system-prompt-save")).toBeVisible();
    await expect(dialog.getByTestId("ai-system-prompt-reset")).toBeVisible();

    await textarea.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    await dialog.screenshot({
      path: path.join(EVIDENCE_DIR, "sn-35-settings-dialog-desktop.png"),
    });
  });
});
