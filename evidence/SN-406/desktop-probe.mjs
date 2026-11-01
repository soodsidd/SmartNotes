// SN-406 rework: where is the editor dictation mic at real desktop widths?
// Usage: node evidence/SN-406/desktop-probe.mjs <baseUrl> <tag>
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const [baseUrl, tag = "before"] = process.argv.slice(2);
const browser = await chromium.launch();
const out = [];
let notebookPath = null;
const ctx0 = await browser.newContext({ baseURL: baseUrl });
try {
  const nb = await (await ctx0.request.post("/api/notebook", { data: { name: `SN-406 desktop probe ${tag}` } })).json();
  notebookPath = nb.notebook.path;
  const tree = await (await ctx0.request.get("/api/vault")).json();
  const sectionPath = tree.tree.find((n) => n.path === notebookPath)?.sections?.[0]?.path ?? notebookPath;
  const pagePath = (await (await ctx0.request.post("/api/page", { data: { notebookPath, sectionPath, title: "Desktop probe" } })).json()).page.path;
  for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768], [800, 900], [390, 844], [360, 740]]) {
    const ctx = await browser.newContext({ baseURL: baseUrl, viewport: { width: w, height: h }, ...(w < 768 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
    await ctx.addInitScript(() => { new MutationObserver(() => { document.getElementById("__av_preview_banner")?.remove(); document.querySelector("[data-testid=sw-update-banner]")?.remove(); }).observe(document, { childList: true, subtree: true }); });
    const page = await ctx.newPage();
    await page.goto(`/?page=${encodeURIComponent(pagePath)}`, { waitUntil: "domcontentloaded" });
    await page.locator(".ProseMirror.editor-content").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), display: cs.display, visibility: cs.visibility, overflowX: cs.overflowX }; };
      const phone = innerWidth < 768;
      const bar = document.querySelector(phone ? '[data-testid="format-bar-mobile"]' : '[data-testid="format-bar"]');
      const mic = document.querySelector(phone ? '[data-testid="toolbar-dictate-mobile"]' : '[data-testid="toolbar-dictate"]');
      const plus = bar ? [...bar.children].at(-2 + (phone ? 0 : 1)) : null;
      const fab = document.querySelector('[data-testid="editor-dictation-fab"]');
      let hit = null;
      if (mic) { const b = mic.getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); hit = e ? (e.closest('[data-testid]')?.getAttribute('data-testid') ?? e.tagName) : null; }
      return { innerWidth, micLabel: mic?.innerText ?? null, plusRight: plus ? Math.round(plus.getBoundingClientRect().right) : null, bar: r(bar), barScroll: bar ? { scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth } : null, barParent: r(bar?.parentElement), mic: r(mic), micHitTest: hit, fab: r(fab), dictateCount: document.querySelectorAll('[aria-label="Dictate"]').length };
    });
    info.micVisible = await page.getByTestId(w < 768 ? "toolbar-dictate-mobile" : "toolbar-dictate").isVisible().catch(() => false);
    info.fabVisible = await page.getByTestId("editor-dictation-fab").isVisible().catch(() => false);
    out.push({ viewport: `${w}x${h}`, ...info });
    console.log(w, JSON.stringify(info));
    await page.screenshot({ path: path.join(dir, "desktop", `${tag}-${w}.png`) });
    await ctx.close();
  }
} finally {
  if (notebookPath) await ctx0.request.delete(`/api/notebook?path=${encodeURIComponent(notebookPath)}`).catch(() => {});
  writeFileSync(path.join(dir, "desktop", `${tag}-probe.json`), JSON.stringify(out, null, 2));
  await browser.close();
}
