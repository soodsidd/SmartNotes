import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { dismissBlockingOverlays } from "./helpers";

/**
 * SN-356: Companion "Computer" access checkbox — off by default, toggled
 * mid-session, and carried on the very next /api/chat/send of the same thread.
 */

const EVIDENCE_DIR = path.join(__dirname, "..", "evidence", "SN-356");

async function stubProviders(page: Page) {
  await page.route("**/api/chat/providers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ default: "claude", providers: [{ id: "claude", name: "Claude CLI", models: ["sonnet", "opus"] }] }),
    })
  );
  await page.route("**/api/chat/settings", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: "sonnet" }) })
  );
}

const NOTE_TITLE = "Strength Training Reference Plan";
const NOTE_PATH = "Personal Notebook/Quick Notes/strength-training-reference-plan.html";

async function openNote(page: Page, mobile: boolean) {
  const seeded = await page.request.put("/api/page", {
    data: { path: NOTE_PATH, title: NOTE_TITLE, content: "<p>SN-356 diagnose-on-my-PC demo page.</p>" },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.goto("/");
  await dismissBlockingOverlays(page);
  if (mobile) {
    // Mobile hides the tree; the page pinned in localStorage opens directly.
    await expect(page.locator(".ProseMirror").filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    return;
  }
  const selected = page.locator('[data-testid^="page-"][data-selected="true"]').filter({ visible: true }).filter({ hasText: NOTE_TITLE });
  if (!(await selected.first().isVisible().catch(() => false))) {
    await page.locator('[data-testid="tree"]').filter({ visible: true }).getByText(NOTE_TITLE, { exact: true }).first().click();
  }
  await expect(selected.first()).toBeVisible({ timeout: 15_000 });
}

async function openCompanion(page: Page, mobile: boolean) {
  await openNote(page, mobile);
  await dismissBlockingOverlays(page);
  await page.getByTestId("ai-toggle-btn").click();
}

async function injectReply(page: Page, turnId: string, text: string) {
  await page.evaluate(
    ({ turnId: id, text: content }) => {
      const bridge = (window as unknown as { __testChatBridge?: { injectChatEvent: (e: unknown) => void } }).__testChatBridge;
      if (!bridge) throw new Error("__testChatBridge not available");
      bridge.injectChatEvent({ turn_id: id, type: "token", payload: { text: content } });
    },
    { turnId, text }
  );
  await page.waitForTimeout(80);
  await page.evaluate((id) => {
    const bridge = (window as unknown as { __testChatBridge?: { injectChatEvent: (e: unknown) => void } }).__testChatBridge;
    bridge?.injectChatEvent({ turn_id: id, type: "done", payload: { model: "sonnet" } });
  }, turnId);
}

test("SN-356: Computer access checkbox arms and disarms mid-session", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  if (!mobile) await page.setViewportSize({ width: 1440, height: 900 });
  await stubProviders(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem("theme", "light");
    window.localStorage.setItem("smart-notes-active-page", "Personal Notebook/Quick Notes/strength-training-reference-plan.html");
  });

  const sentBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/chat/send", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
    sentBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ turn_id: body.turn_id ?? `sn356-${sentBodies.length}` }),
    });
  });

  await openCompanion(page, mobile);

  const surface = page.getByTestId(mobile ? "mobile-ai-sheet" : "ai-sidebar");
  await expect(surface).toBeVisible();
  const toggle = page.getByTestId(mobile ? "companion-computer-toggle-mobile" : "companion-computer-toggle");
  const label = page.getByTestId(mobile ? "companion-computer-toggle-mobile-label" : "companion-computer-toggle-label");

  // Off by default.
  await expect(toggle).not.toBeChecked();
  await expect(label).toHaveAttribute("data-armed", "false");
  await surface.screenshot({ path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-01-off-default.png`) });

  const send = async (text: string) => {
    const before = sentBodies.length;
    await page.getByTestId("ai-input").filter({ visible: true }).first().fill(text);
    await page.getByTestId("ai-send-btn").filter({ visible: true }).first().click();
    await expect.poll(() => sentBodies.length, { timeout: 45_000 }).toBe(before + 1);
    return sentBodies[before];
  };

  const turnOff = await send("What is using my CPU right now?");
  expect(turnOff.computer_access).toBeUndefined();
  await injectReply(page, String(turnOff.turn_id), "Computer access is off for this chat — tick **Computer** in the Companion header and ask again so I can check this PC directly.");

  // Arm mid-session: no restart, same thread.
  await toggle.check();
  await expect(label).toHaveAttribute("data-armed", "true");
  const turnOn = await send("OK, check it now.");
  expect(turnOn.computer_access).toBe(true);
  expect(turnOn.thread_key).toBe(turnOff.thread_key);
  await injectReply(page, String(turnOn.turn_id), "Ran `Get-Process | Sort CPU -Desc | Select -First 5` on this PC and captured the desktop.");
  await surface.screenshot({ path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-02-armed.png`) });

  // Disarm mid-session: the next turn no longer carries the grant.
  await toggle.uncheck();
  await expect(label).toHaveAttribute("data-armed", "false");
  const turnOffAgain = await send("And check the disk too.");
  expect(turnOffAgain.computer_access).toBeUndefined();
  expect(turnOffAgain.thread_key).toBe(turnOff.thread_key);
  await injectReply(page, String(turnOffAgain.turn_id), "Computer access is off again, so I can't run commands on this PC. Tick **Computer** to re-enable.");
  await surface.screenshot({ path: path.join(EVIDENCE_DIR, `${testInfo.project.name}-03-disarmed.png`) });

  // Never persisted: a reload starts disarmed.
  await openCompanion(page, mobile);
  await expect(page.getByTestId(mobile ? "companion-computer-toggle-mobile" : "companion-computer-toggle")).not.toBeChecked();
});
