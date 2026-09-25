import { expect, test } from "@playwright/test";
import { dismissBlockingOverlays } from "./helpers";

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

async function stubCodexProviderRoutes(page: import("@playwright/test").Page) {
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
            models: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "codex-mini-latest", "o3"],
          },
          { id: "claude", name: "Claude CLI", models: ["sonnet", "opus"] },
        ],
      }),
    });
  });

  await page.route("**/api/chat/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ model: "gpt-5.4" }),
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
      "Personal Notebook/Quick Notes/strength-training-reference-plan.html"
    );
  });
}

async function openWelcomeNote(page: import("@playwright/test").Page) {
  await page.goto("/");
  await dismissBlockingOverlays(page);
  const openSidebarButton = page.getByTestId("open-sidebar-btn");
  if (await openSidebarButton.isVisible().catch(() => false)) {
    await openSidebarButton.click();
  }
  const welcome = page
    .locator('[data-testid="tree"]')
    .filter({ visible: true })
    .getByText("Welcome to Smart Notes", { exact: true })
    .first();
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.click();
  }
  await expect(
    page.locator('[data-testid^="page-"][data-selected="true"]').filter({ visible: true }).first()
  ).toContainText("Welcome to Smart Notes", { timeout: 15000 });
}

const STRENGTH_TITLE = "Strength Training Reference Plan";
const STRENGTH_PATH = "Personal Notebook/Quick Notes/strength-training-reference-plan.html";

async function seedStrengthTrainingNote(page: import("@playwright/test").Page) {
  const response = await page.request.put("/api/page", {
    data: {
      path: STRENGTH_PATH,
      title: STRENGTH_TITLE,
      content:
        "<p>30-35 min lunch workouts, Mon/Wed/Fri.</p><p>Workouts A/B/C baseline for SN-11.</p>",
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function openStrengthTrainingNote(page: import("@playwright/test").Page) {
  await seedStrengthTrainingNote(page);
  await page.goto("/");
  await dismissBlockingOverlays(page);
  await page.waitForSelector('[data-testid="tree"]', { timeout: 15_000 });
  const treeRow = page.getByTestId("tree").getByText(STRENGTH_TITLE, { exact: true }).first();
  if (!(await page.locator('[data-testid^="page-"][data-selected="true"]').filter({ hasText: STRENGTH_TITLE }).isVisible().catch(() => false))) {
    await treeRow.click();
  }
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid^="page-"][data-selected="true"]')).toContainText(STRENGTH_TITLE, {
    timeout: 10_000,
  });
}

async function disableFocusRings(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: `
      *:focus,
      *:focus-visible {
        outline: none !important;
        box-shadow: none !important;
      }

      *, *::before, *::after {
        caret-color: transparent !important;
      }
    `,
  });
}

async function settleVisuals(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    if ("fonts" in document) {
      await document.fonts.ready;
    }
  });
  await page.waitForTimeout(150);
}

async function captureClippedScreenshot(
  page: import("@playwright/test").Page,
  testId: string,
  clip: { width: number; height: number; insetX?: number; insetY?: number }
) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) {
    throw new Error(`Could not resolve bounding box for ${testId}.`);
  }

  return page.screenshot({
    animations: "disabled",
    clip: {
      x: Math.round(box.x + (clip.insetX ?? 0)),
      y: Math.round(box.y + (clip.insetY ?? 0)),
      width: clip.width,
      height: clip.height,
    },
  });
}

/**
 * Inject a mock streaming sequence via the dev test bridge.
 * Injects tokens with a small gap so React can flush state between events.
 */
async function injectChatEvent(
  page: import("@playwright/test").Page,
  event: { turn_id: string; type: string; payload?: Record<string, unknown> }
) {
  await page.evaluate((nextEvent) => {
    const bridge = (window as unknown as { __testChatBridge?: { injectChatEvent: (e: unknown) => void } }).__testChatBridge;
    if (!bridge) throw new Error("__testChatBridge not available — is NODE_ENV=production?");
    bridge.injectChatEvent(nextEvent);
  }, event);
}

async function injectMockStream(
  page: import("@playwright/test").Page,
  turnId: string,
  content: string,
  modelLabel = "gpt-5.4"
) {
  // Inject content as a single token
  await injectChatEvent(page, { turn_id: turnId, type: "token", payload: { text: content } });

  // Allow React to flush the token state update before firing `done`.
  await page.waitForTimeout(80);

  await injectChatEvent(page, { turn_id: turnId, type: "done", payload: { model: modelLabel } });
}

async function clickReloadButton(page: import("@playwright/test").Page) {
  await dismissBlockingOverlays(page);
  // Prefer a DOM click — the AI resize handle often intercepts Playwright pointer clicks.
  await page.getByTestId("reload-btn").evaluate((el) => (el as HTMLButtonElement).click());
}

// ─── Functional flow tests ────────────────────────────────────────────────────

test.describe("SN-11 AI sidebar — direct record edit flow (desktop)", () => {
  test("agent saves backing markdown record; user reloads to view the change", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop only");

    await stubCodexProviderRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const turnId = "test-append-001";
    const pagePath = "Personal Notebook/Quick Notes/strength-training-reference-plan.html";
    const reloadedContent =
      "<p>AGENT-SAVED-MINIMUM-WORKOUT-TABLE</p>" +
      "<p>A (Mon): Squat 3x5-8, Bench 3x6-10</p>" +
      "<p>B (Wed): Deadlift 2x3-5, OHP 3x5-8</p>" +
      "<p>C (Fri): Squat var 3x6-10, DB Press 3x8-12</p>";
    let capturedAppContext = "";
    let remoteRecordChanged = false;

    await page.route("**/api/chat/send", async (route) => {
      const body = (await route.request().postDataJSON()) as { app_context?: string; page_context?: string };
      capturedAppContext = body.app_context ?? "";
      expect(capturedAppContext).toContain("Smart Notes operating context:");
      expect(capturedAppContext).toContain("Active note title: Strength Training Reference Plan");
      expect(capturedAppContext).toContain(`vaultRelativePath (canonical API path): ${pagePath}`);
      expect(capturedAppContext).toContain("Vault root absolute path:");
      expect(capturedAppContext).toContain("Do not assume the vault is inside the repository");
      expect(capturedAppContext).toContain("resolvedDiskPath (absolute, OS-normalized):");
      expect(capturedAppContext).toContain("edit the active HTML page record directly");
      expect(capturedAppContext).toContain("Remote update available");
      expect(capturedAppContext).toContain("Context scope sent this turn: Whole note");
      expect(body.page_context).toContain("lunch workouts");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ turn_id: turnId }),
      });
    });
    await page.route("**/api/page**", async (route, request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.searchParams.get("path") === pagePath && remoteRecordChanged) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            page: {
              id: pagePath,
              path: pagePath,
              slug: "strength-training-reference-plan",
              title: "Strength Training Reference Plan",
              preview: "Agent saved a minimum workout table.",
              content: reloadedContent,
              body: reloadedContent,
              metadata: {},
              createdAt: null,
              updatedAt: "2026-06-01T16:45:00.000Z",
              notebookPath: "Personal Notebook",
              notebookName: "Personal Notebook",
              sectionPath: "Personal Notebook/Quick Notes",
              sectionName: "Quick Notes",
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await openStrengthTrainingNote(page);

    // Open AI sidebar
    await page.getByTestId("ai-toggle-btn").click();
    await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible();

    await expect(page.getByTestId("ai-guard-trigger")).toHaveCount(0);
    await expect(page.locator('[aria-label="Open response actions"]')).toHaveCount(0);

    // Type a message about the minimum workout versions
    const aiInput = page.getByTestId("ai-input");
    await aiInput.fill(
      "Create a compact summary table of the minimum versions of all three workouts (A, B, C) and save it to this note"
    );

    // Send and wait for the request to complete
    const sendPromise = page.waitForResponse("**/api/chat/send");
    await page.getByTestId("ai-send-btn").click();
    await sendPromise;
    expect(capturedAppContext).toContain("GET /api/page?path=Personal%20Notebook%2FQuick%20Notes%2Fstrength-training-reference-plan.html");
    expect(capturedAppContext).toContain(`PUT /api/page with path "${pagePath}" and content`);
    await expect(page.getByTestId("ai-guard-trigger")).toHaveCount(0);

    // Wait for the streaming placeholder to appear
    await expect(page.locator(".ProseMirror").first()).toBeVisible();
    await page.waitForTimeout(100);

    const initialText = await page.locator(".ProseMirror").textContent();
    expect(initialText).not.toContain("AGENT-SAVED-MINIMUM-WORKOUT-TABLE");

    remoteRecordChanged = true;
    await injectMockStream(page, turnId, "I saved the compact table to the backing Markdown record. Reload the note to view it.");

    await expect(page.getByTestId("save-status")).toContainText("Remote update available", { timeout: 5_000 });
    await expect(page.getByTestId("pending-page-reload-indicator")).toBeVisible();
    await expect(page.locator(".ProseMirror")).not.toContainText("AGENT-SAVED-MINIMUM-WORKOUT-TABLE");
    await expect(page.locator('[aria-label="Open response actions"]')).toHaveCount(0);

    await clickReloadButton(page);

    await expect(page.locator(".ProseMirror")).toContainText("AGENT-SAVED-MINIMUM-WORKOUT-TABLE");
    await expect(page.locator(".ProseMirror")).toContainText("A (Mon)");
    await expect(page.getByTestId("pending-page-reload-indicator")).toHaveCount(0);
  });
});

test.describe("SN-11 AI sidebar — plain chat flow (desktop)", () => {
  test("edit-style request stays normal chat without selector or auto-commit", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop only");

    await stubCodexProviderRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const turnIds = ["test-edit-001", "test-chat-002"];
    const compressedContent =
      "# Strength Training Reference Plan\n\n" +
      "30-35 min lunch workouts, Mon/Wed/Fri.\n\n" +
      "## Workouts\n\n" +
      "- **A (Mon):** Squat 3×5-8 · Bench 3×6-10 · DB Row 3×8-12\n" +
      "- **B (Wed):** Deadlift 2×3-5 · OHP 3×5-8 · Reverse Lunge 3×8-10\n" +
      "- **C (Fri):** Squat var 3×6-10 · DB Press 3×8-12 · Row 3×8-12\n\n" +
      "## Rules\n\n" +
      "- 2 min rest heavy sets · 90 sec press · 45-60 sec paired sets\n" +
      "- Add weight when all sets hit top of rep range\n" +
      "- Stop at 35 min no matter what";

    await page.route("**/api/chat/send", async (route) => {
      const nextTurnId = turnIds.shift() ?? "test-extra-turn";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ turn_id: nextTurnId }),
      });
    });

    await openStrengthTrainingNote(page);

    // Open AI sidebar
    await page.getByTestId("ai-toggle-btn").click();
    await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible();

    await expect(page.getByTestId("ai-guard-trigger")).toHaveCount(0);
    const initialEditorText = await page.locator(".ProseMirror").textContent();

    // Type a compression request
    const aiInput = page.getByTestId("ai-input");
    await aiInput.fill(
      "Compress this entire page — remove all verbosity and repetition, keep only essential information"
    );

    // Send and wait for the request to complete
    const sendPromise = page.waitForResponse("**/api/chat/send");
    await page.getByTestId("ai-send-btn").click();
    await sendPromise;
    await expect(page.getByTestId("ai-guard-trigger")).toHaveCount(0);

    await page.waitForTimeout(100);

    await injectChatEvent(page, {
      turn_id: "test-edit-001",
      type: "thinking",
      payload: { text: "Comparing repeated sections before compressing the note." },
    });
    await injectChatEvent(page, {
      turn_id: "test-edit-001",
      type: "tool_call",
      payload: { name: "shell", detail: "rg \"Strength Training\" strength-training-reference-plan.html" },
    });

    // Inject mock streaming response (compressed version)
    await injectMockStream(page, "test-edit-001", compressedContent);

    // The chat should show verbose activity and the normal assistant response.
    await expect(page.getByText("Reasoning").first()).toBeVisible();
    await page.getByText("Reasoning").first().click();
    await expect(page.getByText("CLI activity").first()).toBeVisible();
    await page.getByText("CLI activity").first().click();
    await expect(page.getByText("Comparing repeated sections before compressing the note.")).toBeVisible();
    await expect(page.locator("pre").filter({ hasText: 'rg "Strength Training" strength-training-reference-plan.html' }).first()).toBeVisible();
    await expect(page.getByTestId("ai-sidebar-rail")).toContainText("Workouts");
    await expect(page.getByText("Note updated")).toHaveCount(0);

    // The editor should not be mutated automatically.
    const editorText = await page.locator(".ProseMirror").textContent();
    expect(editorText).toBe(initialEditorText);

    // Follow-up messages stay plain chat because there is no composer mode to inherit.
    await aiInput.fill("are you still there?");
    const secondSendPromise = page.waitForResponse("**/api/chat/send");
    await page.getByTestId("ai-send-btn").click();
    await secondSendPromise;
    await expect(page.getByTestId("ai-guard-trigger")).toHaveCount(0);

    await injectMockStream(page, "test-chat-002", "Yes - ready for the next change.");
    await expect(page.getByTestId("ai-sidebar-rail")).toContainText("Yes - ready for the next change.");
    await expect(page.getByText("Note updated")).toHaveCount(0);
  });

  test("shows a pending reload when AI changes the backing page record", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop only");

    await stubCodexProviderRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const pagePath = "Personal Notebook/Quick Notes/strength-training-reference-plan.html";
    const reloadedContent =
      "<p>RELOADED-E2E-MARKER</p><p>The AI has already saved this compact record to disk.</p>";
    let remoteRecordChanged = false;

    await page.route("**/api/page**", async (route, request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.searchParams.get("path") === pagePath && remoteRecordChanged) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            page: {
              id: pagePath,
              path: pagePath,
              slug: "strength-training-reference-plan",
              title: "Strength Training Reference Plan",
              preview: "The AI has already saved this compact record to disk.",
              content: reloadedContent,
              body: reloadedContent,
              metadata: {},
              createdAt: null,
              updatedAt: "2026-06-01T16:30:00.000Z",
              notebookPath: "Personal Notebook",
              notebookName: "Personal Notebook",
              sectionPath: "Personal Notebook/Quick Notes",
              sectionName: "Quick Notes",
            },
          }),
        });
        return;
      }

      await route.continue();
    });

    await page.route("**/api/chat/send", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ turn_id: "test-reload-001" }),
      });
    });

    await openStrengthTrainingNote(page);
    await page.getByTestId("ai-toggle-btn").click();
    await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible();

    const initialEditorText = await page.locator(".ProseMirror").textContent();
    expect(initialEditorText).not.toContain("RELOADED-E2E-MARKER");

    await page.getByTestId("ai-input").fill("Compress this record and save the updated Markdown file.");
    const sendPromise = page.waitForResponse("**/api/chat/send");
    await page.getByTestId("ai-send-btn").click();
    await sendPromise;

    remoteRecordChanged = true;
    await injectMockStream(page, "test-reload-001", "I updated the backing record. Reload the page to view it.");

    await expect(page.getByTestId("save-status")).toContainText("Remote update available", { timeout: 5_000 });
    await expect(page.getByTestId("pending-page-reload-indicator")).toBeVisible();
    await expect(page.locator(".ProseMirror")).not.toContainText("RELOADED-E2E-MARKER");

    await clickReloadButton(page);

    await expect(page.locator(".ProseMirror")).toContainText("RELOADED-E2E-MARKER");
    await expect(page.getByTestId("pending-page-reload-indicator")).toHaveCount(0);
  });

  test("confirms before pending reload discards unsaved local edits", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop only");

    await stubCodexProviderRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const pagePath = "Personal Notebook/Quick Notes/strength-training-reference-plan.html";
    const remoteContent =
      "<p>REMOTE-UPDATE-SHOULD-NOT-OVERWRITE-LOCAL-DRAFT</p>";
    let remoteRecordChanged = false;
    let blockAutosave = false;
    let saveAttemptCount = 0;

    // Seed before installing the PUT blocker so the fixture page exists.
    await seedStrengthTrainingNote(page);

    await page.route("**/api/page**", async (route, request) => {
      const url = new URL(request.url());
      if (request.method() === "PUT") {
        if (!blockAutosave) {
          await route.continue();
          return;
        }
        saveAttemptCount += 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Autosave should be blocked while a remote reload is pending." }),
        });
        return;
      }

      if (request.method() === "GET" && url.searchParams.get("path") === pagePath && remoteRecordChanged) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            page: {
              id: pagePath,
              path: pagePath,
              slug: "strength-training-reference-plan",
              title: "Strength Training Reference Plan",
              preview: "Remote update should wait for reload safety.",
              content: remoteContent,
              body: remoteContent,
              metadata: {},
              createdAt: null,
              updatedAt: "2026-06-01T17:00:00.000Z",
              notebookPath: "Personal Notebook",
              notebookName: "Personal Notebook",
              sectionPath: "Personal Notebook/Quick Notes",
              sectionName: "Quick Notes",
            },
          }),
        });
        return;
      }

      await route.continue();
    });

    await page.route("**/api/chat/send", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ turn_id: "test-reload-dirty-001" }),
      });
    });

    await page.goto("/");
    await dismissBlockingOverlays(page);
    await page.waitForSelector('[data-testid="tree"]', { timeout: 15_000 });
    await page.getByTestId("tree").getByText(STRENGTH_TITLE, { exact: true }).first().click();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("ai-toggle-btn").click({ force: true });
    await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible();
    await page.getByTestId("ai-input").fill("Update the backing record directly.");
    const sendPromise = page.waitForResponse("**/api/chat/send");
    await page.getByTestId("ai-send-btn").click();
    await sendPromise;

    // Mark remote pending + block autosave, then type local edits that must not be discarded silently.
    remoteRecordChanged = true;
    blockAutosave = true;
    await injectMockStream(page, "test-reload-dirty-001", "I saved the backing record. Reload when ready.");
    await expect(page.getByTestId("save-status")).toContainText("Remote update available", { timeout: 5_000 });
    await expect(page.getByTestId("pending-page-reload-indicator")).toBeVisible();

    await page.locator(".ProseMirror").click();
    await page.keyboard.type(" LOCAL-UNSAVED-DRAFT");
    await expect(page.locator(".ProseMirror")).toContainText("LOCAL-UNSAVED-DRAFT");
    await clickReloadButton(page);

    await expect(page.getByRole("heading", { name: "Reload external changes?" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("will discard the unsaved local edits currently visible")).toBeVisible();
    await expect(page.getByTestId("save-status")).toContainText("Reload paused", { timeout: 5_000 });
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.locator(".ProseMirror")).toContainText("LOCAL-UNSAVED-DRAFT");
    await expect(page.locator(".ProseMirror")).not.toContainText("REMOTE-UPDATE-SHOULD-NOT-OVERWRITE-LOCAL-DRAFT");
    await page.waitForTimeout(1_500);
    expect(saveAttemptCount).toBe(0);

    // Pending reload stays active after Cancel; click Reload again to confirm discard.
    await expect(page.getByTestId("pending-page-reload-indicator")).toBeVisible();
    await clickReloadButton(page);
    await expect(page.getByRole("heading", { name: "Reload external changes?" })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Discard and reload" }).click();

    await expect(page.locator(".ProseMirror")).toContainText("REMOTE-UPDATE-SHOULD-NOT-OVERWRITE-LOCAL-DRAFT");
    await expect(page.locator(".ProseMirror")).not.toContainText("LOCAL-UNSAVED-DRAFT");
    await expect(page.getByTestId("pending-page-reload-indicator")).toHaveCount(0);
  });
});

// ─── Companion session persistence (SN-80) ──────────────────────────────────────

test.describe("SN-11 AI sidebar — companion session persistence (desktop)", () => {
  test("keep on restores the thread across reload; keep off disposes it", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop only");

    const pinnedPagePath = "Personal Notebook/Quick Notes/strength-training-reference-plan.html";

    await stubCodexProviderRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const reply = "PERSISTED-COMPANION-REPLY";
    let turnCounter = 0;
    await page.route("**/api/chat/send", async (route) => {
      turnCounter += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ turn_id: `sn80-turn-${turnCounter}` }),
      });
    });

    const openSidebar = async () => {
      await dismissBlockingOverlays(page);
      await page.getByTestId("ai-toggle-btn").click({ force: true });
      await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible();
    };

    await openStrengthTrainingNote(page);
    await expect(page.locator('[data-testid^="page-"][data-selected="true"]')).toContainText(STRENGTH_TITLE);
    await openSidebar();

    // Turn the preference on (persists to vault .smart-notes-ui-state.json).
    // Seeded E2E UI state may already have companionPersist=true.
    const keepToggle = page.getByTestId("companion-keep-toggle");
    if (!(await keepToggle.isChecked())) {
      const uiStatePatch = page.waitForResponse(
        (response) =>
          response.url().includes("/api/ui-state") && response.request().method() === "PATCH"
      );
      await keepToggle.check();
      await uiStatePatch;
    }
    await expect(keepToggle).toBeChecked();

    // Send a message and stream a reply into the thread.
    await page.getByTestId("ai-input").fill("Remember this conversation, please.");
    const sendPromise = page.waitForResponse("**/api/chat/send");
    await page.getByTestId("ai-send-btn").click();
    await sendPromise;
    await injectMockStream(page, `sn80-turn-${turnCounter}`, reply);
    await expect(page.getByTestId("ai-sidebar-rail")).toContainText(reply);

    // Wait for the debounced sidecar write that includes the assistant reply (not the
    // empty save that can fire when Keep is first checked).
    await page.waitForResponse(
      (response) => {
        if (!response.url().includes("/api/companion") || response.request().method() !== "PUT") {
          return false;
        }
        return (response.request().postData() ?? "").includes(reply);
      },
      { timeout: 15_000 }
    );

    // Sanity-check the vault sidecar before reload.
    const sidecarBeforeReload = await page.request.get(
      `/api/companion?path=${encodeURIComponent(pinnedPagePath)}`
    );
    expect(sidecarBeforeReload.ok()).toBeTruthy();
    expect(JSON.stringify(await sidecarBeforeReload.json())).toContain(reply);

    // Reload: pin the same page, hydrate ui-state, then restore from the vault sidecar.
    await page.addInitScript((path) => {
      window.localStorage.setItem("smart-notes-active-page", path);
    }, pinnedPagePath);
    const uiStateGet = page.waitForResponse(
      (response) =>
        response.url().includes("/api/ui-state") && response.request().method() === "GET"
    );
    const companionGet = page.waitForResponse(
      (response) =>
        response.url().includes("/api/companion") &&
        response.url().includes("strength-training-reference-plan.html") &&
        response.request().method() === "GET"
    );
    await page.reload();
    await page.waitForSelector('[data-testid="tree"]', { timeout: 15_000 });
    await expect(page.locator('[data-testid^="page-"][data-selected="true"]')).toContainText(STRENGTH_TITLE, {
      timeout: 10_000,
    });
    await uiStateGet;
    await companionGet;
    await openSidebar();
    await expect(page.getByTestId("companion-keep-toggle")).toBeChecked();
    await expect(page.getByTestId("ai-sidebar-rail")).toContainText(reply, { timeout: 10_000 });

    // Turn the preference off: the live transcript and the persisted thread are disposed.
    const companionDelete = page.waitForResponse(
      (response) =>
        response.url().includes("/api/companion") && response.request().method() === "DELETE"
    );
    await page.getByTestId("companion-keep-toggle").uncheck();
    await companionDelete;
    await expect(page.getByTestId("ai-sidebar-rail")).not.toContainText(reply);

    // Reload again: nothing is restored because the sidecar was cleared.
    await page.reload();
    await page.waitForSelector('[data-testid="tree"]', { timeout: 15_000 });
    await openSidebar();
    await expect(page.getByTestId("companion-keep-toggle")).not.toBeChecked();
    await expect(page.getByTestId("ai-sidebar-rail")).not.toContainText(reply);
  });
});

// ─── Visual regression tests ──────────────────────────────────────────────────

test.describe("SN-11 AI sidebar visual regression", () => {
  test("desktop baseline route", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop baseline runs only in the desktop project.");
    await stubChatModelRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 1440, height: 1200 });

    await page.goto("/_dev/screens?surface=desktop");
    await settleVisuals(page);
    await expect(
      await captureClippedScreenshot(page, "ai-sidebar-rail", { width: 480, height: 889 })
    ).toMatchSnapshot("sn-11-ai-sidebar-desktop-showcase.png", {
      maxDiffPixels: 50,
    });
  });

  test("desktop live rail matches baseline", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop comparison runs only in the desktop project.");
    await stubChatModelRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 1440, height: 1200 });

    await openWelcomeNote(page);
    await page.getByTestId("ai-toggle-btn").click();
    await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible();
    await settleVisuals(page);
    await expect(
      await captureClippedScreenshot(page, "ai-sidebar-rail", { width: 360, height: 889 })
    ).toMatchSnapshot("sn-11-ai-sidebar-desktop-live.png", {
      maxDiffPixels: 50,
    });
  });

  test("mobile baseline route", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile baseline runs only in the mobile project.");
    await stubChatModelRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 430, height: 1200 });

    await page.goto("/_dev/screens?surface=mobile");
    await disableFocusRings(page);
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await settleVisuals(page);
    await expect(page.getByTestId("mobile-ai-sheet")).toBeVisible();
    await expect(
      await page.getByTestId("mobile-ai-sheet").screenshot({
        animations: "disabled",
        caret: "hide",
      })
    ).toMatchSnapshot("sn-11-ai-sidebar-mobile-showcase.png", {
      maxDiffPixels: 50,
    });
  });

  test("mobile live sheet matches baseline", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile comparison runs only in the mobile project.");
    await stubChatModelRoutes(page);
    await resetClientState(page);
    await page.setViewportSize({ width: 430, height: 1200 });

    await openWelcomeNote(page);
    await page.getByTestId("ai-toggle-btn").click();
    await expect(page.getByTestId("mobile-ai-sheet")).toBeVisible();
    // Companion Keep may be left ON by earlier SN-11 persistence tests via vault ui-state.
    const keepToggle = page.getByTestId("companion-keep-toggle-mobile");
    if (await keepToggle.isChecked()) {
      await keepToggle.click();
      await expect(keepToggle).not.toBeChecked();
    }
    await disableFocusRings(page);
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await settleVisuals(page);
    await expect(
      await page.getByTestId("mobile-ai-sheet").screenshot({
        animations: "disabled",
        caret: "hide",
      })
    ).toMatchSnapshot("sn-11-ai-sidebar-mobile-live.png", {
      maxDiffPixels: 50,
    });
  });
});
