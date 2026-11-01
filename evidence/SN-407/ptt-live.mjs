// SN-407 live push-to-talk check (desktop, Windows), against the sidecar preview.
//
// A headed Chromium (fake mic plays SN-406's long-clip.wav speech) opens a
// scratch note. Then REAL OS key input (os-keys.ps1 / keybd_event, not
// Playwright's synthetic CDP keys) holds the bound key for ~4 s with typematic
// repeat keydowns, releases it, and types "abc". We record:
//   - the page's key event log (keydown / repeat / keyup, getModifierState)
//   - that release transcribed and inserted text after the existing text
//   - the real Windows Caps Lock toggle state before / after, and what the
//     real "abc" typed afterward actually produced in the note
// Scenarios: default Caps Lock binding, then F8 bound through the Settings
// key picker. Caps Lock is always restored to its starting state afterward.
// Usage: node evidence/SN-407/ptt-live.mjs <baseUrl> [--synthetic]
//   --synthetic: Playwright (CDP) key events instead of real OS input, for
//   when the desktop is locked / not interactive. Verifies the hold ->
//   release -> transcribe -> insert pipeline and repeat handling, but cannot
//   observe the real OS Caps Lock toggle (reported as null).
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2];
const synthetic = process.argv.includes("--synthetic");
const wav = path.join(dir, "..", "SN-406", "long-clip.wav");
const helper = path.join(dir, "os-keys.ps1");
const report = { baseUrl, platform: process.platform, input: synthetic ? "playwright-synthetic" : "os-keybd_event", scenarios: [] };

const KEYS = {
  CapsLock: { vk: "14", scan: "3A" },
  F8: { vk: "77", scan: "42" },
};
const TYPE_ABC = "d:41:1E;u:41:1E;d:42:30;u:42:30;d:43:2E;u:43:2E";

function osKeys(plan) {
  const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Plan", plan], { encoding: "utf8" });
  return JSON.parse(out.trim());
}

const browser = await chromium.launch({
  headless: synthetic,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}%noloop`,
    "--window-position=40,40",
    "--window-size=1500,950",
  ],
});
const setup = await browser.newContext({ baseURL: baseUrl });
let notebookPath = null;
const pageErrors = [];

async function scenario(bound) {
  const { vk, scan } = KEYS[bound];
  const context = await browser.newContext({ baseURL: baseUrl, permissions: ["microphone"], viewport: { width: 1440, height: 860 } });
  await context.addInitScript(() => {
    new MutationObserver(() => document.getElementById("__av_preview_banner")?.remove()).observe(document, { childList: true, subtree: true });
    window.__keylog = [];
    for (const type of ["keydown", "keyup"]) {
      window.addEventListener(
        type,
        (e) => window.__keylog.push({ type, code: e.code, key: e.key, repeat: e.repeat, caps: e.getModifierState("CapsLock"), t: Math.round(performance.now()) }),
        true
      );
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${bound}: ${e}`));
  await page.goto(`/?page=${encodeURIComponent(report.pagePath)}`, { waitUntil: "domcontentloaded" });
  const editor = page.locator(".ProseMirror.editor-content");
  await editor.waitFor({ timeout: 90_000 });
  const result = { bound };

  // Bind the key through the real Settings key picker.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-dictation-ptt").waitFor();
  if (bound !== "CapsLock") {
    await page.getByTestId("settings-dictation-ptt-capture").click();
    await page.keyboard.press(bound);
  }
  result.settingsLabel = (await page.getByTestId("settings-dictation-ptt-capture").innerText()).trim();
  result.stored = await page.evaluate(() => localStorage.getItem("smart-notes-dictation-ptt-key"));
  await page.keyboard.press("Escape");
  await page.getByTestId("settings-dictation-ptt").waitFor({ state: "detached" });

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`${bound} start. `);
  const textBefore = (await editor.innerText()).trim();
  await page.bringToFront();
  await page.evaluate(() => (window.__keylog = []));
  await page.waitForTimeout(400);

  const mic = page.getByTestId("toolbar-dictate");
  // Hold ~4 s with typematic repeats (every 33 ms after a 500 ms delay), then release.
  let hold;
  if (synthetic) {
    await page.keyboard.down(bound);
    await page.waitForTimeout(500);
    for (let i = 0; i < 100; i += 1) {
      await page.keyboard.down(bound); // already down -> repeat: true
      await page.waitForTimeout(33);
    }
    result.phaseWhileHeld = await mic.getAttribute("data-dictation-phase");
    result.statusWhileHeld = await page.locator('[data-testid$="dictation-status"]').first().innerText().catch(() => null);
    await page.keyboard.up(bound);
    hold = { foregroundOk: null, capsBefore: null, capsAfter: null };
  } else {
    hold = osKeys(`d:${vk}:${scan};s:500;r:${vk}:${scan}:100:33;u:${vk}:${scan}`);
  }
  result.hold = hold;
  if (!synthetic && !hold.foregroundOk) throw new Error(`Chromium is not the foreground window (${hold.foregroundPath}); no keys sent.`);
  result.phaseAfterRelease = await mic.getAttribute("data-dictation-phase");
  await page.waitForFunction(() => document.querySelector('[data-testid="toolbar-dictate"]')?.getAttribute("data-dictation-phase") === "idle", null, { timeout: 60_000 });
  await page.waitForTimeout(300);
  const textAfterRelease = (await editor.innerText()).trim();
  result.status = await page.locator('[data-testid$="dictation-status"]').first().innerText().catch(() => null);
  result.inserted = textAfterRelease.startsWith(textBefore) && textAfterRelease.length > textBefore.length;
  result.insertedText = textAfterRelease.slice(textBefore.length).trim();

  // Real typing right after push-to-talk.
  let typed = { capsAfter: null };
  if (synthetic) await page.keyboard.type("abc");
  else typed = osKeys(TYPE_ABC);
  await page.waitForTimeout(300);
  const textAfterTyping = (await editor.innerText()).trim();
  result.typedAbcBecame = textAfterTyping.slice(textAfterRelease.length).trim();
  result.capsBeforeHold = hold.capsBefore;
  result.capsAfterHold = hold.capsAfter;
  result.capsAfterTyping = typed.capsAfter;
  result.capsStateChanged = synthetic ? null : hold.capsBefore !== hold.capsAfter;

  const log = await page.evaluate(() => window.__keylog);
  const boundEvents = log.filter((e) => e.code === bound);
  result.keyEvents = {
    keydownFirst: boundEvents.filter((e) => e.type === "keydown" && !e.repeat).length,
    keydownRepeat: boundEvents.filter((e) => e.type === "keydown" && e.repeat).length,
    keyup: boundEvents.filter((e) => e.type === "keyup").length,
    typedKeys: log.filter((e) => e.type === "keydown" && /^Key[ABC]$/.test(e.code)).map((e) => ({ key: e.key, caps: e.caps })),
  };
  await page.screenshot({ path: path.join(dir, `ptt-${bound}${synthetic ? "-synthetic" : ""}-after.png`) });

  // Restore the owner's Caps Lock state no matter what.
  if (!synthetic && typed.capsAfter !== hold.capsBefore) {
    const restore = osKeys(`d:${KEYS.CapsLock.vk}:${KEYS.CapsLock.scan};u:${KEYS.CapsLock.vk}:${KEYS.CapsLock.scan}`);
    result.capsRestoredTo = restore.capsAfter;
  }
  report.scenarios.push(result);
  console.log(JSON.stringify(result, null, 2));
  await context.close();
}

try {
  const nb = await (await setup.request.post("/api/notebook", { data: { name: "SN-407 push-to-talk live" } })).json();
  notebookPath = nb.notebook.path;
  const tree = await (await setup.request.get("/api/vault")).json();
  const sectionPath = tree.tree.find((n) => n.path === notebookPath)?.sections?.[0]?.path ?? notebookPath;
  const created = await (await setup.request.post("/api/page", { data: { notebookPath, sectionPath, title: "Push-to-talk" } })).json();
  report.pagePath = created.page.path;
  for (const bound of ["CapsLock", "F8"]) await scenario(bound);
} finally {
  report.finalOsCaps = osKeys("").capsAfter;
  if (notebookPath) {
    const del = await setup.request.delete(`/api/notebook?path=${encodeURIComponent(notebookPath)}`);
    report.cleanupStatus = del.status();
  }
  report.pageErrors = pageErrors;
  writeFileSync(path.join(dir, synthetic ? "ptt-live-synthetic.json" : "ptt-live.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
