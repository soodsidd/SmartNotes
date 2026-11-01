// SN-406 rework 1: desktop-viewport (1440x900) live walkthrough. Editor toolbar
// "Dictate" (visible, outside the "+" menu) inserts at a mid-text caret; the
// Companion composer mic appends to a draft. Fake mic plays long-clip.wav once;
// trailing silence must trigger the 10 s auto-stop.
// Usage: node evidence/SN-406/desktop-walkthrough.mjs <baseUrl>
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2];
const wav = path.join(dir, "long-clip.wav");
const shot = (n) => path.join(dir, "desktop", n);
const report = { baseUrl, viewport: "1440x900", steps: [] };
const log = (step, data = {}) => { report.steps.push({ step, ...data }); console.log(step, JSON.stringify(data).slice(0, 600)); };

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`],
});
const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
await context.addInitScript(() => { new MutationObserver(() => { document.getElementById("__av_preview_banner")?.remove(); document.querySelector("[data-testid=sw-update-banner]")?.remove(); }).observe(document, { childList: true, subtree: true }); });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

let notebookPath = null;
try {
  const nb = await (await context.request.post("/api/notebook", { data: { name: "SN-406 desktop dictation" } })).json();
  notebookPath = nb.notebook.path;
  const tree = await (await context.request.get("/api/vault")).json();
  const sectionPath = tree.tree.find((n) => n.path === notebookPath)?.sections?.[0]?.path ?? notebookPath;
  const pagePath = (await (await context.request.post("/api/page", { data: { notebookPath, sectionPath, title: "Desktop dictation" } })).json()).page.path;

  // ── Editor toolbar Dictate: caret in the middle of existing text ────────
  await page.goto(`/?page=${encodeURIComponent(pagePath)}`, { waitUntil: "domcontentloaded" });
  const editor = page.locator(".ProseMirror.editor-content");
  await editor.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  await editor.click();
  await page.keyboard.type("FIRST-PART. SECOND-PART.");
  await page.keyboard.press("Home");
  for (let i = 0; i < "FIRST-PART.".length; i++) await page.keyboard.press("ArrowRight");

  const mic = page.getByTestId("toolbar-dictate");
  const insertMenu = page.getByTestId("format-bar").locator("[data-testid]").last();
  log("toolbar dictate (no menu opened)", {
    visible: await mic.isVisible(),
    label: (await mic.innerText()).trim(),
    box: await mic.boundingBox(),
    insideAMenu: await mic.evaluate((el) => !!el.closest('[role="menu"],[data-slot="dropdown-menu-content"]')),
    parentTestId: await mic.evaluate((el) => el.parentElement?.getAttribute("data-testid")),
  });
  await page.getByTestId("format-bar").screenshot({ path: shot("after-1440-toolbar.png") });
  await mic.click();
  await page.waitForTimeout(1500);
  log("editor recording", { phase: await mic.getAttribute("data-dictation-phase"), label: (await mic.innerText()).trim(), status: await page.getByTestId("editor-dictation-status").innerText().catch(() => null) });
  await page.screenshot({ path: shot("after-1440-editor-recording.png") });
  const t0 = Date.now();
  await page.waitForFunction(() => /End of test/i.test(document.querySelector(".ProseMirror.editor-content")?.textContent ?? ""), null, { timeout: 120_000 });
  const text = await editor.innerText();
  const iFirst = text.indexOf("FIRST-PART."), iDict = text.search(/This is a long dictation/i), iSecond = text.indexOf("SECOND-PART.");
  log("editor transcript", {
    waitedMsAfterStart: Date.now() - t0,
    autoStoppedPhase: await mic.getAttribute("data-dictation-phase"),
    insertedAtCaret: iFirst >= 0 && iFirst < iDict && iDict < iSecond,
    hasEnd: /End of test/i.test(text),
    text,
  });
  await page.screenshot({ path: shot("after-1440-editor-done.png") });

  // ── Companion composer on desktop ──────────────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  const input = page.getByTestId("ai-input");
  await page.getByTestId("ai-toggle-btn").waitFor();
  await page.waitForTimeout(4000);
  for (let k = 0; k < 3 && !(await input.isVisible()); k++) {
    await page.getByTestId("ai-toggle-btn").click();
    await page.waitForTimeout(2500);
  }
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await input.fill("EXISTING-DRAFT");
  await page.waitForTimeout(1500);
  const cmic = page.getByTestId("ai-dictation-btn");
  log("composer mic", { visible: await cmic.isVisible(), box: await cmic.boundingBox() });
  await cmic.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("after-1440-composer-recording.png") });
  await page.waitForFunction(() => /End of test/i.test(document.querySelector('[data-testid="ai-input"]')?.value ?? ""), null, { timeout: 120_000 });
  const draft = await input.inputValue();
  log("composer transcript", { startsWithExisting: draft.startsWith("EXISTING-DRAFT"), hasStart: /This is a long dictation/i.test(draft), hasEnd: /End of test/i.test(draft) });
  await page.screenshot({ path: shot("after-1440-composer-done.png") });
  await input.fill("");
} finally {
  if (notebookPath) await context.request.delete(`/api/notebook?path=${encodeURIComponent(notebookPath)}`).catch(() => {});
  report.consoleErrors = consoleErrors;
  writeFileSync(path.join(dir, "desktop", "desktop-walkthrough.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
