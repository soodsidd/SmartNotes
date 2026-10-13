// SN-294 evidence: chip (#5), expanded panel (#6), live edit + shared refresh + save safety.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.SN294_PREVIEW_URL;
if (!base) throw new Error('Set SN294_PREVIEW_URL to the isolated preview URL.');
const output = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, '$1:'));
const vault = path.resolve(output, '..', '..', '.e2e-vault');
const paperId = '5d0c2b8e-4f1a-4c3e-9a77-2e1f0b6d9c41';
const paperFile = path.join(vault, '.bibliography', `${paperId}.html`);
const testFile = path.join(vault, 'General', 'Precision Engineering', 'Test.html');
const otherFile = path.join(vault, 'General', 'Metrology', 'Other reference.html');
const results = [];
const check = (ok, label) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${label}`); };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
const open = async (pagePath) => {
  await page.goto(new URL(`/?page=${encodeURIComponent(pagePath)}`, base).toString(), { waitUntil: 'domcontentloaded' });
  await page.getByText('Connected / Idle').waitFor({ timeout: 60000 });
  await page.locator('.paper-reference').getByRole('button', { name: 'deviation', exact: true }).waitFor({ timeout: 30000 });
};
const panel = () => page.getByTestId('inline-paper-notes');
const expand = async () => {
  await page.getByRole('button', { name: /^Expand paper deviation/ }).click();
  await panel().getByText('Shared paper notes · read-only').waitFor();
  await panel().getByText('cat--interferoMETER--en-us.pdf').waitFor();
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('[data-testid="inline-paper-notes"] button')].find((x) => x.textContent === 'Edit'); return b && !b.disabled; });
};

const testBefore = await fs.readFile(testFile, 'utf8');
const otherBefore = await fs.readFile(otherFile, 'utf8');

// Photo #5: collapsed chip.
await open('General/Precision Engineering/Test.html');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(output, '05-chip.png') });

// Photo #6: expanded read-only panel.
await expand();
check(await panel().locator('[contenteditable="true"]').count() === 0, 'expanded panel is read-only before Edit');
await page.mouse.move(0, 0);
await page.screenshot({ path: path.join(output, '06-expanded.png') });

// Live edit: Edit -> type -> verified autosave to the canonical paper.
await panel().getByRole('button', { name: 'Edit', exact: true }).click();
const prose = panel().locator('.ProseMirror[contenteditable="true"]');
await prose.waitFor();
await prose.click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
const saved = page.waitForResponse((r) => r.url().includes('/api/page') && r.request().method() === 'PUT', { timeout: 15000 });
await page.keyboard.type('Inline edit SN-294');
const put = await saved;
check(put.status() === 200 && JSON.parse(put.request().postData() ?? '{}').expectedPaperRevision?.startsWith('sha256:'), 'autosave sends a conditional PUT with the loaded revision');
await page.waitForFunction(() => !document.querySelector('[data-testid="inline-paper-notes"]')?.textContent?.includes('Saving…'));
await page.waitForTimeout(1500);
check((await fs.readFile(paperFile, 'utf8')).includes('Inline edit SN-294'), 'canonical paper file holds the inline edit');
check(await fs.readFile(testFile, 'utf8') === testBefore, 'referring page file is byte-identical after the inline edit');
await page.screenshot({ path: path.join(output, '06-editing-saved.png') });

// Collapse restores the plain chip.
await panel().getByRole('button', { name: 'Collapse', exact: true }).click();
await panel().waitFor({ state: 'detached' });
check(await page.getByRole('button', { name: /^Expand paper deviation/ }).isVisible(), 'Collapse restores the plain chip');

// Every other reference reflects the edit after reopen and Refresh.
await open('General/Metrology/Other reference.html');
await expand();
await panel().getByText('Inline edit SN-294').waitFor({ timeout: 10000 });
check(true, 'second referring page shows the edit on reopen');
await fs.writeFile(paperFile, (await fs.readFile(paperFile, 'utf8')).replace('Inline edit SN-294', 'Edited elsewhere'));
await panel().getByRole('button', { name: 'Refresh', exact: true }).click();
await panel().getByText('Edited elsewhere').waitFor({ timeout: 10000 });
check(true, 'Refresh fetches the current canonical body');
await page.screenshot({ path: path.join(output, '06-other-reference-refresh.png') });

// Stale editor: paper changes elsewhere while this panel edits -> conflict, no overwrite.
await panel().getByRole('button', { name: 'Edit', exact: true }).click();
const external = (await fs.readFile(paperFile, 'utf8')).replace('Edited elsewhere', 'Newer external content');
await fs.writeFile(paperFile, external);
const stalePut = page.waitForResponse((r) => r.url().includes('/api/page') && r.request().method() === 'PUT', { timeout: 15000 });
await panel().locator('.ProseMirror[contenteditable="true"]').click();
await page.keyboard.press('Control+End');
await page.keyboard.type(' stale');
check((await stalePut).status() === 409, 'stale inline save is rejected with 409');
await page.getByRole('alert').filter({ hasText: /changed elsewhere/i }).waitFor();
await page.waitForTimeout(2500); // autosave must not retry after the conflict
check(await fs.readFile(paperFile, 'utf8') === external, 'paper keeps the newer content (no stale overwrite)');
check(await fs.readFile(otherFile, 'utf8') === otherBefore, 'second referring page file is byte-identical');
await page.screenshot({ path: path.join(output, '06-stale-conflict.png') });
await panel().getByRole('button', { name: 'Cancel', exact: true }).click();
errors.splice(0, errors.length, ...errors.filter((e) => !/409 \(Conflict\)/.test(e))); // the expected conflict response

// Second reference, after Refresh: a fresh edit persists to the paper and shows at the first reference.
await panel().getByRole('button', { name: 'Refresh', exact: true }).click();
await panel().getByText('Newer external content').waitFor({ timeout: 10000 });
await panel().getByRole('button', { name: 'Edit', exact: true }).click();
await panel().locator('.ProseMirror[contenteditable="true"]').click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
const secondPut = page.waitForResponse((r) => r.url().includes('/api/page') && r.request().method() === 'PUT', { timeout: 15000 });
await page.keyboard.type('Second reference edit');
check((await secondPut).status() === 200, 'second reference edit after Refresh saves (200)');
await page.waitForFunction(() => !document.querySelector('[data-testid="inline-paper-notes"]')?.textContent?.includes('Saving…'));
await page.waitForTimeout(1500);
const afterSecond = await fs.readFile(paperFile, 'utf8');
check(afterSecond.includes('Second reference edit') && afterSecond.includes('Newer external content'), 'canonical paper holds the second reference edit and keeps prior content');
check(await fs.readFile(otherFile, 'utf8') === otherBefore, 'second referring page file is byte-identical after its inline edit');
await page.screenshot({ path: path.join(output, '06-second-reference-saved.png') });
await panel().getByRole('button', { name: 'Collapse', exact: true }).click();
await panel().waitFor({ state: 'detached' });
await open('General/Precision Engineering/Test.html');
await expand();
await panel().getByText('Second reference edit').waitFor({ timeout: 10000 });
check(true, 'first referring page shows the second reference edit on reopen');
check(await fs.readFile(testFile, 'utf8') === testBefore, 'first referring page file is still byte-identical');
await panel().getByRole('button', { name: 'Collapse', exact: true }).click();
await panel().waitFor({ state: 'detached' });

// Clicking the chip title opens the full paper page.
await page.locator('.paper-reference').getByRole('button', { name: 'deviation', exact: true }).click();
await page.getByText('Bibliography · shared paper page').waitFor({ timeout: 15000 });
await page.screenshot({ path: path.join(output, 'title-opens-full-paper.png') });
check(true, 'chip title opens the full paper page');

await browser.close();
const summary = [...results, errors.length ? errors.join('\n') : 'No page or console errors.'].join('\n') + '\n';
await fs.writeFile(path.join(output, 'console.txt'), summary);
console.log(summary);
if (errors.length || results.some((r) => r.startsWith('FAIL'))) process.exit(1);
