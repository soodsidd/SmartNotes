// SN-407 live check: the Settings "Dictation auto-stop" value changes the
// real auto-stop timing, on a desktop viewport (started with Ctrl+Shift+Space
// in the editor) and a phone viewport (started with the editor FAB).
// Chromium's fake mic plays silence.wav (pure silence), so recording must stop
// after exactly the configured window.
// Usage: node evidence/SN-407/auto-stop-timing.mjs <baseUrl>
import { chromium, devices } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2];
const wav = path.join(dir, "silence.wav");
const report = { baseUrl, runs: [] };

function writeSilenceWav(file, seconds = 40, rate = 16000) {
  const samples = seconds * rate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples * 2, 40);
  writeFileSync(file, buf);
}
writeSilenceWav(wav);

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`],
});
const setup = await browser.newContext({ baseURL: baseUrl });
let notebookPath = null;
const consoleErrors = [];

async function openSettings(page) {
  const direct = page.getByRole("button", { name: "Settings", exact: true });
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
  } else {
    await page.getByRole("button", { name: /More/ }).first().click();
    await page.getByTestId("app-settings-trigger").click();
  }
  await page.getByTestId("settings-dictation-silence").waitFor();
}

async function run({ label, contextOptions, seconds, start }) {
  const context = await browser.newContext({ ...contextOptions, baseURL: baseUrl, permissions: ["microphone"] });
  await context.addInitScript(() => {
    new MutationObserver(() => document.getElementById("__av_preview_banner")?.remove()).observe(document, { childList: true, subtree: true });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`${label}: ${e}`));
  await page.goto(`/?page=${encodeURIComponent(report.pagePath)}`, { waitUntil: "domcontentloaded" });
  const editor = page.locator(".ProseMirror.editor-content");
  await editor.waitFor({ timeout: 90_000 });

  // Set the timeout through the real Settings dialog.
  await openSettings(page);
  await page.getByTestId(`settings-dictation-silence-${seconds}`).click();
  const stored = await page.evaluate(() => localStorage.getItem("smart-notes-dictation-silence-seconds"));
  await page.keyboard.press("Escape");
  await page.getByTestId("settings-dictation-silence").waitFor({ state: "detached" });

  const button = await start(page, editor);
  await page.waitForFunction((el) => el.getAttribute("data-dictation-phase") === "recording", await button.elementHandle(), { timeout: 15_000 });
  const t0 = Date.now();
  const status = await page.locator('[data-testid$="dictation-status"]').first().innerText().catch(() => null);
  await page.waitForFunction((el) => el.getAttribute("data-dictation-phase") !== "recording", await button.elementHandle(), { timeout: 60_000, polling: 50 });
  const autoStopMs = Date.now() - t0;
  await page.screenshot({ path: path.join(dir, `${label}-${seconds}s-after.png`) });
  const result = { label, configuredSeconds: seconds, stored, statusWhileRecording: status, autoStopMs };
  report.runs.push(result);
  console.log(JSON.stringify(result));
  await context.close();
}

const desktopStart = async (page, editor) => {
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+Shift+Space");
  return page.getByTestId("toolbar-dictate");
};
const phoneStart = async (page) => {
  const fab = page.getByTestId("editor-dictation-fab");
  await fab.tap();
  return fab;
};
const desktop = { viewport: { width: 1600, height: 1000 } };
const phone = { ...devices["iPhone 13"] };
delete phone.defaultBrowserType;

try {
  const nb = await (await setup.request.post("/api/notebook", { data: { name: "SN-407 auto-stop timing" } })).json();
  notebookPath = nb.notebook.path;
  const tree = await (await setup.request.get("/api/vault")).json();
  const sectionPath = tree.tree.find((n) => n.path === notebookPath)?.sections?.[0]?.path ?? notebookPath;
  const created = await (await setup.request.post("/api/page", { data: { notebookPath, sectionPath, title: "Auto-stop timing" } })).json();
  report.pagePath = created.page.path;

  for (const seconds of [2, 10]) await run({ label: "desktop", contextOptions: desktop, seconds, start: desktopStart });
  for (const seconds of [2, 10]) await run({ label: "phone", contextOptions: phone, seconds, start: phoneStart });
} finally {
  if (notebookPath) {
    const del = await setup.request.delete(`/api/notebook?path=${encodeURIComponent(notebookPath)}`);
    report.cleanupStatus = del.status();
  }
  report.consoleErrors = consoleErrors;
  writeFileSync(path.join(dir, "auto-stop-timing.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
