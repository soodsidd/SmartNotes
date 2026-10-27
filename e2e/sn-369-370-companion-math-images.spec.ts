import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { dismissBlockingOverlays } from "./helpers";

/**
 * SN-369: equations render via KaTeX while currency stays literal in the Companion sidebar.
 * SN-370: agents display downloaded / generated images inline via companion_image_put.
 */

// Seeded by e2e/global-setup.ts.
const NOTE_TITLE = "Strength Training Reference Plan";
const NOTE_PATH = "Personal Notebook/Quick Notes/strength-training-reference-plan.html";
// 64x40 solid-teal PNG (generated image stand-in).
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAAWElEQVR4nO3PwQkAIBDAsBvCsX07r0P4CEKhA6Szzv664YIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALHrtRTBy1LVBT6gAAAABJRU5ErkJggg==";

const EVIDENCE_369 = path.join(__dirname, "evidence", "SN-369");
const EVIDENCE_370 = path.join(__dirname, "evidence", "SN-370");

async function stubProviders(page: Page) {
  await page.route("**/api/chat/providers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ default: "codex", providers: [{ id: "codex", name: "Codex CLI", models: ["gpt-5.4"] }] }),
    })
  );
  await page.route("**/api/chat/settings", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: "gpt-5.4" }) })
  );
}

async function inject(page: Page, event: { turn_id: string; type: string; seq?: number; payload?: Record<string, unknown> }) {
  await page.evaluate((next) => {
    const bridge = (window as unknown as { __testChatBridge?: { injectChatEvent: (e: unknown) => void } }).__testChatBridge;
    if (!bridge) throw new Error("__testChatBridge not available");
    bridge.injectChatEvent(next);
  }, event);
}

async function openNoteWithCompanion(page: Page) {
  await page.addInitScript((notePath) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("theme", "light");
    window.localStorage.setItem("smart-notes-active-page", notePath);
  }, NOTE_PATH);
  const hydrated = page.waitForResponse((r) => r.url().includes("/api/ui-state") && r.request().method() === "GET");
  await page.goto("/");
  await hydrated;
  await dismissBlockingOverlays(page);
  await page.waitForSelector('[data-testid="tree"]', { timeout: 15_000 });
  const selected = page.locator('[data-testid^="page-"][data-selected="true"]').filter({ hasText: NOTE_TITLE });
  if (!(await selected.isVisible().catch(() => false))) {
    await page.getByTestId("tree").getByText(NOTE_TITLE, { exact: true }).first().click();
  }
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("ai-toggle-btn").click();
  await expect(page.getByTestId("ai-sidebar-rail")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function sendAndRespond(page: Page, prompt: string, reply: string) {
  let turnId = "";
  await page.unroute("**/api/chat/send").catch(() => {});
  await page.route("**/api/chat/send", (route) => {
    // The client mints the turn id; the server must echo it back.
    turnId = (JSON.parse(route.request().postData() ?? "{}") as { turn_id: string }).turn_id;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ turn_id: turnId }) });
  });
  // Vault UI-state hydration resets the transcript; never send before it lands.
  await page.waitForTimeout(500);
  await page.getByTestId("ai-input").fill(prompt);
  const sent = page.waitForResponse("**/api/chat/send");
  await page.getByTestId("ai-send-btn").click();
  await sent;
  // The client only accepts events once the send response registered the turn;
  // re-inject the same seq (deduped client-side) until the token lands.
  const marker = reply.split("\n")[0].slice(0, 12);
  await expect
    .poll(async () => {
      await inject(page, { turn_id: turnId, type: "token", seq: 1, payload: { text: reply } });
      return page.getByTestId("ai-sidebar-rail").locator(".chat-prose").last().innerText().catch(() => "");
    }, { timeout: 10_000, intervals: [150, 250, 500] })
    .toContain(marker);
  await inject(page, { turn_id: turnId, type: "done", seq: 2, payload: { model: "gpt-5.4" } });
}

test.describe("SN-369/SN-370 Companion sidebar math + images", () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_369, { recursive: true });
    fs.mkdirSync(EVIDENCE_370, { recursive: true });
  });

  test("equations render via KaTeX; currency and code dollars stay literal", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop rail evidence");
    await stubProviders(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNoteWithCompanion(page);

    const reply = [
      "I paid $564.08 for the tow, although the $80 storage charge was waived.",
      "",
      "Hims would bill **$5 every 150 days**, then charged **$175**.",
      "",
      "Euler: $e^{i\\pi} + 1 = 0$ and Pythagoras \\(a^2 + b^2 = c^2\\).",
      "",
      "$$",
      "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
      "$$",
      "",
      "Shell stays literal: `echo $HOME $PATH`",
    ].join("\n");
    await sendAndRespond(page, "Explain the charges and the formulas", reply);

    const rail = page.getByTestId("ai-sidebar-rail");
    const prose = rail.locator(".chat-prose").last();
    await expect(prose).toContainText("I paid $564.08 for the tow, although the $80 storage charge was waived.");
    await expect(prose).toContainText("$5 every 150 days");
    await expect(prose).toContainText("$175");
    await expect(prose.locator("code").filter({ hasText: "echo $HOME $PATH" })).toBeVisible();
    // Euler + Pythagoras inline + quadratic display = 3 KaTeX nodes, one display.
    await expect(prose.locator(".katex")).toHaveCount(3);
    await expect(prose.locator(".katex-display")).toHaveCount(1);
    await expect(prose.locator(".katex-error")).toHaveCount(0);

    await prose.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await rail.screenshot({ path: path.join(EVIDENCE_369, "sidebar-equations-vs-currency.png"), animations: "disabled" });
  });

  test("agent-displayed downloaded + generated images render inline, bounded, durable, with fallback", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop rail evidence");
    await stubProviders(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Generated image: base64 bytes through the real vault tool endpoint.
    const generated = await page.request.post("/api/agent/vault", {
      data: { tool: "companion_image_put", args: { dataBase64: PNG_BASE64, alt: "Generated teal swatch", fileName: "swatch.png" } },
    });
    expect(generated.ok()).toBeTruthy();
    const generatedData = (await generated.json()).result.data as { url: string; markdown: string; path: string };
    expect(generatedData.path.startsWith(".companion-images/")).toBe(true);

    // Downloaded image: the server fetches a real http URL (served by this same app).
    const origin = String(test.info().project.use.baseURL);
    const downloaded = await page.request.post("/api/agent/vault", {
      data: { tool: "companion_image_put", args: { url: `${origin}${generatedData.url}`, alt: "Downloaded web image" } },
    });
    expect(downloaded.ok()).toBeTruthy();
    const downloadedData = (await downloaded.json()).result.data as { url: string; markdown: string; source: string };
    expect(downloadedData.source).toBe("download");

    // Readable tool failure for a non-image URL.
    const failed = await page.request.post("/api/agent/vault", {
      data: { tool: "companion_image_put", args: { url: `${origin}/api/chat/providers-does-not-exist` } },
    });
    expect(failed.ok()).toBeFalsy();
    expect(JSON.stringify(await failed.json())).toMatch(/Could not (download|display) image/);

    await openNoteWithCompanion(page);
    const reply = [
      "Here is the image I generated:",
      "",
      generatedData.markdown,
      "",
      "And the one I downloaded:",
      "",
      downloadedData.markdown,
      "",
      "This one is gone: ![Deleted diagram](</vault/.companion-images/missing.png>)",
    ].join("\n");
    await sendAndRespond(page, "Show me the images", reply);

    const rail = page.getByTestId("ai-sidebar-rail");
    const images = rail.getByTestId("companion-chat-image");
    await expect(images).toHaveCount(2);
    const genImg = rail.getByRole("img", { name: "Generated teal swatch" });
    const dlImg = rail.getByRole("img", { name: "Downloaded web image" });
    await expect(genImg).toBeVisible();
    await expect(dlImg).toBeVisible();
    for (const img of [genImg, dlImg]) {
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
    await expect(rail.getByTestId("companion-chat-image-fallback")).toContainText("Image unavailable: Deleted diagram");

    // No layout blowout: images stay inside the message column, rail has no horizontal overflow.
    const railBox = await rail.boundingBox();
    const imgBox = await genImg.boundingBox();
    expect(railBox && imgBox && imgBox.x + imgBox.width <= railBox.x + railBox.width).toBeTruthy();
    expect(await rail.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    await rail.locator(".chat-prose").last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await rail.screenshot({ path: path.join(EVIDENCE_370, "sidebar-inline-images.png"), animations: "disabled" });

    // Durable: the stored image URLs still resolve after a reload.
    await page.reload();
    for (const url of [generatedData.url, downloadedData.url]) {
      const res = await page.request.get(url);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
    }
  });

  test("regression: composer image attachments still attach and preview", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop rail evidence");
    await stubProviders(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNoteWithCompanion(page);

    const fileInput = page.getByTestId("ai-sidebar-rail").locator('input[type="file"]');
    await fileInput.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64") });
    const preview = page.getByTestId("ai-sidebar-rail").getByRole("img", { name: "photo.png" });
    await expect(preview).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Remove photo.png" })).toBeVisible();
    await page.getByTestId("ai-sidebar-rail").screenshot({ path: path.join(EVIDENCE_370, "composer-attachment-regression.png"), animations: "disabled" });
  });
});
