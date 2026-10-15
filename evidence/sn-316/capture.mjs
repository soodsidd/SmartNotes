// SN-316 desktop evidence: width-only resize reflows text, height follows content,
// and a resized embedded image grows the box. Run against a fixture-vault preview.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.SN316_PREVIEW_URL;
if (!base) throw new Error("Set SN316_PREVIEW_URL to the worktree-local fixture preview URL.");
const output = path.dirname(fileURLToPath(import.meta.url));
const checks = [];
const check = (ok, label) => checks.push(`${ok ? "PASS" : "FAIL"} ${label}`);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(new URL(`/?page=${encodeURIComponent("General/Resize.html")}`, base).toString(), { waitUntil: "domcontentloaded" });
const box = page.getByTestId("floating-text-box");
await box.waitFor({ timeout: 120000 });
await box.locator("img").waitFor({ state: "visible", timeout: 30000 });
await page.waitForTimeout(800);
const measure = () => box.evaluate((el) => {
  const p = el.querySelector("p");
  const lineHeight = parseFloat(getComputedStyle(p).lineHeight) || 24;
  const content = el.querySelector(".floating-text-box__content").getBoundingClientRect();
  const img = el.querySelector("img").getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  return {
    width: Number(el.dataset.width), height: Number(el.dataset.height),
    boxH: rect.height, boxBottom: rect.bottom, boxRight: rect.right,
    lines: Math.round(p.getBoundingClientRect().height / lineHeight),
    contentBottom: content.bottom, imgRight: img.right, imgBottom: img.bottom, imgW: img.width,
  };
});
// Select the box so the controls show.
await box.locator("p").first().click();
const before = await measure();
await page.screenshot({ path: path.join(output, "01-before.png") });
check(before.width === 240, `starts at stored width 240 (${before.width})`);

const handle = box.getByTestId("floating-text-box-resize-width");
check(await handle.isVisible(), "right-edge width handle is visible");
const hb = await handle.boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + 40, { steps: 4 });
const mid = await measure();
check(mid.width === 360 && mid.lines < before.lines, `mid-drag: width 360, text already rewrapped ${before.lines}→${mid.lines} lines`);
await page.mouse.move(hb.x + hb.width / 2 + 260, hb.y + 90, { steps: 4 });
await page.mouse.up();
const wide = await measure();
check(wide.width === 500 && wide.height === before.height, `width-only: width 500, stored min-height unchanged (${wide.height})`);
check(wide.lines <= mid.lines && wide.lines < before.lines, `text reflows ${before.lines}→${wide.lines} lines at 500px`);
check(wide.boxBottom >= wide.contentBottom && wide.boxH < before.boxH, `height auto-fits shorter content (${Math.round(before.boxH)}→${Math.round(wide.boxH)}px)`);
await page.screenshot({ path: path.join(output, "02-width-resized-wrapped.png") });

// Resize the embedded image wider than the box via its own bottom-right handle.
await box.locator("img").click();
const imageHandle = box.locator('[data-resize-handle="bottom-right"]');
await imageHandle.waitFor({ state: "visible", timeout: 5000 });
const ib = await imageHandle.boundingBox();
await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
await page.mouse.down();
await page.mouse.move(ib.x + ib.width / 2 + 360, ib.y + 360, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
check(await page.getByTestId("floating-text-box").count() === 1, "releasing the image drag on the canvas does not create a stray box");
const grown = await measure();
check(grown.imgW > 480, `image resized to ${Math.round(grown.imgW)}px (wider than the old 500px box)`);
check(grown.width > 500 && grown.boxRight >= grown.imgRight, `box widened to ${grown.width} so the image is fully inside`);
check(grown.boxBottom >= grown.imgBottom, `box grew to ${Math.round(grown.boxH)}px tall; image bottom not clipped`);
await page.getByText("Main flow", { exact: true }).click();
await page.waitForTimeout(300);
await box.locator("p").first().click();
await page.screenshot({ path: path.join(output, "03-image-expanded.png") });

// Persisted geometry survives reload (wait for the 1.2s autosave to land on disk).
const pageFile = path.resolve(output, "../../.e2e-vault-sn316/General/Resize.html");
for (let i = 0; i < 40 && !(await fs.readFile(pageFile, "utf8")).includes(`data-width="${grown.width}"`); i++) await page.waitForTimeout(250);
await page.reload({ waitUntil: "domcontentloaded" });
await box.waitFor({ timeout: 60000 });
await box.locator("img").waitFor({ state: "visible" });
await page.waitForTimeout(800);
const reloaded = await measure();
check(reloaded.width === grown.width && reloaded.boxRight >= reloaded.imgRight, `reload keeps width ${reloaded.width} and contained image`);
check(errors.length === 0, `zero page or console errors (${errors.length})`);

await fs.writeFile(path.join(output, "console.txt"), [...checks, "", "Console errors:", ...(errors.length ? errors : ["(none)"])].join("\n") + "\n");
console.log(checks.join("\n"));
if (errors.length) console.log(errors.join("\n"));
await browser.close();
process.exit(checks.some((line) => line.startsWith("FAIL")) ? 1 : 0);
