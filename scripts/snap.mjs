import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const base = 'http://localhost:3002';
const outDir = 'evidence/SN-2';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();

async function snap(name, url, width, height, setup) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  if (setup) await setup(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
  await ctx.close();
  console.log('✓', name);
}

// Click a visible button containing text
async function clickVisible(page, text, timeout = 5000) {
  const btn = page.locator(`button:visible`).filter({ hasText: text }).first();
  await btn.click({ timeout });
}

// ── Desktop ──────────────────────────────────────────────────────────────────

await snap('01-desktop-light', base, 1280, 900);

await snap('02-desktop-dark', base, 1280, 900, async (p) => {
  await p.click('button[aria-label="Switch to dark mode"]');
  await p.waitForTimeout(300);
});

await snap('03-desktop-search', base, 1280, 900, async (p) => {
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(400);
});

await snap('04-desktop-capture', base, 1280, 900, async (p) => {
  await p.keyboard.press('Control+Shift+v');
  await p.waitForTimeout(400);
});

await snap('05-desktop-settings', base, 1280, 900, async (p) => {
  await p.click('button[aria-label="Settings"]');
  await p.waitForTimeout(400);
});

// ── Mobile ───────────────────────────────────────────────────────────────────

await snap('06-mobile-notebooks', base, 375, 812);

// Mobile sections view — tap "Work" notebook row
await snap('07-mobile-sections', base, 375, 812, async (p) => {
  await clickVisible(p, 'Work');
  await p.waitForTimeout(300);
});

// Mobile pages view — tap first section
await snap('08-mobile-pages', base, 375, 812, async (p) => {
  await clickVisible(p, 'Work');
  await p.waitForTimeout(250);
  await clickVisible(p, 'Projects');
  await p.waitForTimeout(300);
});

// Mobile page view — tap first page
await snap('09-mobile-page-view', base, 375, 812, async (p) => {
  await clickVisible(p, 'Work');
  await p.waitForTimeout(200);
  await clickVisible(p, 'Projects');
  await p.waitForTimeout(200);
  await clickVisible(p, 'Smart Notes Design System');
  await p.waitForTimeout(350);
});

// Mobile AI sheet
await snap('10-mobile-ai-sheet', base, 375, 812, async (p) => {
  await clickVisible(p, 'Work');
  await p.waitForTimeout(200);
  await clickVisible(p, 'Projects');
  await p.waitForTimeout(200);
  await clickVisible(p, 'Smart Notes Design System');
  await p.waitForTimeout(250);
  const fab = p.locator('button[aria-label="Open AI"]');
  if (await fab.count()) {
    await fab.click({ timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(400);
  }
});

// Mobile dark
await snap('11-mobile-dark', base, 375, 812, async (p) => {
  await p.click('button[aria-label="Switch to dark mode"]');
  await p.waitForTimeout(300);
});

await browser.close();
console.log('\nAll screenshots saved to', outDir);
