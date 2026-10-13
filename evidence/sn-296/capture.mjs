// Isolated desktop evidence for fork photos #11 and #16.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.SN296_PREVIEW_URL;
if (!base) throw new Error("Set SN296_PREVIEW_URL to the worktree-local preview URL.");
const output = path.dirname(fileURLToPath(import.meta.url));
const paperPath = ".bibliography/5d0c2b8e-4f1a-4c3e-9a77-2e1f0b6d9c41.html";
const checks = [];
const check = (ok, label) => checks.push(`${ok ? "PASS" : "FAIL"} ${label}`);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

const open = async (pagePath) => {
  await page.goto(new URL(`/?page=${encodeURIComponent(pagePath)}`, base).toString(), { waitUntil: "domcontentloaded" });
  await page.getByTestId("floating-text-box").waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
};

await open("General/Precision Engineering/Test.html");
let box = page.getByTestId("floating-text-box");
check(await box.getAttribute("data-width") === "360" && await box.getAttribute("data-height") === "48", "photo #11 empty box has the 360 × 48 default geometry");
check((await box.getByTestId("floating-text-box-move").innerText()) === "Move" && (await box.getByTestId("floating-text-box-delete").innerText()) === "Delete", "photo #11 controls read Move and Delete");
check(await box.getByTestId("floating-text-box-resize").isVisible(), "photo #11 resize handle is visible");
await box.locator("p").first().click();
check(await page.evaluate(() => !!document.getSelection()?.anchorNode?.parentElement?.closest('[data-type="floating-text-box"]')), "photo #11 caret can focus inside the box");
await page.screenshot({ path: path.join(output, "11-empty-box.png") });

await open(paperPath);
box = page.getByTestId("floating-text-box");
check(await box.locator("table tr").count() === 3 && await box.locator("table td").count() === 9, "photo #16 box contains a 3 × 3 table");
check(await box.getByTestId("floating-text-box-move").getAttribute("title") === "Drag to move; arrow keys to nudge", "Move tooltip matches photo #16");
check(await page.getByText("Bibliography · shared paper page").isVisible(), "photo #16 paper context bar is visible");
await box.locator("table td").first().click();
check(await page.evaluate(() => !!document.getSelection()?.anchorNode?.parentElement?.closest('[data-type="floating-text-box"] table')), "photo #16 table cell receives the editor selection");
await box.getByTestId("floating-text-box-move").hover();
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(output, "16-table-box.png") });
check(errors.length === 0, `zero page or console errors (${errors.length})`);

await fs.writeFile(path.join(output, "console.txt"), [...checks, "", "Console errors:", ...(errors.length ? errors : ["(none)"])].join("\n") + "\n");
console.log(checks.join("\n"));
if (errors.length) console.log(errors.join("\n"));
await browser.close();
process.exit(checks.some((line) => line.startsWith("FAIL")) ? 1 : 0);
