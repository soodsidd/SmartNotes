// SN-356 rework cycle 2: live UI evidence against the registered preview's app
// port. Real /api/chat/send (no stub) with the Cursor provider: Off turn, then
// tick Computer and send again; screenshot the checked box with the ON reply.
// Usage: PREVIEW=http://127.0.0.1:<port> node evidence/SN-356/live-ui-on-turn.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.PREVIEW;
const NOTE_PATH = "Personal Notebook/Quick Notes/strength-training-reference-plan.html";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const wire = [];
page.on("request", (req) => {
  if (req.url().endsWith("/api/chat/send") && req.method() === "POST") {
    const body = JSON.parse(req.postData() || "{}");
    wire.push({ provider: body.provider, thread_key: body.thread_key, computer_access: body.computer_access });
  }
});
await page.route("**/api/chat/providers", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ default: "cursor", providers: [{ id: "cursor", name: "Cursor", models: ["auto"] }] }) })
);
await page.addInitScript((p) => { localStorage.setItem("theme", "light"); localStorage.setItem("smart-notes-active-page", p); }, NOTE_PATH);
await page.request.put(`${base}/api/page`, { data: { path: NOTE_PATH, title: "Strength Training Reference Plan", content: "<p>SN-356 live Computer access check.</p>" } });
await page.goto(base);
await page.waitForTimeout(4000);
await page.keyboard.press("Escape");
await page.locator('[data-testid="tree"]').getByText("Strength Training Reference Plan", { exact: true }).first().click().catch(() => {});
await page.getByTestId("ai-toggle-btn").click();
const surface = page.getByTestId("ai-sidebar");
const toggle = page.getByTestId("companion-computer-toggle");
const ask = "Diagnose this PC: run a PowerShell command to count running processes and report the exact count. If you have no shell access, say so.";
async function turn(text, pattern) {
  await page.getByTestId("ai-input").filter({ visible: true }).first().fill(text);
  await page.getByTestId("ai-send-btn").filter({ visible: true }).first().click();
  const before = (await surface.innerText()).split(pattern).length;
  await page.waitForFunction(
    ({ source, flags, count }) => {
      const el = document.querySelector('[data-testid="ai-sidebar"]');
      return !!el && el.innerText.split(new RegExp(source, flags)).length > count;
    },
    { source: pattern.source, flags: pattern.flags, count: before },
    { timeout: 240_000, polling: 1000 }
  );
  await page.waitForTimeout(1500);
}
await turn(ask, /Computer access is (still )?off/i);
await surface.screenshot({ path: path.join(here, "live-ui-1-off-refuses.png") });
await toggle.check();
await turn(`ok try again. ${ask}`, /\d[\d,]*\**\s+(running )?process/i);
await surface.screenshot({ path: path.join(here, "live-ui-2-checked-on-turn-succeeds.png") });
console.log(JSON.stringify({ wire, checked: await toggle.isChecked() }, null, 2));
await browser.close();
