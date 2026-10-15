// SN-318 desktop evidence: width-only resize of the main editor flow column with
// live reflow, per-page persistence, and the empty-canvas hit test following the width.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.SN318_PREVIEW_URL;
if (!base) throw new Error("Set SN318_PREVIEW_URL to the worktree-local fixture preview URL.");
const output = path.dirname(fileURLToPath(import.meta.url));
const pageFile = path.resolve(output, "../../.e2e-vault-sn318/General/Column.html");
const checks = [];
const check = (ok, label) => checks.push(`${ok ? "PASS" : "FAIL"} ${label}`);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

const open = async () => {
  await page.goto(new URL(`/?page=${encodeURIComponent("General/Column.html")}`, base).toString(), { waitUntil: "domcontentloaded" });
  await page.getByTestId("editor-main-flow-resize").waitFor({ timeout: 180000 });
  await page.locator(".editor-content img").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(800);
};
const measure = () => page.evaluate(() => {
  const frame = document.querySelector('[data-testid="editor-content-frame"]');
  const outline = document.querySelector('[data-testid="editor-main-flow-outline"]').getBoundingClientRect();
  const pm = document.querySelector(".editor-content.ProseMirror");
  const lead = pm.querySelector("p");
  const lineHeight = parseFloat(getComputedStyle(lead).lineHeight) || 24;
  const flow = Array.from(pm.children).filter((child) => !child.matches('[data-type="floating-text-box"]'));
  const img = pm.querySelector("img").getBoundingClientRect();
  const handle = document.querySelector('[data-testid="editor-main-flow-resize"]');
  return {
    cssWidth: frame.style.getPropertyValue("--editor-main-flow-width"),
    outlineW: Math.round(outline.width), outlineRight: outline.right, outlineBottom: outline.bottom,
    leadW: Math.round(lead.getBoundingClientRect().width),
    leadLines: Math.round(lead.getBoundingClientRect().height / lineHeight),
    flowBottom: Math.max(...flow.map((child) => child.getBoundingClientRect().bottom)),
    flowRight: Math.max(...flow.map((child) => child.getBoundingClientRect().right)),
    imgW: Math.round(img.width), imgRight: img.right,
    handleNow: Number(handle.getAttribute("aria-valuenow")),
    boxes: pm.querySelectorAll('[data-type="floating-text-box"]').length,
    pmLeft: pm.getBoundingClientRect().left,
  };
});
const waitForFile = async (predicate) => {
  for (let i = 0; i < 60; i++) {
    if (predicate(await fs.readFile(pageFile, "utf8"))) return true;
    await page.waitForTimeout(250);
  }
  return false;
};

await open();
const before = await measure();
check(before.cssWidth === "672px" && before.handleNow === 672, `opens at the default 672px column (${before.cssWidth})`);
check(before.flowRight <= before.outlineRight + 1, `prose stays inside the outline (${Math.round(before.flowRight)} <= ${Math.round(before.outlineRight)})`);
await page.screenshot({ path: path.join(output, "01-default-672.png") });

// Drag the right edge 240px left.
const handle = page.getByTestId("editor-main-flow-resize");
const grip = handle.locator(".editor-main-flow-resize__grip");
check(await grip.isVisible(), "right-edge width grip is visible");
let gb = await grip.boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.down();
await page.mouse.move(gb.x + gb.width / 2 - 120, gb.y + 30, { steps: 4 });
const mid = await measure();
check(mid.cssWidth === "552px" && mid.leadW === 552 && mid.leadW < before.leadW,
  `mid-drag: column 552px, prose already reflowed ${before.leadW}→${mid.leadW}px wide`);
await page.mouse.move(gb.x + gb.width / 2 - 240, gb.y + 60, { steps: 4 });
await page.mouse.up();
const narrow = await measure();
check(narrow.cssWidth === "432px" && narrow.outlineW < before.outlineW, `width-only: column 432px, outline ${before.outlineW}→${narrow.outlineW}px`);
check(narrow.leadLines > before.leadLines, `prose rewraps ${before.leadLines}→${narrow.leadLines} lines at 432px`);
check(narrow.imgW <= 432 && narrow.imgRight <= narrow.outlineRight + 1, `image reflows to fit the column (${narrow.imgW}px)`);
check(narrow.outlineBottom >= narrow.flowBottom, `height follows content: outline bottom ${Math.round(narrow.outlineBottom)} >= text ${Math.round(narrow.flowBottom)}`);
check(narrow.boxes === 1, "drag release does not create a stray floating box");
check(await waitForFile((source) => /^main_flow_width: 432$/m.test(source)), "narrowed width persisted to page frontmatter");
await page.screenshot({ path: path.join(output, "02-narrowed-432.png") });

// Keyboard: Shift+ArrowRight ×4 (+192px), then one ArrowRight (+8px).
await handle.focus();
for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
await page.keyboard.press("ArrowRight");
const keyed = await measure();
check(keyed.cssWidth === "632px" && keyed.handleNow === 632, `keyboard adjusts width live (${keyed.cssWidth})`);
check(await waitForFile((source) => /^main_flow_width: 632$/m.test(source)), "keyboard burst persisted once paused");

// Drag wide.
gb = await grip.boundingBox();
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.down();
await page.mouse.move(gb.x + gb.width / 2 + 328, gb.y, { steps: 6 });
await page.mouse.up();
const wide = await measure();
check(wide.cssWidth === "960px" && wide.leadLines < before.leadLines, `widened to 960px; prose ${before.leadLines}→${wide.leadLines} lines`);
check(await waitForFile((source) => /^main_flow_width: 960$/m.test(source)), "widened width persisted to page frontmatter");
await page.locator(".editor-content.ProseMirror > p").nth(1).click();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(output, "03-widened-960.png") });

// Empty-canvas create zone follows the dynamic width.
const shortLine = await page.locator(".editor-content.ProseMirror > p").nth(1).boundingBox();
await page.mouse.click(wide.pmLeft + 900, shortLine.y + shortLine.height / 2);
await page.waitForTimeout(300);
check((await measure()).boxes === 1, "click inside the widened column (old canvas zone) does not create a box");
await page.mouse.click(wide.pmLeft + 980, 860);
await page.waitForTimeout(300);
check((await measure()).boxes === 2, "click on empty canvas below/right of the column still creates a box");
await page.locator(".editor-content.ProseMirror > p").first().click();
await page.waitForTimeout(400);
check((await measure()).boxes === 1, "empty created box is pruned when the caret leaves");

// Restore on reopen.
await page.reload({ waitUntil: "domcontentloaded" });
await open();
const reopened = await measure();
check(reopened.cssWidth === "960px" && reopened.outlineW === wide.outlineW && reopened.leadLines === wide.leadLines,
  `reload restores the 960px column and wrapping (${reopened.cssWidth}, ${reopened.leadLines} lines)`);
const source = await fs.readFile(pageFile, "utf8");
check(!source.includes("data-main-flow") && !source.includes("main_flow_width", source.indexOf("\n---\n") + 5),
  "width lives only in frontmatter, never in the HTML body");

// Workspace zoom: the drag converts screen px to layout px.
await page.locator(".editor-content.ProseMirror > p").first().click();
const lead = await page.locator(".editor-content.ProseMirror > p").first().boundingBox();
await page.mouse.move(lead.x + 40, lead.y + 10);
await page.keyboard.down("Control");
await page.mouse.wheel(0, -100);
await page.keyboard.up("Control");
await page.waitForTimeout(400);
const zoom = await page.getByTestId("editor-content-frame").getAttribute("data-editor-zoom");
if (zoom) {
  gb = await grip.boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2 - 100 * Number(zoom), gb.y, { steps: 4 });
  await page.mouse.up();
  const zoomed = await measure();
  check(zoomed.cssWidth === "860px", `at ${zoom}× zoom a ${Math.round(100 * Number(zoom))}px drag narrows by 100 layout px (${zoomed.cssWidth})`);
} else {
  checks.push("SKIP workspace zoom shortcut not available in this layout");
}
check(errors.length === 0, `zero page or console errors (${errors.length})`);

await fs.writeFile(path.join(output, "console.txt"), [...checks, "", "Console errors:", ...(errors.length ? errors : ["(none)"])].join("\n") + "\n");
console.log(checks.join("\n"));
if (errors.length) console.log(errors.join("\n"));
await browser.close();
process.exit(checks.some((line) => line.startsWith("FAIL")) ? 1 : 0);
