import { chromium } from 'playwright';

for (const [label, w, h] of [['desktop', 1280, 900], ['mobile', 375, 812]]) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3002/', { waitUntil: 'commit', timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log(label + ':', errors.length ? 'ERRORS:\n  ' + errors.join('\n  ') : '0 console errors ✓');
  await browser.close();
}
