// SN-362 manual walkthrough (Fast, Slow, Edit) against a running preview. Usage: node e2e/evidence/SN-362/walkthrough.cjs (set base below).
const { chromium } = require('../../../node_modules/@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const base = 'http://127.0.0.1:60090';
const evidence = __dirname;
const captured = [];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, isMobile: true, hasTouch: true });
  let notePath = '';
  try {
    const created = await page.request.post(`${base}/api/agent/vault`, { data: {
      tool: 'page_create', args: { sectionPath: 'Personal Notebook/Quick Notes',
        title: `SN-362 walkthrough ${Date.now()}`,
        content: '<p>Before the selected phrase after.</p>' },
    } });
    if (!created.ok()) throw new Error(`Create: ${created.status()} ${await created.text()}`);
    const data = await created.json();
    notePath = data.result?.data?.page?.path;
    if (!notePath) throw new Error(`No page path: ${JSON.stringify(data)}`);
    await page.route('**/api/chat/send', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      captured.push(body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turn_id: body.turn_id }) });
      setTimeout(() => void page.evaluate(({ turnId, answer }) => {
        const bridge = window.__testChatBridge;
        bridge?.injectChatEvent({ turn_id: turnId, seq: 0, type: 'token', payload: { text: answer.slice(0, 8) } });
        bridge?.injectChatEvent({ turn_id: turnId, seq: 1, type: 'token', payload: { text: answer.slice(8) } });
        bridge?.injectChatEvent({ turn_id: turnId, seq: 2, type: 'done', payload: { status: 'completed' } });
      }, { turnId: body.turn_id, answer: captured.length === 3 ? 'replacement' : `Answer ${captured.length}` }).catch(console.error), 300);
    });
    for (let attempt = 1; ; attempt++) {
      await page.goto(`${base}/?page=${encodeURIComponent(notePath)}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      try { await page.getByTestId('rich-text-editor').getByText('Before the selected phrase after.').waitFor({ timeout: 45000 }); break; }
      catch (error) { if (attempt >= 4) throw error; console.log('Reload attempt', attempt); }
    }
    fs.mkdirSync(evidence, { recursive: true });
    await page.addStyleTag({ content: '#__av_preview_banner { display: none !important; }' });
    async function openSelection() {
      const prose = page.locator('.ProseMirror').first();
      const paragraph = prose.locator('p').filter({ hasText: 'Before the selected phrase after.' });
      await paragraph.selectText();
      console.log('Browser selection:', await page.evaluate(() => window.getSelection()?.toString()));
      if (await page.getByTestId('bubble-ask-companion').isVisible().catch(() => false)) {
        await page.getByTestId('bubble-ask-companion').click();
      } else {
        await paragraph.evaluate(node => node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 150 })));
        await page.getByTestId('editor-context-menu').getByTestId('ctx-ask-companion').click();
      }
      await page.getByTestId('ask-companion-popover').waitFor();
    }
    await openSelection();
    const popup = page.getByTestId('ask-companion-popover');
    console.log('Fast default:', await popup.getByRole('button', { name: 'Fast' }).getAttribute('aria-pressed'));
    await popup.getByRole('button', { name: 'Explain' }).click();
    await popup.getByRole('button', { name: 'Ask', exact: true }).click();
    await popup.getByText('Answer 1').waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(evidence, 'fast.png') });
    await popup.getByRole('button', { name: 'Open in Companion →' }).click();
    const sidebar = page.getByTestId('mobile-ai-sheet');
    await sidebar.getByText('Answer 1').waitFor({ timeout: 120000 });
    console.log('Fast sidebar answer visible in shared transcript:', await sidebar.getByText('Answer 1').isVisible());
    await page.screenshot({ path: path.join(evidence, 'fast-sidebar.png') });
    await sidebar.getByRole('button', { name: 'Close Companion' }).first().click();
    await openSelection();
    await popup.getByRole('button', { name: 'Slow' }).click();
    await popup.getByRole('button', { name: 'Summarize' }).click();
    await popup.getByRole('button', { name: 'Ask', exact: true }).click();
    await popup.getByText('Answer 2').waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(evidence, 'slow.png') });
    await popup.getByRole('button', { name: 'Open in Companion →' }).click();
    await sidebar.getByText('Answer 2').waitFor({ timeout: 120000 });
    console.log('Fast+Slow answers in ONE sidebar transcript:', await sidebar.getByText('Answer 1').isVisible(), await sidebar.getByText('Answer 2').isVisible());
    await page.screenshot({ path: path.join(evidence, 'slow-sidebar.png') });
    await sidebar.getByRole('button', { name: 'Close Companion' }).first().click();
    await openSelection();
    await popup.getByRole('button', { name: 'Edit' }).click();
    await popup.getByRole('button', { name: 'Explain' }).click();
    await popup.getByRole('button', { name: 'Ask', exact: true }).click();
    await popup.getByText('Inserted into the page.').waitFor({ timeout: 120000 });
    console.log('Edited editor text:', await page.locator('.ProseMirror').first().innerText());
    await page.screenshot({ path: path.join(evidence, 'edit.png') });
    console.log('Requests:', captured.map(body => ({ provider: body.provider, model: body.model, thread_key: body.thread_key,
      selection: body.message?.includes('Before the selected phrase after.'), context: body.message?.includes('pageText') })));
  } finally {
    if (notePath) await page.request.delete(`${base}/api/page?path=${encodeURIComponent(notePath)}`).catch(console.error);
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
