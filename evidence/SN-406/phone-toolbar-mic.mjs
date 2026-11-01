// SN-406 rework 1: phone format-bar mic (top-level, left of "+") records with
// real audio, auto-stops on silence, and appends after existing text.
// Usage: node evidence/SN-406/phone-toolbar-mic.mjs <baseUrl>
import { chromium, devices } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2];
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path.join(dir, "long-clip.wav")}%noloop`] });
const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: baseUrl, permissions: ["microphone"] });
await context.addInitScript(() => { new MutationObserver(() => { document.getElementById("__av_preview_banner")?.remove(); document.querySelector("[data-testid=sw-update-banner]")?.remove(); }).observe(document, { childList: true, subtree: true }); });
const page = await context.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const out = {};
let notebookPath = null;
try {
  notebookPath = (await (await context.request.post("/api/notebook", { data: { name: "SN-406 phone toolbar mic" } })).json()).notebook.path;
  const tree = await (await context.request.get("/api/vault")).json();
  const sectionPath = tree.tree.find((n) => n.path === notebookPath)?.sections?.[0]?.path ?? notebookPath;
  const pagePath = (await (await context.request.post("/api/page", { data: { notebookPath, sectionPath, title: "Phone toolbar mic" } })).json()).page.path;
  await page.goto(`/?page=${encodeURIComponent(pagePath)}`, { waitUntil: "domcontentloaded" });
  const editor = page.locator(".ProseMirror.editor-content");
  await editor.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  await editor.tap();
  await page.keyboard.type("EXISTING-PHONE-TEXT.");
  const mic = page.getByTestId("toolbar-dictate-mobile");
  out.mic = { visible: await mic.isVisible(), box: await mic.boundingBox(), parent: await mic.evaluate((el) => el.parentElement?.getAttribute("data-testid")) };
  await mic.tap();
  await page.waitForTimeout(1500);
  out.recordingPhase = await mic.getAttribute("data-dictation-phase");
  await page.screenshot({ path: path.join(dir, "desktop", "after-phone-toolbar-recording.png") });
  await page.waitForFunction(() => /End of test/i.test(document.querySelector(".ProseMirror.editor-content")?.textContent ?? ""), null, { timeout: 120_000 });
  const text = await editor.innerText();
  out.afterPhase = await mic.getAttribute("data-dictation-phase");
  out.existingFirst = text.indexOf("EXISTING-PHONE-TEXT.") === 0 && /This is a long dictation/i.test(text);
  out.hasEnd = /End of test/i.test(text);
  await page.screenshot({ path: path.join(dir, "desktop", "after-phone-toolbar-done.png") });
} finally {
  if (notebookPath) await context.request.delete(`/api/notebook?path=${encodeURIComponent(notebookPath)}`).catch(() => {});
  out.consoleErrors = errors;
  writeFileSync(path.join(dir, "desktop", "phone-toolbar-mic.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
  await browser.close();
}
