// SN-406 live offline -> Retry walkthrough (phone viewport, Companion composer).
// Run with the engine stopped; the script relaunches OpenWhispr before Retry.
// Usage: node evidence/SN-406/phone-offline-retry.mjs <baseUrl>
import { chromium, devices } from "@playwright/test";
import { spawn } from "node:child_process";
import net from "node:net";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const out = { steps: [] }; const log = (s, d = {}) => { out.steps.push({ s, ...d }); console.log(s, JSON.stringify(d)); };
const engineUp = () => new Promise((r) => { const s = net.connect(6006, "127.0.0.1"); s.on("connect", () => { s.end(); r(true); }); s.on("error", () => r(false)); });
const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path.join(dir, "long-clip.wav")}%noloop`] });
const c = await b.newContext({ ...devices["iPhone 13"], baseURL: process.argv[2], permissions: ["microphone"] });
await c.addInitScript(() => { new MutationObserver(() => document.getElementById("__av_preview_banner")?.remove()).observe(document, { childList: true, subtree: true }); });
const p = await c.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("/", { waitUntil: "domcontentloaded" });
const input = p.getByTestId("ai-input"); const mic = p.getByTestId("ai-dictation-btn"); const status = p.getByTestId("ai-dictation-status");
await p.getByTestId("ai-toggle-btn").waitFor(); await p.waitForTimeout(4000);
for (let k = 0; k < 3 && !(await input.isVisible()); k++) { await p.getByTestId("ai-toggle-btn").tap(); await p.waitForTimeout(2500); }
await input.fill("EXISTING-DRAFT"); await p.waitForTimeout(1000);
log("engine up before record", { up: await engineUp() });
await mic.tap(); await p.waitForTimeout(6000); await mic.tap();
await p.getByTestId("dictation-retry").waitFor({ timeout: 30000 });
log("offline notice", { status: await status.innerText(), draft: await input.inputValue() });
await p.screenshot({ path: path.join(dir, "phone-composer-offline.png") });
spawn(path.join(process.env.LOCALAPPDATA, "Programs", "OpenWhispr", "OpenWhispr.exe"), [], { detached: true, stdio: "ignore" }).unref();
const t0 = Date.now(); while (!(await engineUp()) && Date.now() - t0 < 90000) await p.waitForTimeout(1000);
log("engine relaunched", { up: await engineUp(), ms: Date.now() - t0 });
await p.getByTestId("dictation-retry").tap();
await p.waitForFunction(() => (document.querySelector('[data-testid="ai-input"]')?.value ?? "").length > "EXISTING-DRAFT".length + 10, null, { timeout: 60000 });
log("after retry", { draft: await input.inputValue(), retryGone: !(await p.getByTestId("dictation-retry").isVisible()) });
await p.screenshot({ path: path.join(dir, "phone-composer-after-retry.png") });
await input.fill(""); out.pageErrors = errors;
writeFileSync(path.join(dir, "phone-offline-retry.json"), JSON.stringify(out, null, 2)); await b.close();
