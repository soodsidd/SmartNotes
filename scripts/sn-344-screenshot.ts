/**
 * SN-344: One-shot screenshot evidence script.
 * Deep-links to the pre-filled page and captures the floating text box with tall content.
 * Run: npx tsx scripts/sn-344-screenshot.ts
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs/promises";

const PREVIEW_URL = process.env.SMART_NOTES_E2E_PREVIEW_URL || "http://127.0.0.1:65393";
const PAGE_PATH = "SN344 Evidence/Height Test/floating-box-evidence-2.html";
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "..", "evidence", "SN-344");

async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 900 } });
  const page = await ctx.newPage();

  // Deep-link directly to the target page
  const url = `${PREVIEW_URL}/?page=${encodeURIComponent(PAGE_PATH)}`;
  console.log(`Navigating to ${url}`);
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });
  console.log("App shell visible");

  // Wait for the editor and ResizeObserver height fitting
  await page.waitForSelector('[data-testid="rich-text-editor"]', { timeout: 20000 });
  console.log("Editor visible");
  await page.waitForTimeout(2500);

  // Report floating box bounds
  const floatingBox = page.locator('[data-type="floating-text-box"]').first();
  if (await floatingBox.isVisible().catch(() => false)) {
    const boxBounds = await floatingBox.boundingBox();
    console.log(`Floating box bounds: ${JSON.stringify(boxBounds)}`);
  } else {
    console.log("WARNING: floating box not visible");
  }

  const screenshotPath = path.join(EVIDENCE_DIR, "sn-344-floating-box-tall.png");
  await page.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
