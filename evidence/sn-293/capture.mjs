import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.SN293_PREVIEW_URL;
if (!base) throw new Error('Set SN293_PREVIEW_URL to the registered sidecar preview URL.');
const output = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, '$1:'));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
await page.goto(new URL('/?page=General%2FTopics%2FTest.html', base).toString(), { waitUntil: 'domcontentloaded' });
await page.getByText('Paper notes begin here.').waitFor({ timeout: 30000 });
await page.getByText('Connected / Idle').waitFor({ timeout: 30000 });
await page.getByTestId('toolbar-insert-menu').waitFor({ timeout: 30000 });
for (let attempt = 0; attempt < 3; attempt++) {
  await page.getByTestId('toolbar-insert-menu').click();
  try { await page.getByTestId('toolbar-attach-paper').waitFor({ timeout: 3000 }); break; }
  catch { if (attempt === 2) throw new Error('Insert menu did not stay open.'); }
}
await page.screenshot({ path: path.join(output, '02-insert-menu.png') });
if (!await page.getByTestId('toolbar-attach-paper').isVisible()) await page.getByTestId('toolbar-insert-menu').click();
await page.getByTestId('toolbar-attach-paper').click();
const dialog = page.getByTestId('attach-paper-dialog');
await dialog.waitFor();
await dialog.getByText('6 of 6 papers').waitFor();
await page.screenshot({ path: path.join(output, '03-attach-paper.png') });
await dialog.getByRole('button', { name: 'Create a paper' }).click();
await dialog.getByLabel('Title', { exact: true }).waitFor();
await dialog.locator('form').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(output, '04-create-paper.png') });
const grid = dialog.locator('[data-testid^="attach-paper-card-"]');
const form = dialog.locator('form');
const last = await grid.last().boundingBox();
const expanded = await form.boundingBox();
const count = await grid.count();
if (!last || !expanded || expanded.y < last.y + last.height) {
  errors.push('Expanded Create a paper form overlaps the card grid.');
}
await fs.writeFile(path.join(output, 'console.txt'), errors.length ? errors.join('\n') + '\n' : 'No page or console errors.\n');
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Captured menu, dialog and expanded form; ${count} cards; zero console errors.`);
