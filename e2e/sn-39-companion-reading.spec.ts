import * as fs from "fs";
import * as path from "path";
import { expect, test } from "@playwright/test";

const EVIDENCE_DIR = path.join(__dirname, "evidence");

async function settleVisuals(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(250);
}

async function stubChatModelRoutes(page: import("@playwright/test").Page) {
  await page.route("**/api/chat/providers", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        default: "ai",
        providers: [{ id: "ai", name: "AI", models: ["auto"] }],
      }),
    });
  });

  await page.route("**/api/chat/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ model: "auto" }),
    });
  });
}

async function resetClientState(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.cookie.split(";").forEach((cookie) => {
      const separatorIndex = cookie.indexOf("=");
      const name = separatorIndex >= 0 ? cookie.slice(0, separatorIndex).trim() : cookie.trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
    });
    window.localStorage.setItem("theme", "light");
    window.localStorage.setItem(
      "smart-notes-active-page",
      "Personal Notebook/Quick Notes/AssetTarget.md"
    );
  });
}

async function openActiveNote(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15_000 });
}

test.describe("SN-39 companion reading evidence", () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test("desktop wide sidebar with long research reply", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop evidence only.");
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto("/_dev/screens?surface=desktop");
    await settleVisuals(page);

    await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible();
    await expect(page.getByText("Push")).toBeVisible();
    await expect(page.locator(".chat-prose pre code")).toContainText("summarizeMinimumSets");

    await page.getByTestId("ai-sidebar-rail").screenshot({
      path: path.join(EVIDENCE_DIR, "sn-39-desktop-wide-sidebar.png"),
      animations: "disabled",
    });
  });

  test("mobile fullscreen companion in live app", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile evidence only.");
    await stubChatModelRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 430, height: 932 });
    await openActiveNote(page);
    await page.getByTestId("ai-toggle-btn").click();
    await settleVisuals(page);

    const sheet = page.getByTestId("mobile-ai-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("format-bar-mobile")).not.toBeVisible();
    await expect(page.getByTestId("app-shell").locator("> div").first()).toBeHidden();

    const viewport = page.viewportSize();
    const sheetSurface = page.locator('[data-slot="sheet-content"][data-side="bottom"]');
    const sheetBox = await sheetSurface.boundingBox();
    expect(sheetBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
    expect(sheetBox?.height ?? 0).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 2);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "sn-39-mobile-fullscreen-companion.png"),
      animations: "disabled",
    });
  });

  test("density preset comparison", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop density evidence only.");
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto("/_dev/screens?surface=desktop");
    await settleVisuals(page);

    for (const preset of ["compact", "normal", "comfortable"] as const) {
      await page.evaluate((value) => {
        window.localStorage.setItem("smart-notes-companion-density", value);
      }, preset);
      await page.reload();
      await settleVisuals(page);

      await page.getByTestId("ai-sidebar").screenshot({
        path: path.join(EVIDENCE_DIR, `sn-39-density-${preset}.png`),
        animations: "disabled",
      });
    }
  });
});
