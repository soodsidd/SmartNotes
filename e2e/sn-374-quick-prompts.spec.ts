import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { dismissBlockingOverlays } from "./helpers";

const evidenceDir = path.resolve(__dirname, "evidence", "SN-374");
test.use({ serviceWorkers: "block" });

test("SN-374: toolbar dropdown and settings are visible, saved, and sent on selection", async ({ page }) => {
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
  const dropdown = sidebar.getByRole("button", { name: "Quick prompts" });
  await expect(dropdown).toBeVisible();
  await expect(dropdown).toContainText("Add short note");
  const inputBox = await sidebar.getByTestId("ai-input").boundingBox();
  const dropdownBox = await dropdown.boundingBox();
  const sendBox = await sidebar.getByTestId("ai-send-btn").boundingBox();
  expect(inputBox && dropdownBox && sendBox).toBeTruthy();
  expect(dropdownBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);
  expect(dropdownBox!.x).toBeLessThan(sendBox!.x);
  fs.mkdirSync(evidenceDir, { recursive: true });
  await sidebar.getByTestId("ai-composer").screenshot({ path: path.join(evidenceDir, "composer-dropdown.png") });
  await dropdown.click();
  await page.getByRole("menuitem", { name: "Add short note" }).click();
  await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(1);
  expect(JSON.parse(sent[0]).message).toContain("Add a short note about this to the current note.");

  await sidebar.getByRole("button", { name: "AI settings" }).click();
  const settings = page.getByTestId("quick-prompt-settings");
  await expect(settings).toBeVisible();
  await settings.screenshot({ path: path.join(evidenceDir, "settings-editor.png") });
  await settings.getByLabel("Dropdown label").fill("Capture insight");
  await settings.getByLabel("Prompt text").fill("Add this insight to the note.");
  await page.keyboard.press("Escape");
  // Vault UI-state hydration resets Keep and the transcript; never send before it lands.
  const hydratedReload = page.waitForResponse(response => response.url().includes("/api/ui-state") && response.request().method() === "GET");
  await page.reload();
  await hydratedReload;
  await dismissBlockingOverlays(page);
  await page.getByTestId("ai-toggle-btn").click();
  const savedDropdown = page.getByRole("button", { name: "Quick prompts" });
  await expect(savedDropdown).toContainText("Capture insight");
  await savedDropdown.click();
  await page.getByRole("menuitem", { name: "Capture insight" }).click();
  await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(2);
  expect(JSON.parse(sent[1]).message).toContain("Add this insight to the note.");
  await page.unrouteAll({ behavior: "wait" });
});
