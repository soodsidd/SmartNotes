import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { dismissBlockingOverlays } from "./helpers";

const evidenceDir = path.resolve(__dirname, "evidence", "SN-374");
test.use({ serviceWorkers: "block" });

test("SN-374: quick prompt and settings are visible, saved, and sent in one click", async ({ page }) => {
  test.setTimeout(180_000);
  const sent: string[] = [];
  await page.route("**/api/chat/send", async (route) => {
    sent.push(route.request().postData() ?? "");
    const { turn_id: turnId } = JSON.parse(sent[sent.length - 1]) as { turn_id: string };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ turn_id: turnId }) });
    await page.waitForTimeout(250);
    await page.evaluate((id) => {
      const bridge = (window as typeof window & { __testChatBridge?: { injectChatEvent: (event: unknown) => void } }).__testChatBridge;
      bridge?.injectChatEvent({ turn_id: id, seq: 0, type: "done", payload: { status: "completed" } });
    }, turnId);
  });

  // Vault UI-state hydration resets Keep and the transcript; never send before it lands.
  const hydrated = page.waitForResponse(response => response.url().includes("/api/ui-state") && response.request().method() === "GET");
  await page.goto("/");
  await hydrated;
  await dismissBlockingOverlays(page);
  await page.getByTestId("ai-toggle-btn").click();
  const sidebar = page.getByTestId("ai-sidebar-rail");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Add short note" })).toBeVisible();
  fs.mkdirSync(evidenceDir, { recursive: true });
  await sidebar.getByTestId("ai-composer").screenshot({ path: path.join(evidenceDir, "composer-chip.png") });

  await sidebar.getByRole("button", { name: "AI settings" }).click();
  const settings = page.getByTestId("quick-prompt-settings");
  await expect(settings).toBeVisible();
  await settings.screenshot({ path: path.join(evidenceDir, "settings-editor.png") });
  await settings.getByLabel("Chip label").fill("Capture insight");
  await settings.getByLabel("Prompt text").fill("Add this insight to the note.");
  await page.keyboard.press("Escape");
  // Vault UI-state hydration resets Keep and the transcript; never send before it lands.
  const hydratedReload = page.waitForResponse(response => response.url().includes("/api/ui-state") && response.request().method() === "GET");
  await page.reload();
  await hydratedReload;
  await dismissBlockingOverlays(page);
  await page.getByTestId("ai-toggle-btn").click();
  await page.getByRole("button", { name: "Capture insight" }).click();
  await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(1);
  expect(JSON.parse(sent[0]).message).toContain("Add this insight to the note.");
});
