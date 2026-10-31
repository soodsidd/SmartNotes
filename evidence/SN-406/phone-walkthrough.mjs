// SN-406 live phone-viewport walkthrough against a running preview + engine.
// Chromium's fake mic plays long-clip.wav once (%noloop); the trailing silence
// must trigger the 10 s auto-stop. Covers the Companion composer mic (append to
// existing text) and the editor FAB (insert at caret, existing text kept).
// Usage: node evidence/SN-406/phone-walkthrough.mjs <baseUrl>
import { chromium, devices } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2];
const wav = path.join(dir, "long-clip.wav");
const report = { baseUrl, steps: [] };
const log = (step, data = {}) => { report.steps.push({ step, at: new Date().toISOString(), ...data }); console.log(step, JSON.stringify(data)); };

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}%noloop`,
  ],
});
const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: baseUrl, permissions: ["microphone"] });
// devices["iPhone 13"] is WebKit-flavoured; keep its viewport/touch on Chromium.
const page = await context.newPage();
// The Inspect proxy injects a fixed preview banner over the top bar; hide it for automation.
await context.addInitScript(() => { new MutationObserver(() => document.getElementById("__av_preview_banner")?.remove()).observe(document, { childList: true, subtree: true }); });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

let notebookPath = null;
try {
  // Scratch notebook/page, removed at the end.
  const nb = await (await context.request.post("/api/notebook", { data: { name: "SN-406 dictation smoke" } })).json();
  notebookPath = nb.notebook.path;
  const tree = await (await context.request.get("/api/vault")).json();
  const nbNode = tree.tree.find((n) => n.path === notebookPath);
  const sectionPath = nbNode?.sections?.[0]?.path ?? notebookPath;
  const created = await (await context.request.post("/api/page", { data: { notebookPath, sectionPath, title: "Dictation smoke" } })).json();
  const pagePath = created.page.path;
  log("scratch page", { pagePath });

  // ── Editor FAB: caret at end of existing text ──────────────────────────
  await page.goto(`/?page=${encodeURIComponent(pagePath)}`, { waitUntil: "domcontentloaded" });
  const editor = page.locator(".ProseMirror.editor-content");
  await editor.waitFor({ timeout: 60_000 });
  await editor.click();
  await page.keyboard.type("EXISTING-EDITOR-TEXT.");
  await page.keyboard.press("End");
  await page.evaluate(() => (document.activeElement)?.blur?.());
  const fab = page.getByTestId("editor-dictation-fab");
  await fab.waitFor({ state: "visible" });
  const fabBox = await fab.boundingBox();
  log("editor fab", { box: fabBox, viewport: page.viewportSize() });
  await fab.tap();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, "phone-editor-recording.png") });
  log("editor recording", { recordingClass: await fab.getAttribute("class"), status: await page.getByTestId("editor-dictation-status").innerText().catch(() => null) });
  // Clip is 43.5 s; then 10 s of silence auto-stops; then ~10 s transcription.
  const t0 = Date.now();
  await page.waitForFunction(() => {
    const t = document.querySelector(".ProseMirror.editor-content")?.textContent ?? "";
    return /End of test/i.test(t);
  }, null, { timeout: 120_000 });
  const editorText = await editor.innerText();
  log("editor transcript", {
    waitedMs: Date.now() - t0,
    existingKept: editorText.includes("EXISTING-EDITOR-TEXT."),
    existingFirst: editorText.indexOf("EXISTING-EDITOR-TEXT.") < editorText.indexOf("This is a long dictation"),
    hasStart: /This is a long dictation test/i.test(editorText),
    hasEnd: /End of test/i.test(editorText),
    text: editorText,
  });
  await page.screenshot({ path: path.join(dir, "phone-editor-after.png") });

  // ── Companion composer: append to existing draft ───────────────────────
  // Fake mic is one-shot per page load; reload so the clip plays again.
  await page.reload({ waitUntil: "domcontentloaded" });
  const input = page.getByTestId("ai-input");
  // Let hydration + the page-scoped companion session restore (SN-80) settle
  // before typing, otherwise the async restore resets the draft.
  await page.getByTestId("ai-toggle-btn").waitFor();
  await page.waitForTimeout(4000);
  for (let k = 0; k < 3 && !(await input.isVisible()); k++) {
    await page.getByTestId("ai-toggle-btn").tap();
    await page.waitForTimeout(2500);
  }
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await input.fill("EXISTING-DRAFT");
  await page.waitForTimeout(1500);
  log("composer draft before tap", { value: await input.inputValue() });
  const mic = page.getByTestId("ai-dictation-btn");
  log("composer mic", { box: await mic.boundingBox() });
  await mic.tap();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, "phone-composer-recording.png") });
  const autoStopStart = Date.now();
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="ai-input"]');
    return /End of test/i.test(el?.value ?? "");
  }, null, { timeout: 120_000 });
  const draft = await input.inputValue();
  log("composer transcript", {
    waitedMs: Date.now() - autoStopStart,
    startsWithExisting: draft.startsWith("EXISTING-DRAFT"),
    hasStart: /This is a long dictation test/i.test(draft),
    hasEnd: /End of test/i.test(draft),
    text: draft,
  });
  await page.screenshot({ path: path.join(dir, "phone-composer-after.png") });
  await input.fill(""); // never send
} finally {
  if (notebookPath) {
    const del = await context.request.delete(`/api/notebook?path=${encodeURIComponent(notebookPath)}`);
    log("cleanup", { status: del.status() });
  }
  report.consoleErrors = consoleErrors;
  writeFileSync(path.join(dir, "phone-walkthrough.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
