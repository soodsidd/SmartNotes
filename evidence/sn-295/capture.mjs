// SN-295 evidence: paper PDF + notes split (#8) and Companion overlay (#9).
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.SN295_PREVIEW_URL;
if (!base) throw new Error('Set SN295_PREVIEW_URL to the isolated preview URL.');
const output = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, '$1:'));
const paperPath = '.bibliography/5d0c2b8e-4f1a-4c3e-9a77-2e1f0b6d9c41.html';
const results = [];
const check = (ok, label) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const box = async (locator) => {
  const b = await locator.boundingBox();
  return b && { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

await page.goto(new URL(`/?page=${encodeURIComponent(paperPath)}`, base).toString(), { waitUntil: 'domcontentloaded' });
await page.getByTestId('paper-ownership').waitFor({ timeout: 90000 });
await page.locator('[data-file-type="pdf"]').first().click();
const reader = page.getByTestId('pdf-reader');
await reader.waitFor({ timeout: 60000 });
await page.getByTestId('pdf-reader-page-total').filter({ hasText: '/ 3' }).waitFor({ timeout: 60000 });
const dock = page.getByTestId('paper-notes-dock');
await dock.waitFor({ timeout: 60000 });
await page.frameLocator('[data-testid="paper-notes-frame"]').getByText('Paper notes for the split reader.').waitFor({ timeout: 60000 });

// Photo #8: top bar, PDF reader left, notes with the full editor toolbar right.
const topbar = page.getByTestId('paper-reading-topbar');
check((await topbar.innerText()).replace(/\s+/g, ' ').trim() === 'Back to topic Companion', 'top bar reads "Back to topic · Companion"');
check(await page.frameLocator('[data-testid="paper-notes-frame"]').getByTestId('toolbar-bold').isVisible(), 'notes pane shows the editor toolbar');
let readerBox = await box(reader);
let dockBox = await box(dock);
check(readerBox.x + readerBox.width === dockBox.x, 'PDF frame abuts the notes pane');
await page.mouse.move(0, 0);
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(output, '08-split.png') });

// Splitter: drag sets the width, and the width is remembered across reload.
await page.mouse.move(dockBox.x, dockBox.y + 300);
await page.mouse.down();
await page.mouse.move(dockBox.x - 120, dockBox.y + 300, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const stored = await page.evaluate(() => window.localStorage.getItem('smart-notes-paper-notes-width'));
check(stored === String(dockBox.width + 120), `drag stores the splitter width (${stored})`);
readerBox = await box(reader);
dockBox = await box(dock);
check(dockBox.width === Number(stored) && readerBox.x + readerBox.width === dockBox.x, 'PDF frame and notes follow the splitter');

// Photo #9: Companion overlays the notes on the right without moving the PDF.
await page.getByTestId('paper-reading-companion').click();
const rail = page.getByTestId('pdf-reader-ai-sidebar');
await rail.waitFor({ timeout: 60000 });
await page.waitForTimeout(600);
check(JSON.stringify(await box(reader)) === JSON.stringify(readerBox), 'PDF frame is not resized or displaced by Companion');
const railBox = await box(rail);
check(railBox.x <= dockBox.x && railBox.x + railBox.width === 1440, 'Companion covers the notes pane on the right');
const railText = (await rail.innerText()).replace(/\s+/g, ' ');
check(railText.includes('Smart Notes AI') && railText.includes('Discussing · deviation'), 'header reads Smart Notes AI / Discussing · deviation');
check((await page.getByTestId('paper-companion-pdf-context').innerText()).includes('PDF: Catalogue(Final).pdf'), 'context pill reads PDF: Catalogue(Final).pdf');
await page.mouse.move(0, 0);
await page.screenshot({ path: path.join(output, '09-companion-overlay.png') });

// Companion closes back to the plain split.
await page.getByTestId('paper-reading-companion').click();
await rail.waitFor({ state: 'hidden', timeout: 10000 });
check(JSON.stringify(await box(dock)) === JSON.stringify(dockBox) && JSON.stringify(await box(reader)) === JSON.stringify(readerBox), 'closing Companion restores the plain split');
await page.screenshot({ path: path.join(output, '09-closed-back-to-split.png') });

// Width remembered after reload.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByTestId('paper-ownership').waitFor({ timeout: 90000 });
// The reader session resumes on reload; only reopen from the chip if it did not.
await page.waitForTimeout(1500);
if (!(await reader.isVisible())) await page.locator('[data-file-type="pdf"]').first().click();
await dock.waitFor({ timeout: 60000 });
await page.waitForTimeout(500);
check((await box(dock)).width === Number(stored), 'splitter width is remembered after reload');

check(errors.length === 0, `zero console errors (${errors.length})`);
await fs.writeFile(path.join(output, 'console.txt'), [...results, '', 'Console errors:', ...(errors.length ? errors : ['(none)'])].join('\n') + '\n');
console.log(results.join('\n'));
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
